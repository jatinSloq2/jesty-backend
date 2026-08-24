import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ok } from "../utils/apiResponse";
import { ApiError } from "../utils/apiResponse";
import { Integration } from "../models/Integration";

// ---------------------------------------------------------------------------
// Lets one logged-in user connect and manage MULTIPLE WhatsApp numbers under
// their single Jesty login. Each connected number is a
// `channel: "whatsapp"` Integration document owned by req.user.id (see
// models/Integration.ts, on the second/shared Mongo connection).
// ---------------------------------------------------------------------------

function serialize(integration: any) {
  const obj = integration.toObject({ getters: true }); // getters decrypt secret fields
  return {
    id: obj._id,
    label: obj.label,
    isDefault: obj.isDefault,
    isActive: obj.isActive,
    status: obj.status,
    lastCheckedAt: obj.lastCheckedAt,
    lastError: obj.lastError,
    whatsapp: obj.whatsapp
      ? {
          phoneNumber: obj.whatsapp.phoneNumber,
          phoneNumberId: obj.whatsapp.phoneNumberId,
          wabaId: obj.whatsapp.wabaId,
          appId: obj.whatsapp.appId,
          businessVerificationStatus: obj.whatsapp.businessVerificationStatus,
          tokenType: obj.whatsapp.tokenType,
          tokenExpiry: obj.whatsapp.tokenExpiry,
          // accessToken / appSecret are intentionally never returned to the client.
        }
      : undefined,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

// GET /api/integrations/whatsapp — every WhatsApp number the current user has connected.
export const listWhatsappIntegrations = catchAsync(async (req: Request, res: Response) => {
  const integrations = await Integration.find({ user: req.user!.id, channel: "whatsapp" }).sort({ createdAt: -1 });
  return ok(res, integrations.map(serialize));
});

const connectSchema = z.object({
  label: z.string().trim().optional(),
  phoneNumber: z.string().trim().min(1, "phoneNumber is required"),
  phoneNumberId: z.string().trim().min(1, "phoneNumberId is required"),
  wabaId: z.string().trim().min(1, "wabaId is required"),
  appId: z.string().trim().min(1, "appId is required"),
  appSecret: z.string().trim().optional(),
  accessToken: z.string().trim().min(1, "accessToken is required"),
  tokenType: z.enum(["temporary", "permanent"]).optional(),
  isDefault: z.boolean().optional(),
});

// POST /api/integrations/whatsapp — connect a new WhatsApp number to the current user.
export const connectWhatsappIntegration = catchAsync(async (req: Request, res: Response) => {
  const body = connectSchema.parse(req.body);

  if (body.isDefault) {
    await Integration.updateMany(
      { user: req.user!.id, channel: "whatsapp", isDefault: true },
      { $set: { isDefault: false } }
    );
  }

  const integration = await Integration.create({
    user: req.user!.id,
    channel: "whatsapp",
    label: body.label,
    isDefault: !!body.isDefault,
    whatsapp: {
      phoneNumber: body.phoneNumber,
      phoneNumberId: body.phoneNumberId,
      wabaId: body.wabaId,
      appId: body.appId,
      appSecret: body.appSecret,
      accessToken: body.accessToken,
      tokenType: body.tokenType || "temporary",
    },
  });

  return ok(res, serialize(integration), "WhatsApp number connected", 201);
});

const updateSchema = z.object({
  label: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  accessToken: z.string().trim().min(1).optional(), // rotate a stale/expired token
  appSecret: z.string().trim().optional(),
  tokenType: z.enum(["temporary", "permanent"]).optional(),
});

// PATCH /api/integrations/whatsapp/:id
export const updateWhatsappIntegration = catchAsync(async (req: Request, res: Response) => {
  const body = updateSchema.parse(req.body);
  const integration = await Integration.findOne({ _id: req.params.id, user: req.user!.id, channel: "whatsapp" });
  if (!integration) throw new ApiError(404, "WhatsApp integration not found");

  if (body.isDefault) {
    await Integration.updateMany(
      { user: req.user!.id, channel: "whatsapp", isDefault: true, _id: { $ne: integration._id } },
      { $set: { isDefault: false } }
    );
    integration.isDefault = true;
  }
  if (body.label !== undefined) integration.label = body.label;
  if (body.isActive !== undefined) integration.isActive = body.isActive;
  if (body.accessToken) integration.whatsapp!.accessToken = body.accessToken;
  if (body.appSecret) integration.whatsapp!.appSecret = body.appSecret;
  if (body.tokenType) integration.whatsapp!.tokenType = body.tokenType;

  await integration.save();
  return ok(res, serialize(integration), "WhatsApp integration updated");
});

// DELETE /api/integrations/whatsapp/:id
export const removeWhatsappIntegration = catchAsync(async (req: Request, res: Response) => {
  const integration = await Integration.findOneAndDelete({
    _id: req.params.id,
    user: req.user!.id,
    channel: "whatsapp",
  });
  if (!integration) throw new ApiError(404, "WhatsApp integration not found");
  return ok(res, null, "WhatsApp number disconnected");
});
