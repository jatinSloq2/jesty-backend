import { Schema, model, Document, Types } from "mongoose";

export interface ITag extends Document {
  _id: Types.ObjectId;
  name: string;
  color: string;
  // The auth-service id of the user who created this tag. Source of truth lives
  // in the auth service; we just store the id locally for auditability.
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const TagSchema = new Schema<ITag>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    color: { type: String, default: "#25D366" },
    createdBy: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

export const Tag = model<ITag>("Tag", TagSchema);
