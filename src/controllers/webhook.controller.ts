import { Request, Response, NextFunction } from "express";
import { catchAsync } from "../utils/catchAsync";
import { env } from "../config/env";
import { ApiError } from "../utils/apiResponse";
import { Contact } from "../models/Contact";
import { Conversation } from "../models/Conversation";
import { Message, MessageType } from "../models/Message";
import { UserSession } from "../models/UserSession";
import { emitNewMessage, emitMessageStatus, emitMessageReaction } from "../services/socket.service";
import { sendPushToUsers } from "../services/fcm.service";

/**
 * NOTE: Meta does NOT call Jesty directly. Your auth/orchestration service owns
 * the Meta app config (verify token + handshake) and RECEIVES the raw Meta
 * webhook, then forwards the same payload here. So this endpoint is
 * authenticated with a shared secret between that service and Jesty, not
 * Meta's hub.verify_token handshake.
 */
export function verifyForwardSecret(req: Request, _res: Response, next: NextFunction) {
  const secret = req.headers["x-webhook-secret"];
  if (!env.INTERNAL_WEBHOOK_SECRET || secret !== env.INTERNAL_WEBHOOK_SECRET) {
    return next(new ApiError(401, "Invalid or missing webhook secret"));
  }
  next();
}

// POST /api/webhook -> forwarded Meta payload from your other service lands here.
// Body shape is expected to be the SAME as Meta's raw webhook body (entry[].changes[].value...).
// If your service wraps/reshapes it before forwarding, adjust the `entries` line below.
export const receiveWebhook = catchAsync(async (req: Request, res: Response) => {
  // Always 200 fast — your other service will retry on non-200.
  res.sendStatus(200);

  const entries = req.body?.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      if (value.messages) {
        for (const msg of value.messages) {
          await handleIncomingMessage(phoneNumberId, value, msg);
        }
      }

      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status);
        }
      }
    }
  }
});

async function handleIncomingMessage(phoneNumberId: string, value: any, msg: any) {
  // Reactions land in the same `messages[]` array as regular messages, but they
  // target an EXISTING message rather than starting a new one — handle separately.
  if (msg.type === "reaction") {
    return handleIncomingReaction(msg);
  }

  const waId = msg.from;
  const contactProfile = value.contacts?.[0];
  const profileName = contactProfile?.profile?.name;

  let contact = await Contact.findOne({ waId });
  if (!contact) {
    contact = await Contact.create({
      waId,
      name: profileName || waId,
      profileName,
      phoneNumber: waId,
    });
  } else if (profileName && profileName !== contact.profileName) {
    contact.profileName = profileName;
    contact.name = contact.name === contact.waId ? profileName : contact.name;
    await contact.save();
  }

  let conversation = await Conversation.findOne({ waId, phoneNumberId });
  if (!conversation) {
    conversation = await Conversation.create({
      contact: contact._id,
      waId,
      phoneNumberId,
      status: "open",
    });
  }

  const type: MessageType = msg.type;
  let text: string | undefined;
  let mediaId: string | undefined;
  let caption: string | undefined;

  switch (type) {
    case "text":
      text = msg.text?.body;
      break;
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      mediaId = msg[type]?.id;
      caption = msg[type]?.caption;
      break;
    case "location":
      text = `Location: ${msg.location?.latitude}, ${msg.location?.longitude}`;
      break;
    default:
      text = "[Unsupported message type]";
  }

  // Reply support: WhatsApp includes `context.id` (the wamid being replied to)
  // when the customer swipes-to-reply on one of our messages.
  let repliedToMessageId: string | undefined;
  const repliedToWaMessageId: string | undefined = msg.context?.id;
  if (repliedToWaMessageId) {
    const repliedTo = await Message.findOne({ waMessageId: repliedToWaMessageId });
    if (repliedTo) repliedToMessageId = repliedTo._id.toString();
  }

  const message = await Message.create({
    conversation: conversation._id,
    waMessageId: msg.id,
    direction: "inbound",
    type,
    text,
    // NOTE: mediaId is Meta's media id, not a public URL.
    // Resolve to a real URL asynchronously via GET /{media-id} (see whatsapp.service.getMediaUrl)
    // and download+store it in your own storage, then update mediaUrl here.
    mediaId,
    caption,
    status: "delivered",
    repliedToMessage: repliedToMessageId,
    repliedToWaMessageId,
    raw: msg,
  });

  await Conversation.findByIdAndUpdate(conversation._id, {
    $set: {
      lastMessagePreview: text || `[${type}]`,
      lastMessageAt: new Date(),
      lastCustomerMessageAt: new Date(), // <-- this is what drives the 24h window
    },
    $inc: { unreadCount: 1 },
  });

  emitNewMessage(conversation._id.toString(), message);
  await notifyAgents(phoneNumberId, contact.name || waId, text || `[${type}]`, conversation._id.toString());
}

// A reaction event updates the TARGET message (adds/replaces/removes an entry
// in its `reactions[]`) instead of appearing as its own row in the timeline —
// this matches how WhatsApp itself displays reactions.
async function handleIncomingReaction(msg: any) {
  const targetWaMessageId: string | undefined = msg.reaction?.message_id;
  const emoji: string = msg.reaction?.emoji || "";
  const waId: string = msg.from;
  if (!targetWaMessageId) return;

  const target = await Message.findOne({ waMessageId: targetWaMessageId });
  if (!target) return;

  if (!emoji) {
    // Empty emoji = the reaction was removed.
    target.reactions = target.reactions.filter((r) => r.waId !== waId);
  } else {
    const existing = target.reactions.find((r) => r.waId === waId);
    if (existing) {
      existing.emoji = emoji;
      existing.reactedAt = new Date();
    } else {
      target.reactions.push({ emoji, waId, reactedAt: new Date() });
    }
  }
  await target.save();

  emitMessageReaction(target.conversation.toString(), {
    messageId: target._id,
    reactions: target.reactions,
    from: "customer",
  });
}

async function handleStatusUpdate(status: any) {
  const waMessageId = status.id; // wamid
  const newStatus = status.status; // sent | delivered | read | failed

  const message = await Message.findOneAndUpdate(
    { waMessageId },
    { $set: { status: newStatus } },
    { new: true }
  );

  if (message) {
    emitMessageStatus(message.conversation.toString(), { messageId: message._id, waMessageId, status: newStatus });
  }
}

// Push notification fan-out: since there's no per-agent assignment yet, every
// active user with access to this WhatsApp number gets notified. The client
// should already be receiving this in real time via socket.io when open —
// this covers the case where the app is backgrounded/closed.
async function notifyAgents(phoneNumberId: string, contactName: string, preview: string, conversationId: string) {
  const users = await UserSession.find({ assignedPhoneNumberIds: phoneNumberId, isActive: true }).select("externalUserId");
  if (!users.length) return;

  await sendPushToUsers(
    users.map((u) => u.externalUserId),
    {
      title: contactName,
      body: preview,
      data: { conversationId },
    }
  );
}
