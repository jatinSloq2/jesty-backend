import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ok, paginated } from "../utils/apiResponse";
import { ApiError } from "../utils/apiResponse";
import { Message } from "../models/Message";
import { Conversation } from "../models/Conversation";
import {
  isWithinServiceWindow,
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendReaction,
  uploadMedia,
} from "../services/whatsapp.service";
import { emitNewMessage, emitMessageReaction } from "../services/socket.service";
import { getWhatsappCredentialsByPhoneNumberId } from "../services/integration.service";

// GET /api/conversations/:conversationId/messages?page=&limit=
export const listMessages = catchAsync(async (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const page = parseInt((req.query.page as string) || "1", 10);
  const limit = parseInt((req.query.limit as string) || "50", 10);

  const [items, total] = await Promise.all([
    Message.find({ conversation: conversationId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: "repliedToMessage", select: "text type caption mediaUrl direction" }),
    Message.countDocuments({ conversation: conversationId }),
  ]);

  return paginated(res, items.reverse(), page, limit, total);
});

// GET /api/messages/search?q=
export const searchMessages = catchAsync(async (req: Request, res: Response) => {
  const q = (req.query.q as string) || "";
  if (!q.trim()) return ok(res, []);
  const items = await Message.find({ $text: { $search: q } })
    .limit(50)
    .populate({ path: "conversation", populate: { path: "contact", select: "name phoneNumber avatarUrl" } });
  return ok(res, items);
});

