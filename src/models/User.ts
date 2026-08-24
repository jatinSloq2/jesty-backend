import { Schema, Document, Types } from "mongoose";
import bcrypt from "bcryptjs";
import { authConnection } from "../config/db";

/**
 * ---------------------------------------------------------------------------
 * Lives on the SECOND ("auth", shared) Mongo connection — see config/db.ts.
 * This is the SAME Users collection your other service(s) already own; Jesty
 * reads/writes it directly now instead of proxying login to another backend.
 * The schema mirrors that shared collection field-for-field (including
 * fields Jesty itself doesn't use, like referral/wallet) so saving a document
 * from here never silently drops data written by another service.
 * ---------------------------------------------------------------------------
 */

export type UserRole = "user" | "admin";
export type AuthProvider = "local" | "google";

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password?: string;
  authProvider: AuthProvider;
  googleId?: string | null;
  avatar?: string | null;
  isEmailVerified: boolean;
  role: UserRole;

  // Refresh token tracking (for logout / rotation) — hashed, never the raw token.
  refreshTokenHash?: string;

  // Referral program (owned by the core service; kept here so this service
  // never overwrites it when saving a user document).
  referralCode?: string;
  referredBy?: Types.ObjectId | null;
  referralCodeAppliedAt?: Date | null;
  referralDiscountUsed?: boolean;

  wallet: { inr: number; usd: number };

  // Jesty-specific, additive field: last time this user logged into the
  // WhatsApp inbox specifically.
  lastLoginAt?: Date;

  createdAt: Date;
  updatedAt: Date;

  comparePassword(plain: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, trim: true, required: [true, "Name is required"] },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    // Not required — Google-only users won't have a local password.
    password: {
      type: String,
      minlength: 6,
      select: false, // never returned by default in queries
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    googleId: { type: String, default: null },
    avatar: { type: String, default: null },
    isEmailVerified: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    refreshTokenHash: { type: String, select: false },

    referralCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true, index: true },
    referredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    referralCodeAppliedAt: { type: Date, default: null },
    referralDiscountUsed: { type: Boolean, default: false },

    wallet: {
      inr: { type: Number, default: 0, min: 0 },
      usd: { type: Number, default: 0, min: 0 },
    },

    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

const generateCandidateCode = (name?: string) => {
  const base =
    (name || "USER")
      .replace(/[^a-zA-Z]/g, "")
      .slice(0, 5)
      .toUpperCase() || "USER";
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${base}${suffix}`;
};

UserSchema.pre("save", async function (next) {
  // Hash a new/changed password before it's persisted.
  if (this.isModified("password") && this.password) {
    this.password = await bcrypt.hash(this.password, 10);
  }

  // Generate a unique referral code the first time a user document is saved.
  if (!this.isNew || this.referralCode) return next();

  const UserModel = this.constructor as typeof User;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCandidateCode(this.name);
    // eslint-disable-next-line no-await-in-loop
    const exists = await UserModel.exists({ referralCode: candidate });
    if (!exists) {
      this.referralCode = candidate;
      return next();
    }
  }
  this.referralCode = `${generateCandidateCode(this.name)}${Date.now().toString(36).toUpperCase()}`;
  next();
});

UserSchema.methods.comparePassword = function (plain: string): Promise<boolean> {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(plain, this.password);
};

export const User = authConnection.model<IUser>("User", UserSchema);
