import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ApiError, ok } from "../utils/apiResponse";
import { getDefaultWhatsappCredentials, getWhatsappCredentialsByPhoneNumberId } from "../services/integration.service";
import { createMessageTemplate, listMessageTemplates, uploadTemplateMedia } from "../services/whatsapp.service";
import { TemplateDraft } from "../models/TemplateDraft";

const category = z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]);
const templateSchema = z.object({
  phoneNumberId: z.string().optional(),
  name: z.string().regex(/^[a-z0-9_]{1,512}$/, "Use lowercase letters, numbers, and underscores only"),
  language: z.string().min(2).max(32),
  category,
  parameter_format: z.enum(["named", "positional"]).optional(),
  components: z.array(z.record(z.unknown())).min(1).max(4),
});

async function credentials(req: Request, phoneNumberId?: string) {
  if (phoneNumberId && !req.user?.assignedPhoneNumberIds.includes(phoneNumberId)) {
    throw new ApiError(403, "You don't have access to that WhatsApp number");
  }
  return phoneNumberId
    ? getWhatsappCredentialsByPhoneNumberId(phoneNumberId)
    : getDefaultWhatsappCredentials(req.user!.id);
}

function validateComponents(components: Record<string, unknown>[]) {
  const body = components.filter((item) => String(item.type).toUpperCase() === "BODY");
  if (body.length !== 1) throw new ApiError(400, "A template needs exactly one BODY component");
  if (body[0].text !== undefined && typeof body[0].text !== "string") throw new ApiError(400, "BODY text must be a string");
  const buttons = components.find((item) => String(item.type).toUpperCase() === "BUTTONS") as { buttons?: unknown[] } | undefined;
  if (buttons && (!Array.isArray(buttons.buttons) || buttons.buttons.length > 10)) throw new ApiError(400, "A template supports up to 10 buttons");
  if (components.some((item) => String(item.type).toUpperCase() === "HEADER" || String(item.type).toUpperCase() === "FOOTER") && String(components[0].category).toUpperCase() === "AUTHENTICATION") {
    throw new ApiError(400, "Authentication templates do not support headers or text footers");
  }
}

export const getDrafts = catchAsync(async (req: Request, res: Response) => {
  const drafts = await TemplateDraft.find({ createdBy: req.user!.id }).sort({ updatedAt: -1 });
  return ok(res, drafts.map((draft) => ({ ...draft.toObject(), id: draft._id.toString() })));
});

export const saveDraft = catchAsync(async (req: Request, res: Response) => {
  const body = templateSchema.parse(req.body);
  const draft = req.body.id
    ? await TemplateDraft.findOneAndUpdate({ _id: req.body.id, createdBy: req.user!.id }, { ...body, createdBy: req.user!.id }, { new: true })
    : await TemplateDraft.create({ ...body, createdBy: req.user!.id });
  return ok(res, draft ? { ...draft.toObject(), id: draft._id.toString() } : draft, "Draft saved", 201);
});

export const deleteDraft = catchAsync(async (req: Request, res: Response) => { await TemplateDraft.deleteOne({ _id: req.params.id, createdBy: req.user!.id }); return ok(res, null, "Draft deleted"); });

export const getTemplates = catchAsync(async (req: Request, res: Response) => {
  const creds = await credentials(req, req.query.phoneNumberId as string | undefined);
  if (!creds.wabaId) throw new ApiError(400, "The selected WhatsApp number has no WABA ID");
  return ok(res, await listMessageTemplates(creds.wabaId, creds.accessToken));
});

export const createTemplate = catchAsync(async (req: Request, res: Response) => {
  const body = templateSchema.parse(req.body);
  if (body.category === "AUTHENTICATION") {
    const authBody = body.components.find((item) => String(item.type).toUpperCase() === "BODY");
    const otp = (body.components.find((item) => String(item.type).toUpperCase() === "BUTTONS") as any)?.buttons?.[0];
    if (!authBody || authBody.text || otp?.type !== "OTP") throw new ApiError(400, "Authentication templates require an OTP button and a textless BODY");
    if (!["COPY_CODE", "ONE_TAP", "ZERO_TAP"].includes(otp.otp_type)) throw new ApiError(400, "Unsupported authentication OTP type");
  } else validateComponents(body.components);
  const creds = await credentials(req, body.phoneNumberId);
  if (!creds.wabaId) throw new ApiError(400, "The selected WhatsApp number has no WABA ID");
  const { phoneNumberId: _phoneNumberId, ...payload } = body;
  return ok(res, await createMessageTemplate(creds.wabaId, payload, creds.accessToken), "Template submitted to Meta for review", 201);
});

export const uploadTemplateHeader = catchAsync(async (req: Request, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new ApiError(400, "file is required");
  const creds = await credentials(req, req.body.phoneNumberId);
  if (!creds.appId) throw new ApiError(400, "The selected WhatsApp number has no Meta App ID, required for template media uploads");
  const handle = await uploadTemplateMedia({ appId: creds.appId, fileBuffer: file.buffer, mimeType: file.mimetype, accessToken: creds.accessToken });
  return ok(res, { handle }, "Template media uploaded");
});