// ---- Send message (shared by both the JSON and multipart paths) ----
//
// The single source of truth for "send a message from Jesty" — does the
// 24h-window check, persists the local Message, calls the right Meta helper,
// and updates the conversation's lastMessage* fields. Both the JSON route
// (POST /api/messages) and the multipart upload route
// (POST /api/messages/upload) funnel into this function.
async function sendFromJesty(params: {
  conversationId: string;
  type: "text" | "image" | "video" | "audio" | "document" | "sticker" | "template";
  text?: string;
  caption?: string;
  filename?: string;
  templateName?: string;
  languageCode?: string;
  link?: string; // optional pre-hosted HTTPS URL
  mediaId?: string; // optional Meta media id (pre-uploaded)
  replyToMessageId?: string;
  sentBy: string; // auth-service user id
  // If provided, we upload the file to Meta first and use the returned media id.
  upload?: { fileBuffer: Buffer; mimeType: string; filename: string };
}) {
  const conversation = await Conversation.findById(params.conversationId).populate("contact", "waId isBlocked");
  if (!conversation) throw new ApiError(404, "Conversation not found");

  const contact = conversation.contact as any;
  if (contact?.isBlocked) throw new ApiError(400, "This contact is blocked");

  const withinWindow = isWithinServiceWindow(conversation.lastCustomerMessageAt);

  // The 24h rule: freeform (text/media) messages ONLY within the window.
  // Outside the window, only pre-approved templates can be sent.
  if (params.type !== "template" && !withinWindow) {
    throw new ApiError(
      403,
      "This conversation is outside the 24-hour customer service window. Send an approved template instead."
    );
  }

  let repliedToWaMessageId: string | undefined;
  if (params.replyToMessageId) {
    const repliedTo = await Message.findById(params.replyToMessageId);
    if (!repliedTo) throw new ApiError(404, "Message being replied to was not found");
    repliedToWaMessageId = repliedTo.waMessageId;
  }

  // Resolve which connected WhatsApp number's credentials to send with —
  // this is what lets a single login's several connected numbers each send
  // with their own access token (see services/integration.service.ts).
  const { accessToken } = await getWhatsappCredentialsByPhoneNumberId(conversation.phoneNumberId);

  const message = await Message.create({
    conversation: conversation._id,
    direction: "outbound",
    type: params.type,
    text: params.text,
    mediaUrl: params.link, // for hosted links; null when we uploaded to Meta
    mediaId: params.mediaId,
    caption: params.caption,
    templateName: params.templateName,
    status: "pending",
    sentBy: params.sentBy,
    repliedToMessage: params.replyToMessageId || undefined,
    repliedToWaMessageId,
  });

  try {
    let waResponse: any;

    if (params.type === "text") {
      if (!params.text) throw new ApiError(400, "text is required");
      waResponse = await sendTextMessage({
        phoneNumberId: conversation.phoneNumberId,
        to: conversation.waId,
        body: params.text,
        replyToWaMessageId: repliedToWaMessageId,
        accessToken,
      });
    } else if (params.type === "template") {
      if (!params.templateName) throw new ApiError(400, "templateName is required");
      waResponse = await sendTemplateMessage({
        phoneNumberId: conversation.phoneNumberId,
        to: conversation.waId,
        templateName: params.templateName,
        languageCode: params.languageCode || "en_US",
        accessToken,
      });
    } else {
      // media: image / video / audio / document / sticker
      let mediaId = params.mediaId;
      if (!mediaId && params.upload) {
        // Step 1 of Meta's send-media flow: POST /{phone-number-id}/media
        // (multipart, with the access token). The returned id is what we
        // hand to the messages endpoint.
        mediaId = await uploadMedia({
          phoneNumberId: conversation.phoneNumberId,
          fileBuffer: params.upload.fileBuffer,
          mimeType: params.upload.mimeType,
          filename: params.upload.filename,
          accessToken,
        });
        message.mediaId = mediaId;
      }
      if (!mediaId && !params.link) {
        throw new ApiError(400, "Either a hosted link, a Meta media id, or an uploaded file is required for media messages");
      }
      waResponse = await sendMediaMessage({
        phoneNumberId: conversation.phoneNumberId,
        to: conversation.waId,
        type: params.type,
        link: params.link,
        mediaId,
        caption: params.caption,
        filename: params.filename,
        replyToWaMessageId: repliedToWaMessageId,
        accessToken,
      });
    }

    message.waMessageId = waResponse?.messages?.[0]?.id;
    message.status = "sent";
    await message.save();
  } catch (err: any) {
    message.status = "failed";
    message.errorMessage = err?.response?.data?.error?.message || err.message;
    await message.save();
    throw new ApiError(502, `WhatsApp send failed: ${message.errorMessage}`);
  }

  await Conversation.findByIdAndUpdate(conversation._id, {
    $set: { lastMessagePreview: params.text || `[${params.type}]`, lastMessageAt: new Date() },
  });

  emitNewMessage(conversation._id.toString(), message);
  return message;
}

// ---- JSON routes ----

const sendJsonSchema = z.object({
  conversationId: z.string(),
  type: z.enum(["text", "image", "video", "audio", "document", "sticker", "template"]).default("text"),
  text: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  mediaId: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
  templateName: z.string().optional(),
  languageCode: z.string().optional(),
  // Reply-to support: pass the local Message _id you're replying to. Jesty
  // resolves its wamid and sends it as Meta's `context.message_id`.
  replyToMessageId: z.string().optional(),
});

// POST /api/messages  (JSON body)
// For pre-hosted media links OR for when the client already has a Meta media id.
export const sendMessage = catchAsync(async (req: Request, res: Response) => {
  const body = sendJsonSchema.parse(req.body);

  const message = await sendFromJesty({
    conversationId: body.conversationId,
    type: body.type,
    text: body.text,
    caption: body.caption,
    filename: body.filename,
    templateName: body.templateName,
    languageCode: body.languageCode,
    link: body.mediaUrl,
    mediaId: body.mediaId,
    replyToMessageId: body.replyToMessageId,
    sentBy: req.user!.id,
  });

  return ok(res, message, "Message sent", 201);
});

