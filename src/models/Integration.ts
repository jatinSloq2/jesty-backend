import { Schema, Document, Types } from "mongoose";
import { authConnection } from "../config/db";
import { encrypt, decrypt } from "../utils/crypto";

/**
 * ---------------------------------------------------------------------------
 * Lives on the SECOND ("auth", shared) Mongo connection — see config/db.ts.
 * One document per credential entry. A user can have MULTIPLE credentials
 * per channel — this is what lets one Jesty login manage several WhatsApp
 * numbers at once (several `channel: "whatsapp"` documents for the same
 * `user`). `channel` decides which sub-object is populated. Secret fields
 * are transparently encrypted at rest via schema-level set/get using the
 * app-wide AES-256-GCM helper (utils/crypto.ts).
 * ---------------------------------------------------------------------------
 */

const secretField = {
  type: String,
  set: (v: unknown) => (v === undefined || v === null || v === "" ? undefined : encrypt(String(v))),
  get: (v?: string) => (v ? decrypt(v) : v),
};

export type IntegrationChannel =
  | "email"
  | "whatsapp"
  | "sms"
  | "ai_provider"
  | "google_sheets"
  | "razorpay"
  | "meeting_scheduling";

// ---------- WHATSAPP (Meta Cloud API) — the channel Jesty actually uses ----------
const WhatsappCredentialSchema = new Schema(
  {
    phoneNumber: { type: String, trim: true, required: true },
    phoneNumberId: { type: String, trim: true, required: true, index: true },
    wabaId: { type: String, trim: true, required: true },
    appId: { type: String, trim: true, required: true },
    appSecret: secretField, // Meta App Secret, used to verify X-Hub-Signature-256 on inbound webhooks
    accessToken: secretField,
    webhookVerifyToken: secretField, // legacy — unused going forward
    businessVerificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    tokenType: { type: String, enum: ["temporary", "permanent"], default: "temporary" },
    tokenExpiry: { type: Date },
  },
  { _id: false }
);

// ---------- Other channels — kept for compatibility with the shared
// database your other services also read/write; Jesty itself doesn't
// operate on these today, so they're left loosely typed. ----------
const EmailCredentialSchema = new Schema(
  {
    method: { type: String, enum: ["smtp", "oauth", "api"] },
    fromEmail: { type: String, trim: true, lowercase: true },
    fromName: { type: String, trim: true },
    smtp: {
      host: { type: String, trim: true },
      port: { type: Number },
      username: { type: String, trim: true },
      password: secretField,
      encryption: { type: String, enum: ["tls", "ssl", "none"], default: "tls" },
    },
    oauth: {
      provider: { type: String, enum: ["google", "microsoft"] },
      email: { type: String, trim: true, lowercase: true },
      accessToken: secretField,
      refreshToken: secretField,
      tokenExpiry: { type: Date },
      scope: { type: String },
    },
    api: {
      provider: { type: String, enum: ["ses", "sendgrid", "mailgun", "postmark", "resend"] },
      apiKey: secretField,
      accessKeyId: secretField,
      secretAccessKey: secretField,
      region: { type: String },
      verifiedDomain: { type: String },
    },
  },
  { _id: false }
);

const SmsCredentialSchema = new Schema(
  {
    provider: { type: String, enum: ["twilio", "aws_sns", "vonage", "msg91"] },
    accountSid: { type: String, trim: true },
    apiKey: secretField,
    authToken: secretField,
    accessKeyId: secretField,
    secretAccessKey: secretField,
    region: { type: String },
    fromNumber: { type: String, trim: true },
    senderId: { type: String, trim: true },
    dlt: {
      entityId: { type: String, trim: true },
      templateId: { type: String, trim: true },
    },
  },
  { _id: false }
);

const AiProviderCredentialSchema = new Schema(
  {
    provider: {
      type: String,
      enum: [
        "openai",
        "azure_openai",
        "anthropic",
        "google",
        "vertex_ai",
        "cohere",
        "mistral",
        "groq",
        "openrouter",
        "ollama",
        "other",
      ],
    },
    apiKey: secretField,
    baseUrl: { type: String, trim: true },
    orgId: { type: String, trim: true },
    projectId: { type: String, trim: true },
    deploymentName: { type: String, trim: true },
    apiVersion: { type: String, trim: true },
    serviceAccountJson: secretField,
    gcpProjectId: { type: String, trim: true },
    region: { type: String, trim: true },
    defaultModel: { type: String, trim: true },
    usage: {
      totalTokensUsed: { type: Number, default: 0 },
      totalCostUsd: { type: Number, default: 0 },
      lastUsedAt: { type: Date },
    },
  },
  { _id: false }
);

