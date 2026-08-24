import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ok } from "../utils/apiResponse";
import { ApiError } from "../utils/apiResponse";
import { DeviceToken } from "../models/DeviceToken";
import { UserSession } from "../models/UserSession";

const registerSchema = z.object({
  token: z.string().min(10),
  platform: z.enum(["web", "android", "ios"]).default("web"),
});

// POST /api/notifications/device-token
// Registers (or re-links) an FCM device token for the current user, so they
// get push notifications for new messages while the socket isn't connected
// (app backgrounded / browser tab closed).
export const registerDeviceToken = catchAsync(async (req: Request, res: Response) => {
  const { token, platform } = registerSchema.parse(req.body);

  // Require an existing UserSession — i.e. the caller has already logged in at
  // least once (the auth service verified them and we mirrored their profile).
  // We key device tokens by the auth-service user id (externalUserId) so the
  // mapping survives restarts of either service.
  const session = await UserSession.findOne({ externalUserId: req.user!.id });
  if (!session) throw new ApiError(404, "UserSession not found — log in again");

  await DeviceToken.findOneAndUpdate(
    { token },
    { $set: { user: session.externalUserId, platform, token } },
    { upsert: true }
  );

  return ok(res, null, "Device registered for push notifications");
});

// DELETE /api/notifications/device-token  { token }
export const unregisterDeviceToken = catchAsync(async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) throw new ApiError(400, "token is required");
  await DeviceToken.deleteOne({ token });
  return ok(res, null, "Device unregistered");
});
