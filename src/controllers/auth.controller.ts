import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ok } from "../utils/apiResponse";
import { ApiError } from "../utils/apiResponse";
import * as authService from "../services/auth.service";
import { UserSession } from "../models/UserSession";
import { env } from "../config/env";

const REFRESH_COOKIE = "refresh_token";
const ACCESS_COOKIE = "access_token";

function setAuthCookies(res: Response, accessToken: string, refreshToken?: string) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
  });
  if (refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
}

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password required"),
});

// POST /api/auth/login
// Body: { email, password }
// Checked directly against the Users collection on the second (shared)
// Mongo connection (see models/User.ts, config/db.ts) — Jesty owns this
// check itself now, nothing is proxied to another service.
export const login = catchAsync(async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await authService.login(email, password);

  // Mirror the profile into our local UserSession collection so
  // listMessages / webhook / fcm can resolve "who sent this" / "who should
  // get a push" without an extra cross-connection round-trip on every read.
  const session = await UserSession.findOneAndUpdate(
    { externalUserId: result.user.id },
    {
      $set: {
        externalUserId: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        avatarUrl: result.user.avatar || undefined,
        assignedPhoneNumberIds: result.user.assignedPhoneNumberIds,
        isActive: true,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  setAuthCookies(res, result.accessToken, result.refreshToken);

  return ok(
    res,
    {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: {
        id: session.externalUserId,
        name: session.name,
        email: session.email,
        role: session.role,
        avatarUrl: session.avatarUrl,
        assignedPhoneNumberIds: session.assignedPhoneNumberIds,
      },
    },
    "Logged in"
  );
});

// POST /api/auth/refresh
// Body: { refreshToken? }  -- falls back to the refresh_token cookie if omitted.
export const refresh = catchAsync(async (req: Request, res: Response) => {
  const refreshToken = req.body?.refreshToken || (req as any).cookies?.[REFRESH_COOKIE];
  if (!refreshToken) throw new ApiError(401, "Missing refresh token");

  const result = await authService.refresh(refreshToken);
  setAuthCookies(res, result.accessToken, result.refreshToken);

  return ok(
    res,
    {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    },
    "Token refreshed"
  );
});

// GET /api/auth/me
// Returns the locally-mirrored UserSession for the current user.
export const me = catchAsync(async (req: Request, res: Response) => {
  const session = await UserSession.findOneAndUpdate(
    { externalUserId: req.user!.id },
    { $set: { lastSeenAt: new Date() } },
    { new: true }
  );
  if (!session) throw new ApiError(404, "UserSession not found — log in again");
  return ok(res, { user: session });
});

// POST /api/auth/logout
export const logout = catchAsync(async (req: Request, res: Response) => {
  await authService.logout(req.user!.id);

  // Drop our local mirror for this user — they'll re-create it on next login.
  await UserSession.deleteOne({ externalUserId: req.user!.id });

  res.clearCookie(ACCESS_COOKIE);
  res.clearCookie(REFRESH_COOKIE);
  return ok(res, null, "Logged out");
});