// POST /api/conversations/:conversationId/messages  (JSON body)
// Same as POST /api/messages but with the conversationId in the URL —
// kept as a convenience alias so the client doesn't have to know which
// router the request lands on.
export const sendMessageInConversation = catchAsync(async (req: Request, res: Response) => {
  const body = sendJsonSchema.parse({ ...req.body, conversationId: req.params.conversationId });
  const message = await sendFromJesty({
    conversationId: body.conversationId,
    type: body.type,
    text: body.text,
    caption: body.caption,
    filename: body.filename,
    templateName: body.templateName,
    languageCode: body.languageCode,
    link: body.mediaUrl,
    mediaId: body.mediaId,
    replyToMessageId: body.replyToMessageId,
    sentBy: req.user!.id,
  });
  return ok(res, message, "Message sent", 201);
});

// ---- Multipart upload route (image/video/audio/document/sticker) ----
//
// Every media message that the agent picks from their machine goes through
// this path. Jesty uploads the file to Meta's
//   POST /{phone-number-id}/media
// using the WHATSAPP_ACCESS_TOKEN, gets back a media id, and then uses that
// id when calling the messages endpoint. This is the same flow WhatsApp
// itself uses for in-app media, and it avoids the "hosted HTTPS link"
// requirement that the JSON / link-based path has.

const MEDIA_UPLOAD_FIELD = "file";
const MAX_MEDIA_BYTES = 16 * 1024 * 1024; // 16MB (matches Meta's documented cap)

// POST /api/messages/upload  (multipart/form-data)
//
// Fields:
//   - conversationId  (string, required)
//   - type            ("image" | "video" | "audio" | "document" | "sticker")
//   - caption         (string, optional)
//   - filename        (string, optional — required for `document`)
//   - replyToMessageId (string, optional)
//   - file            (binary, required)
export const sendMediaUpload = catchAsync(async (req: Request, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new ApiError(400, `file is required (multipart field "${MEDIA_UPLOAD_FIELD}")`);

  const conversationId = (req.body.conversationId as string) || "";
  const type = (req.body.type as string) || "";
  if (!conversationId) throw new ApiError(400, "conversationId is required");
  if (!["image", "video", "audio", "document", "sticker"].includes(type)) {
    throw new ApiError(400, "type must be one of image, video, audio, document, sticker");
  }

  if (type === "document" && !req.body.filename && !file.originalname) {
    throw new ApiError(400, "filename is required for document messages");
  }

  const message = await sendFromJesty({
    conversationId,
    type: type as any,
    caption: req.body.caption as string | undefined,
    filename: (req.body.filename as string) || file.originalname,
    replyToMessageId: req.body.replyToMessageId as string | undefined,
    sentBy: req.user!.id,
    upload: {
      fileBuffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname || `${type}.bin`,
    },
  });

  return ok(res, message, "Message sent", 201);
});

// ---- Forward / react / unreact ----

const forwardSchema = z.object({
  conversationIds: z.array(z.string()).min(1),
});

