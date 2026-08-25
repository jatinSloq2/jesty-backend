import jwt, { SignOptions } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { ApiError } from "../utils/apiResponse";
import { User, IUser } from "../models/User";
import { getAssignedPhoneNumberIds } from "./integration.service";

/**
 * Jesty owns login itself now — no more proxying to another auth service.
 * Email + password are checked directly against the Users collection on the
 * second/shared Mongo connection (see models/User.ts, config/db.ts), and
 * Jesty mints its own JWT access/refresh tokens.
 */

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  avatar?: string | null;
  // Every phone_number_id this user has a connected, active WhatsApp
  // Integration for — i.e. all the WhatsApp numbers they can access through
  // this one login. See models/Integration.ts.
  assignedPhoneNumberIds: string[];
}

function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(input.trim());
  if (!match) return 15 * 60;
  const value = parseInt(match[1], 10);
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[match[2].toLowerCase()];
}

function signAccessToken(user: IUser): string {
  return jwt.sign(
    { id: user._id.toString(), name: user.name, email: user.email, role: user.role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as SignOptions
  );
}

function signRefreshToken(user: IUser): string {
  return jwt.sign({ id: user._id.toString() }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

// email + password -> Users collection on the second Mongo connection.
export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");
  if (!user || !user.password) {
    throw new ApiError(401, "Invalid email or password");
  }

  const valid = await user.comparePassword(password);
  if (!valid) throw new ApiError(401, "Invalid email or password");

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  user.lastLoginAt = new Date();
  await user.save();

  const assignedPhoneNumberIds = await getAssignedPhoneNumberIds(user._id.toString());

  return {
    accessToken,
    refreshToken,
    expiresIn: parseDurationToSeconds(env.JWT_ACCESS_EXPIRES_IN),
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      assignedPhoneNumberIds,
    },
  };
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function refresh(refreshToken: string): Promise<RefreshResult> {
  let payload: { id: string };
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { id: string };
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const user = await User.findById(payload.id).select("+refreshTokenHash");
  if (!user || !user.refreshTokenHash) {
    throw new ApiError(401, "Session not found — please log in again");
  }

  const matches = await bcrypt.compare(refreshToken, user.refreshTokenHash);
  if (!matches) throw new ApiError(401, "Invalid or expired refresh token");

  const accessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);
  user.refreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
  await user.save();

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: parseDurationToSeconds(env.JWT_ACCESS_EXPIRES_IN),
  };
}

// Revokes the stored refresh token hash so old refresh tokens stop working.
export async function logout(userId?: string): Promise<void> {
  if (!userId) return;
  await User.findByIdAndUpdate(userId, { $unset: { refreshTokenHash: 1 } });
}

// ---------------------------------------------------------------------------
// Inbox SSO handoff (the other backend's "Open inbox" button)
//
// The other backend mints a short-lived, signed token (see that repo's
// services/inboxSso.service.js) and redirects the browser to
// FRONTEND_URL/sso/callback?token=... . That page immediately posts the
// token to POST /api/auth/sso, which lands here. `sub` is that user's _id on
// the SAME Users collection Jesty already reads via AUTH_MONGO_URI, so no
// new account is created — the user must already exist there.
// ---------------------------------------------------------------------------

interface InboxSsoTokenPayload {
  sub: string;
  email?: string;
  name?: string;
  whatsapp?: {
    credentialId?: string;
    phoneNumberId?: string;
    wabaId?: string;
    phoneNumber?: string;
  };
}

export async function loginWithSsoToken(ssoToken: string): Promise<LoginResult> {
  if (!env.INBOX_SSO_SECRET) {
    throw new ApiError(500, "INBOX_SSO_SECRET is not configured — Inbox SSO login is not available");
  }

  let payload: InboxSsoTokenPayload;
  try {
    payload = jwt.verify(ssoToken, env.INBOX_SSO_SECRET, {
      audience: env.INBOX_SSO_AUDIENCE,
      issuer: env.INBOX_SSO_ISSUER,
    }) as InboxSsoTokenPayload;
  } catch {
    throw new ApiError(401, "Invalid or expired SSO token");
  }

  if (!payload.sub) throw new ApiError(401, "Invalid SSO token");

  const user = await User.findById(payload.sub);
  if (!user) throw new ApiError(401, "No matching account found for this SSO token");

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  user.lastLoginAt = new Date();
  await user.save();

  const assignedPhoneNumberIds = await getAssignedPhoneNumberIds(user._id.toString());

  return {
    accessToken,
    refreshToken,
    expiresIn: parseDurationToSeconds(env.JWT_ACCESS_EXPIRES_IN),
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      assignedPhoneNumberIds,
    },
  };
}