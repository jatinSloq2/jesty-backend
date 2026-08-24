import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ApiError } from "../utils/apiResponse";
import { getAssignedPhoneNumberIds } from "../services/integration.service";

export interface AccessTokenPayload {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
}

export function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  const tokenFromCookie = (req as any).cookies?.access_token;
  return header?.startsWith("Bearer ") ? header.slice(7) : tokenFromCookie;
}

// A request's assignedPhoneNumberIds (which WhatsApp numbers this user can
// touch) require a DB round-trip against the Integration collection — a
// short in-memory cache softens that on every single request.
const PHONE_IDS_CACHE_TTL_MS = 30_000;
const phoneIdsCache = new Map<string, { ids: string[]; expiresAt: number }>();

async function resolveAssignedPhoneNumberIds(userId: string): Promise<string[]> {
  const cached = phoneIdsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;
  const ids = await getAssignedPhoneNumberIds(userId);
  phoneIdsCache.set(userId, { ids, expiresAt: Date.now() + PHONE_IDS_CACHE_TTL_MS });
  return ids;
}

export interface ResolvedUser {
  id: string;
  email: string;
  role: "user" | "admin";
  assignedPhoneNumberIds: string[];
}

// Verifies a Jesty-issued access token locally and resolves the full user
// (including assignedPhoneNumberIds). Shared by requireAuth (HTTP) and
// socket.service.ts (websocket handshake) so both authenticate the exact
// same way.
export async function resolveUser(token: string): Promise<ResolvedUser> {
  if (!env.JWT_ACCESS_SECRET) throw new ApiError(500, "JWT_ACCESS_SECRET is not configured");

  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch (err: any) {
    throw new ApiError(401, err?.message === "jwt expired" ? "Access token expired" : "Invalid or expired token.");
  }

  const assignedPhoneNumberIds = await resolveAssignedPhoneNumberIds(payload.id);
  return { id: payload.id, email: payload.email, role: payload.role, assignedPhoneNumberIds };
}

// Jesty mints and verifies its own access tokens now (see services/auth.service.ts) —
// this just verifies the JWT locally, no network call to another service.
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return next(new ApiError(401, "Not authenticated. Missing access token."));
  }

  try {
    req.user = await resolveUser(token);
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    return next(new ApiError(403, "Admin access required."));
  }
  next();
}

// Separate, STATIC service-to-service token required on Jesty's media
// endpoints (multipart uploads: POST /messages/upload, POST /profile/picture) —
// independent of the per-user access token from requireAuth. Whatever
// gateway/service proxies these multipart requests to Jesty must send this
// as the `jesty-backend-service-token` header.
export function requireServiceToken(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers["jesty-backend-service-token"];
  if (!env.JESTY_BACKEND_SERVICE_TOKEN || token !== env.JESTY_BACKEND_SERVICE_TOKEN) {
    return next(new ApiError(401, "Invalid or missing jesty-backend-service-token header"));
  }
  next();
}
