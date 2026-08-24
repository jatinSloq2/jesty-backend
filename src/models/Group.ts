import { Schema, model, Document, Types } from "mongoose";

export interface IGroup extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  contactIds: Types.ObjectId[];
  // The auth-service id of the user who created this group. Source of truth lives
  // in the auth service; we just store the id locally for auditability.
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema = new Schema<IGroup>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, trim: true },
    contactIds: [{ type: Schema.Types.ObjectId, ref: "Contact" }],
    createdBy: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

export const Group = model<IGroup>("Group", GroupSchema);
