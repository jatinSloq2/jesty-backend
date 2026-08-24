import { Schema, model, Document, Types } from "mongoose";

export type AttributeType = "text" | "number" | "date" | "boolean" | "list";

export interface IAttribute extends Document {
  _id: Types.ObjectId;
  key: string; // machine key, e.g. "order_id"
  label: string; // display label, e.g. "Order ID"
  type: AttributeType;
  options?: string[]; // used when type === "list"
  // The auth-service id of the user who created this attribute. Source of truth
  // lives in the auth service; we just store the id locally for auditability.
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const AttributeSchema = new Schema<IAttribute>(
  {
    key: { type: String, required: true, trim: true, unique: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: ["text", "number", "date", "boolean", "list"], default: "text" },
    options: [{ type: String }],
    createdBy: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

export const Attribute = model<IAttribute>("Attribute", AttributeSchema);
