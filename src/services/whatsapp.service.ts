import axios from "axios";
import FormData from "form-data";
import { env } from "../config/env";

const BASE_URL = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}`;

// One client per request so we can stream multipart bodies (form-data + raw
// buffer) without the `Content-Type: application/json` default header getting
// in the way. The Authorization header carries the access token for
// whichever WhatsApp number is being used — normally resolved per-request
// from that number's connected Integration document (see
// services/integration.service.ts), falling back to the single-tenant
// WHATSAPP_ACCESS_TOKEN env var when no explicit token is passed.
function client(accessToken?: string, extraHeaders: Record<string, string> = {}) {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${accessToken || env.WHATSAPP_ACCESS_TOKEN}`,
      ...extraHeaders,
    },
  });
}

// Every send* function accepts an optional `replyToWaMessageId` — Meta's
// `context: { message_id }` — which renders as a quoted reply in WhatsApp,
// used for both explicit "reply" and as the building block for "forward".
interface SendTextParams {
  phoneNumberId: string;
  to: string; // waId, e.g. 91xxxxxxxxxx
  body: string;
  previewUrl?: boolean;
  replyToWaMessageId?: string;
  accessToken?: string; // this number's Integration access token (falls back to env)
}

export async function sendTextMessage({
  phoneNumberId,
  to,
  body,
  previewUrl,
  replyToWaMessageId,
  accessToken,
}: SendTextParams) {
  const { data } = await client(accessToken).post(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body, preview_url: !!previewUrl },
    ...(replyToWaMessageId ? { context: { message_id: replyToWaMessageId } } : {}),
  });
  return data; // contains messages[0].id -> wamid
}

interface SendMediaParams {
  phoneNumberId: string;
  to: string;
  type: "image" | "video" | "audio" | "document" | "sticker";
  link?: string; // hosted, publicly accessible URL of the media
  mediaId?: string; // OR a Meta media id already uploaded (used for forwarding inbound media)
  caption?: string;
  filename?: string;
  replyToWaMessageId?: string;
  accessToken?: string;
}

export async function sendMediaMessage({
  phoneNumberId,
  to,
  type,
  link,
  mediaId,
  caption,
  filename,
  replyToWaMessageId,
  accessToken,
}: SendMediaParams) {
  if (!link && !mediaId) throw new Error("sendMediaMessage requires either `link` or `mediaId``");

  // Per Meta: a `link` payload requires the media to be hosted on a public
  // HTTPS endpoint with a valid SSL cert. A `mediaId` is what you get back
  // from POST /{phone-number-id}/media (see uploadMedia) and is the safer
  // choice for content uploaded by the agent in-app.
  const mediaPayload: Record<string, unknown> = mediaId ? { id: mediaId } : { link };
  if (caption && (type === "image" || type === "video" || type === "document")) mediaPayload.caption = caption;
  if (filename && type === "document") mediaPayload.filename = filename;

  const { data } = await client(accessToken).post(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type,
    [type]: mediaPayload,
    ...(replyToWaMessageId ? { context: { message_id: replyToWaMessageId } } : {}),
  });
  return data;
}

interface SendTemplateParams {
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode: string;
  components?: unknown[];
  accessToken?: string;
}

// Templates can be sent even OUTSIDE the 24h window — this is Meta's exception mechanism.
export async function sendTemplateMessage({
  phoneNumberId,
  to,
  templateName,
  languageCode,
  components,
  accessToken,
}: SendTemplateParams) {
  const { data } = await client(accessToken).post(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components ? { components } : {}),
    },
  });
  return data;
}

// ---- Reactions ----
// Send an emoji reaction to a specific message. To REMOVE a reaction, call
// with emoji: "" (Meta's documented way to clear a reaction).
interface SendReactionParams {
  phoneNumberId: string;
  to: string;
  waMessageId: string; // the wamid being reacted to
  emoji: string;
  accessToken?: string;
}

export async function sendReaction({ phoneNumberId, to, waMessageId, emoji, accessToken }: SendReactionParams) {
  const { data } = await client(accessToken).post(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "reaction",
    reaction: { message_id: waMessageId, emoji },
  });
  return data;
}

