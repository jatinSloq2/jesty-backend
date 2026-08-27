import { Document, model, Schema, Types } from "mongoose";

export interface ITemplateDraft extends Document {
  _id: Types.ObjectId;
  createdBy: string;
  phoneNumberId?: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  parameter_format?: "named" | "positional";
  components: Record<string, unknown>[];
  createdAt: Date;
  updatedAt: Date;
}

const TemplateDraftSchema = new Schema<ITemplateDraft>({
  createdBy: { type: String, required: true, index: true }, phoneNumberId: String,
  name: { type: String, required: true }, language: { type: String, required: true },
  category: { type: String, enum: ["MARKETING", "UTILITY", "AUTHENTICATION"], required: true },
  parameter_format: { type: String, enum: ["named", "positional"] }, components: { type: [Schema.Types.Mixed], required: true },
}, { timestamps: true });

export const TemplateDraft = model<ITemplateDraft>("TemplateDraft", TemplateDraftSchema);
