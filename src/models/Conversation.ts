import { Schema, model, Document, Types } from "mongoose";

export interface IConversation extends Document {
  _id: Types.ObjectId;
  contact: Types.ObjectId;
  waId: string;
  phoneNumberId: string; // which of our WhatsApp numbers this conversation is on
  lastMessagePreview?: string;
  lastMessageAt?: Date;
  lastCustomerMessageAt?: Date; // drives the 24h window
  unreadCount: number;
  status: "open" | "pending" | "closed";
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    contact: { type: Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    waId: { type: String, required: true, index: true },
    phoneNumberId: { type: String, required: true },
    lastMessagePreview: { type: String },
    lastMessageAt: { type: Date },
    lastCustomerMessageAt: { type: Date },
    unreadCount: { type: Number, default: 0 },
    status: { type: String, enum: ["open", "pending", "closed"], default: "open" },
  },
  { timestamps: true }
);

ConversationSchema.index({ lastMessageAt: -1 });

export const Conversation = model<IConversation>("Conversation", ConversationSchema);