const GoogleSheetEntrySchema = new Schema(
  {
    label: { type: String, trim: true },
    spreadsheetId: { type: String, trim: true, required: true },
    spreadsheetUrl: { type: String, trim: true },
    tabsInitialized: { type: Boolean, default: false },
    connectedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const GoogleSheetsCredentialSchema = new Schema(
  {
    method: { type: String, enum: ["oauth", "service_account"], default: "oauth" },
    oauth: {
      email: { type: String, trim: true, lowercase: true },
      accessToken: secretField,
      refreshToken: secretField,
      tokenExpiry: { type: Date },
    },
    sheets: [GoogleSheetEntrySchema],
    spreadsheetId: { type: String, trim: true },
    spreadsheetUrl: { type: String, trim: true },
    serviceAccountJson: secretField,
    serviceAccountEmail: { type: String, trim: true },
    tabsInitialized: { type: Boolean, default: false },
  },
  { _id: false }
);

const RazorpayCredentialSchema = new Schema(
  {
    keyId: { type: String, trim: true },
    keySecret: secretField,
    webhookSecret: secretField,
  },
  { _id: false }
);

const MeetingSchedulingCredentialSchema = new Schema(
  {
    provider: { type: String, enum: ["google_meet", "cal_com", "calendly"] },
    googleMeet: {
      email: { type: String, trim: true, lowercase: true },
      accessToken: secretField,
      refreshToken: secretField,
      tokenExpiry: { type: Date },
      calendarId: { type: String, trim: true, default: "primary" },
      defaultTimezone: { type: String, trim: true, default: "Asia/Kolkata" },
    },
    calCom: {
      apiKey: secretField,
      baseUrl: { type: String, trim: true, default: "https://api.cal.com" },
      username: { type: String, trim: true },
    },
    calendly: {
      apiToken: secretField,
      organizationUri: { type: String, trim: true },
      schedulingBaseUrl: { type: String, trim: true },
    },
  },
  { _id: false }
);

export interface IIntegration extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  channel: IntegrationChannel;
  label?: string;
  isDefault: boolean;
  isActive: boolean;
  whatsapp?: {
    phoneNumber: string;
    phoneNumberId: string;
    wabaId: string;
    appId: string;
    appSecret?: string;
    accessToken?: string;
    webhookVerifyToken?: string;
    businessVerificationStatus: "pending" | "verified" | "rejected";
    tokenType: "temporary" | "permanent";
    tokenExpiry?: Date;
  };
  email?: any;
  sms?: any;
  aiProvider?: any;
  googleSheets?: any;
  razorpay?: any;
  meetingScheduling?: any;
  status: "unverified" | "connected" | "failed" | "expired";
  lastCheckedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
  markVerified(): Promise<IIntegration>;
  markFailed(errorMessage?: string): Promise<IIntegration>;
}

const IntegrationSchema = new Schema<IIntegration>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    channel: {
      type: String,
      enum: ["email", "whatsapp", "sms", "ai_provider", "google_sheets", "razorpay", "meeting_scheduling"],
      required: true,
      index: true,
    },

    label: { type: String, trim: true }, // e.g. "Support number", "Sales number"

    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },

    whatsapp: WhatsappCredentialSchema,
    email: EmailCredentialSchema,
    sms: SmsCredentialSchema,
    aiProvider: AiProviderCredentialSchema,
    googleSheets: GoogleSheetsCredentialSchema,
    razorpay: RazorpayCredentialSchema,
    meetingScheduling: MeetingSchedulingCredentialSchema,

    status: {
      type: String,
      enum: ["unverified", "connected", "failed", "expired"],
      default: "unverified",
    },
    lastCheckedAt: { type: Date },
    lastError: { type: String },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

IntegrationSchema.pre("validate", function (next) {
  const channelFieldMap: Record<IntegrationChannel, string> = {
    email: "email",
    whatsapp: "whatsapp",
    sms: "sms",
    ai_provider: "aiProvider",
    google_sheets: "googleSheets",
    razorpay: "razorpay",
    meeting_scheduling: "meetingScheduling",
  };
  const requiredField = channelFieldMap[this.channel];
  if (!(this as any)[requiredField]) {
    return next(new Error(`Missing "${requiredField}" data for channel "${this.channel}"`));
  }
  next();
});

// Only one default credential per channel per user (enforced in the service
// layer via unsetting previous defaults — kept non-unique here since
// isDefault is usually false).
IntegrationSchema.index({ user: 1, channel: 1, isDefault: 1 });
// A given WhatsApp phone number id should only be connected once.
IntegrationSchema.index(
  { channel: 1, "whatsapp.phoneNumberId": 1 },
  { unique: true, partialFilterExpression: { channel: "whatsapp" } }
);

IntegrationSchema.methods.markVerified = function () {
  this.status = "connected";
  this.lastCheckedAt = new Date();
  this.lastError = undefined;
  return this.save();
};

IntegrationSchema.methods.markFailed = function (errorMessage?: string) {
  this.status = "failed";
  this.lastCheckedAt = new Date();
  this.lastError = String(errorMessage || "Connection test failed").slice(0, 500);
  return this.save();
};

export const Integration = authConnection.model<IIntegration>("IntegrationCredential", IntegrationSchema);