// POST /api/messages/:messageId/forward   { conversationIds: string[] }
// Forwards a message's content (text/media) to one or more OTHER conversations.
// Meta's Cloud API has no native "forward" action, so this re-sends the same
// content as a brand-new outbound message on each target conversation —
// reusing the original media's Meta id where possible instead of re-hosting it.
export const forwardMessage = catchAsync(async (req: Request, res: Response) => {
  const { messageId } = req.params;
  const { conversationIds } = forwardSchema.parse(req.body);

  const original = await Message.findById(messageId);
  if (!original) throw new ApiError(404, "Message not found");
  if (original.type === "template" || original.type === "reaction" || original.type === "system") {
    throw new ApiError(400, `Cannot forward a message of type "${original.type}"`);
  }

  const targets = await Conversation.find({ _id: { $in: conversationIds } }).populate("contact", "waId isBlocked");

  const results: Array<{ conversationId: string; success: boolean; error?: string; message?: unknown }> = [];

  for (const target of targets) {
    const contact = target.contact as any;
    if (contact?.isBlocked) {
      results.push({ conversationId: target._id.toString(), success: false, error: "Contact is blocked" });
      continue;
    }
    if (!isWithinServiceWindow(target.lastCustomerMessageAt)) {
      results.push({
        conversationId: target._id.toString(),
        success: false,
        error: "Outside the 24-hour window — send a template instead",
      });
      continue;
    }

    const forwarded = await Message.create({
      conversation: target._id,
      direction: "outbound",
      type: original.type,
      text: original.text,
      mediaUrl: original.mediaUrl,
      mediaId: original.mediaId,
      caption: original.caption,
      status: "pending",
      sentBy: req.user!.id,
      forwardedFromMessage: original._id,
    });

    try {
      const { accessToken } = await getWhatsappCredentialsByPhoneNumberId(target.phoneNumberId);
      let waResponse: any;
      if (original.type === "text") {
        waResponse = await sendTextMessage({
          phoneNumberId: target.phoneNumberId,
          to: target.waId,
          body: original.text || "",
          accessToken,
        });
      } else {
        waResponse = await sendMediaMessage({
          phoneNumberId: target.phoneNumberId,
          to: target.waId,
          type: original.type as any,
          link: original.mediaId ? undefined : original.mediaUrl,
          mediaId: original.mediaId,
          caption: original.caption,
          accessToken,
        });
      }
      forwarded.waMessageId = waResponse?.messages?.[0]?.id;
      forwarded.status = "sent";
      await forwarded.save();

      await Conversation.findByIdAndUpdate(target._id, {
        $set: { lastMessagePreview: original.text || `[${original.type}]`, lastMessageAt: new Date() },
      });

      emitNewMessage(target._id.toString(), forwarded);
      results.push({ conversationId: target._id.toString(), success: true, message: forwarded });
    } catch (err: any) {
      forwarded.status = "failed";
      forwarded.errorMessage = err?.response?.data?.error?.message || err.message;
      await forwarded.save();
      results.push({ conversationId: target._id.toString(), success: false, error: forwarded.errorMessage });
    }
  }

  return ok(res, results, "Forward complete");
});

const reactSchema = z.object({
  emoji: z.string().min(1),
});

// POST /api/messages/:messageId/react   { emoji }
// Sends OUR reaction to a message in the conversation (agent reacting to a customer's message).
export const reactToMessage = catchAsync(async (req: Request, res: Response) => {
  const { messageId } = req.params;
  const { emoji } = reactSchema.parse(req.body);

  const message = await Message.findById(messageId);
  if (!message || !message.waMessageId) throw new ApiError(404, "Message not found");

  const conversation = await Conversation.findById(message.conversation);
  if (!conversation) throw new ApiError(404, "Conversation not found");

  const { accessToken } = await getWhatsappCredentialsByPhoneNumberId(conversation.phoneNumberId);
  await sendReaction({
    phoneNumberId: conversation.phoneNumberId,
    to: conversation.waId,
    waMessageId: message.waMessageId,
    emoji,
    accessToken,
  });

  emitMessageReaction(conversation._id.toString(), { messageId: message._id, emoji, from: "agent" });
  return ok(res, null, "Reaction sent");
});

// DELETE /api/messages/:messageId/react
// Clears OUR reaction on a message (Meta's documented way: send emoji: "").
export const removeReaction = catchAsync(async (req: Request, res: Response) => {
  const { messageId } = req.params;

  const message = await Message.findById(messageId);
  if (!message || !message.waMessageId) throw new ApiError(404, "Message not found");

  const conversation = await Conversation.findById(message.conversation);
  if (!conversation) throw new ApiError(404, "Conversation not found");

  await sendReaction({
    phoneNumberId: conversation.phoneNumberId,
    to: conversation.waId,
    waMessageId: message.waMessageId,
    emoji: "",
  });

  emitMessageReaction(conversation._id.toString(), { messageId: message._id, emoji: "", from: "agent" });
  return ok(res, null, "Reaction removed");
});