export async function markMessageAsRead(phoneNumberId: string, waMessageId: string, accessToken?: string) {
  const { data } = await client(accessToken).post(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: waMessageId,
  });
  return data;
}

export async function getMediaUrl(mediaId: string, accessToken?: string): Promise<{ url: string; mime_type: string }> {
  const { data } = await client(accessToken).get(`/${mediaId}`);
  return data;
}

export async function downloadMedia(mediaUrl: string, accessToken?: string): Promise<Buffer> {
  const { data } = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${accessToken || env.WHATSAPP_ACCESS_TOKEN}` },
    responseType: "arraybuffer",
  });
  return Buffer.from(data);
}

// ---- Media upload ----
// Step 1 of sending media: upload the binary to Meta and get back a media id,
// which is then referenced in the image/video/audio/document/sticker payload
// (see sendMediaMessage's `mediaId`).
//
// Endpoint (v25, see Meta docs "Resumable Upload" / "Media"):
//   POST https://graph.facebook.com/{version}/{phone-number-id}/media
//   Headers: Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
//            (Content-Type set automatically by form-data with the right boundary)
//   Body (multipart/form-data):
//     - messaging_product: "whatsapp"
//     - file:              <binary>
//     - type:              <mime type>           (optional but recommended)
//
// Response: { id: "<media-id>" } — pass this as the `id` field when sending.
export interface UploadMediaParams {
  phoneNumberId: string;
  fileBuffer: Buffer;
  mimeType: string;
  filename: string;
  accessToken?: string;
}

export async function uploadMedia({
  phoneNumberId,
  fileBuffer,
  mimeType,
  filename,
  accessToken,
}: UploadMediaParams): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", fileBuffer, { contentType: mimeType, filename });

  const { data } = await client(accessToken).post(`/${phoneNumberId}/media`, form, {
    // Let form-data set Content-Type with the proper multipart boundary.
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  if (!data?.id) {
    throw new Error("Meta did not return a media id for the upload");
  }
  return data.id as string;
}

// ---- WhatsApp Business Profile ----
// These talk to Meta's Cloud API directly (v25). Jesty does NOT cache the
// profile — every call goes to Meta so the source of truth is always fresh.
//
//   GET  /{phone-number-id}/whatsapp_business_profile?fields=...
//   POST /{phone-number-id}/whatsapp_business_profile  (JSON body)
//
// For setting the profile picture, the documented flow is:
//   1) POST /{phone-number-id}/media            (see uploadMedia above)
//   2) POST /{phone-number-id}/whatsapp_business_profile
//        with body { messaging_product, profile_picture_handle: "<media-id>" }

export interface BusinessProfileFields {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  vertical?: string;
}

const PROFILE_FIELDS =
  "about,address,description,email,profile_picture_url,websites,vertical";

export async function getBusinessProfile(phoneNumberId: string, accessToken?: string) {
  const { data } = await client(accessToken).get(`/${phoneNumberId}/whatsapp_business_profile`, {
    params: { fields: PROFILE_FIELDS },
  });
  // Meta returns { data: [{ ... }] } even for a single phone number.
  return data?.data?.[0];
}

interface UpdateProfileParams extends BusinessProfileFields {
  phoneNumberId: string;
  profilePictureHandle?: string; // obtained after uploading via uploadMedia
  accessToken?: string;
}

export async function updateBusinessProfile({
  phoneNumberId,
  profilePictureHandle,
  accessToken,
  ...rest
}: UpdateProfileParams) {
  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    ...rest,
  };
  if (profilePictureHandle) payload.profile_picture_handle = profilePictureHandle;

  const { data } = await client(accessToken).post(`/${phoneNumberId}/whatsapp_business_profile`, payload);
  return data;
}

// ---- 24 hour customer service window ----
export function isWithinServiceWindow(lastCustomerMessageAt?: Date | null): boolean {
  if (!lastCustomerMessageAt) return false;
  const windowMs = env.WHATSAPP_WINDOW_HOURS * 60 * 60 * 1000;
  return Date.now() - new Date(lastCustomerMessageAt).getTime() < windowMs;
}
