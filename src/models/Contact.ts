import { Schema, model, Document, Types } from "mongoose";

export interface IContact extends Document {
  _id: Types.ObjectId;
  waId: string; // WhatsApp user id (usually the phone number, no +)
  name: string;
  profileName?: string; // name as reported by WhatsApp profile
  phoneNumber: string;
  email?: string;
  avatarUrl?: string;
  tags: Types.ObjectId[];
  groups: Types.ObjectId[];
  attributes: Map<string, string>;
  notes?: string;
  isBlocked: boolean;
  lastContactedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContact>(
  {
    waId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    profileName: { type: String, trim: true },
    phoneNumber: { type: String, required: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    avatarUrl: { type: String },
    tags: [{ type: Schema.Types.ObjectId, ref: "Tag" }],
    groups: [{ type: Schema.Types.ObjectId, ref: "Group" }],
    attributes: { type: Map, of: String, default: {} },
    notes: { type: String },
    isBlocked: { type: Boolean, default: false },
    lastContactedAt: { type: Date },
  },
  { timestamps: true }
);

ContactSchema.index({ name: "text", phoneNumber: "text", email: "text" });

export const Contact = model<IContact>("Contact", ContactSchema);
