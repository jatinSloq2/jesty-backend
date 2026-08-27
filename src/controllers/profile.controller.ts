import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ok } from "../utils/apiResponse";
import { ApiError } from "../utils/apiResponse";
import { env } from "../config/env";
import {
  getBusinessProfile,
  updateBusinessProfile,
  uploadMedia,
} from "../services/whatsapp.service";
import { getWhatsappCredentialsByPhoneNumberId, getDefaultWhatsappCredentials } from "../services/integration.service";

// add near the top of the file, or in a shared constants file
export const BUSINESS_VERTICALS = [
  "ALCOHOL",
  "GOVT",
  "HOTEL",
  "HEALTH",
  "OTC_DRUGS",
  "NONPROFIT",
  "PROF_SERVICES",
  "RETAIL",
  "TRAVEL",
  "RESTAURANT",
  "OTHER",
] as const;

export type BusinessVertical = (typeof BUSINESS_VERTICALS)[number];

// GET /api/profile?phoneNumberId=...
// Reads the WhatsApp Business profile straight from Meta's Cloud API.
// `phoneNumberId` defaults to the caller's default connected WhatsApp
// number (see models/Integration.ts); falls back to the single-tenant
// WHATSAPP_PHONE_NUMBER_ID env var if nothing is connected yet.
export const getProfile = catchAsync(async (req: Request, res: Response) => {
  const requestedId = req.query.phoneNumberId as string | undefined;
  const { accessToken, phoneNumberId } = requestedId
    ? await getWhatsappCredentialsByPhoneNumberId(requestedId)
    : await getDefaultWhatsappCredentials(req.user!.id);
  const profile = await getBusinessProfile(phoneNumberId, accessToken);
  return ok(res, profile);
});

const updateSchema = z.object({
  phoneNumberId: z.string().optional(),
  about: z.string().max(139).optional(),
  address: z.string().max(256).optional(),
  description: z.string().max(512).optional(),
  email: z.string().email().optional(),
  websites: z.array(z.string().url()).max(2).optional(),
  vertical: z.enum(BUSINESS_VERTICALS).optional(),
});

// PATCH /api/profile
// Updates editable WhatsApp Business profile fields via Meta's Cloud API.
// All updates go through the same `{phone-number-id}/whatsapp_business_profile`
// endpoint that the WhatsApp Manager UI uses.
export const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const { accessToken, phoneNumberId } = body.phoneNumberId
    ? await getWhatsappCredentialsByPhoneNumberId(body.phoneNumberId)
    : await getDefaultWhatsappCredentials(req.user!.id);
  const { phoneNumberId: _omit, ...rest } = body;
  const result = await updateBusinessProfile({ phoneNumberId, accessToken, ...rest });
  return ok(res, result, "Profile updated");
});

// POST /api/profile/picture  (multipart/form-data, field name: "file")
// Requires the jesty-backend-service-token header (see routes/profile.routes.ts).
// Meta's flow for setting the profile picture is a two-step call:
//   1) upload the image to POST /{phone-number-id}/media        -> media id
//   2) POST /{phone-number-id}/whatsapp_business_profile
//        body { profile_picture_handle: "<media id>" }         -> applies it
// We do both here so the client only has to make one call.
export const updateProfilePicture = catchAsync(async (req: Request, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new ApiError(400, "file is required");

  const requestedId = req.body.phoneNumberId as string | undefined;
  const { accessToken, phoneNumberId } = requestedId
    ? await getWhatsappCredentialsByPhoneNumberId(requestedId)
    : await getDefaultWhatsappCredentials(req.user!.id);

  const handle = await uploadMedia({
    phoneNumberId,
    fileBuffer: file.buffer,
    mimeType: file.mimetype,
    filename: file.originalname || "profile.jpg",
    accessToken,
  });
  const result = await updateBusinessProfile({ phoneNumberId, accessToken, profilePictureHandle: handle });
  return ok(res, result, "Profile picture updated");
});
