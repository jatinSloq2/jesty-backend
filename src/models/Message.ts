import { Schema, model, Document, Types } from "mongoose";

export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "sent" | "delivered" | "read" | "failed" | "pending";
export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "template"
  | "reaction"
  | "system";

export interface IMessageReaction {
  emoji: string;
  waId: string; // the WhatsApp user id (phone) who reacted
  reactedAt: Date;
}

export interface IMessage extends Document {
  _id: Types.ObjectId;
  conversation: Types.ObjectId;
  waMessageId?: string; // Meta's message id (wamid)
  direction: MessageDirection;
  type: MessageType;
  text?: string;
  mediaUrl?: string;
  mediaId?: string; // Meta media id (used to re-send/forward without re-hosting the file)
  mediaMimeType?: string;
  caption?: string;
  templateName?: string;
  status: MessageStatus;
  // The auth-service id of the agent who sent the message (outbound only),
  // or the bot's id for an AI-sent reply. Source of truth for the user
  // lives in the auth service; we just record the id here so the timeline
  // can show "sent by X" without a join.
  sentBy?: string;
  // "bot" | "agent" — lets the UI show a "Bot"/"Agent" badge next to an
  // outbound message. Left unset for a message sent directly through
  // Jesty's own inbox (sendFromJesty) — those show no badge at all, since
  // that's just an agent using Jesty normally, not a forwarded event.
  senderType?: "bot" | "agent";
  // Display name to go with senderType — the bot's own name, or the
  // sending agent's name.
  senderName?: string;

  // Reply / quote support: this message is a reply to another message.
  repliedToMessage?: Types.ObjectId; // local Message _id, when resolvable
  repliedToWaMessageId?: string; // Meta wamid of the quoted message (always present if a reply)

  // Forward support: this message was forwarded from another message.
  forwardedFromMessage?: Types.ObjectId;

  // Reactions received on THIS message (keyed by waId so a second reaction from
  // the same person replaces, and an empty-emoji event removes it).
  reactions: IMessageReaction[];

  errorMessage?: string;
  raw?: unknown; // raw webhook payload for debugging
  createdAt: Date;
  updatedAt: Date;
}

const MessageReactionSchema = new Schema<IMessageReaction>(
  {
    emoji: { type: String, required: true },
    waId: { type: String, required: true },
    reactedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const MessageSchema = new Schema<IMessage>(
  {
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    waMessageId: { type: String, index: true },
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    type: {
      type: String,
      enum: ["text", "image", "video", "audio", "document", "sticker", "location", "contacts", "template", "reaction", "system"],
      default: "text",
    },
    text: { type: String },
    mediaUrl: { type: String },
    mediaId: { type: String },
    mediaMimeType: { type: String },
    caption: { type: String },
    templateName: { type: String },
    status: { type: String, enum: ["sent", "delivered", "read", "failed", "pending"], default: "pending" },
    sentBy: { type: String, index: true },
    senderType: { type: String, enum: ["bot", "agent"], default: undefined },
    senderName: { type: String },

    repliedToMessage: { type: Schema.Types.ObjectId, ref: "Message" },
    repliedToWaMessageId: { type: String },
    forwardedFromMessage: { type: Schema.Types.ObjectId, ref: "Message" },

    reactions: { type: [MessageReactionSchema], default: [] },

    errorMessage: { type: String },
    raw: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

MessageSchema.index({ conversation: 1, createdAt: -1 });
MessageSchema.index({ text: "text" });

export const Message = model<IMessage>("Message", MessageSchema);