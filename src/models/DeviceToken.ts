import { Schema, model, Document, Types } from "mongoose";

export interface IDeviceToken extends Document {
  _id: Types.ObjectId;
  // The auth-service id of the user this device belongs to. Source of truth
  // lives in the auth service; we just key device tokens by it locally.
  user: string;
  token: string;
  platform: "web" | "android" | "ios";
  createdAt: Date;
  updatedAt: Date;
}

const DeviceTokenSchema = new Schema<IDeviceToken>(
  {
    user: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ["web", "android", "ios"], default: "web" },
  },
  { timestamps: true }
);

export const DeviceToken = model<IDeviceToken>("DeviceToken", DeviceTokenSchema);
