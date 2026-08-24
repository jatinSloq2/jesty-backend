import { Schema, model, Document, Types } from "mongoose";

/**
 * Local, fast-read MIRROR of the authoritative user record (models/User.ts,
 * on the second/shared Mongo connection). Jesty never creates/edits
 * credentials here — this collection just caches the profile fields Jesty
 * needs to reference locally (e.g. Message.sentBy, push-notification
 * fan-out by assignedPhoneNumberIds in webhook.controller.ts) without an
 * extra cross-connection lookup on every read. It's kept in sync on every
 * login via controllers/auth.controller.ts.
 */
export interface IUserSession extends Document {
  _id: Types.ObjectId;
  externalUserId: string; // this user's _id in models/User.ts (second/shared connection) — source of truth
  name: string;
  email: string;
  role: "admin" | "user";
  avatarUrl?: string;
  assignedPhoneNumberIds: string[]; // WhatsApp phone_number_ids this user can access
  isActive: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSessionSchema = new Schema<IUserSession>(
  {
    externalUserId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: { type: String, enum: ["admin", "user"], default: "user" },
    avatarUrl: { type: String },
    assignedPhoneNumberIds: [{ type: String }],
    isActive: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const UserSession = model<IUserSession>("UserSession", UserSessionSchema);
