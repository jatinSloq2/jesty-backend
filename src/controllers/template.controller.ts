import axios from "axios";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { catchAsync } from "../utils/catchAsync";
import { ApiError, ok } from "../utils/apiResponse";
import { getDefaultWhatsappCredentials, getWhatsappCredentialsByPhoneNumberId } from "../services/integration.service";
import { createMessageTemplate, listMessageTemplates, uploadTemplateMedia } from "../services/whatsapp.service";

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
  return phoneNumberId
    ? getWhatsappCredentialsByPhoneNumberId(phoneNumberId)
    : getDefaultWhatsappCredentials(req.user!.id);
}

function validateComponents(components: Record<string, unknown>[]) {
  const body = components.filter((item) => String(item.type).toUpperCase() === "BODY");
  if (body.length !== 1 || typeof body[0].text !== "string" || !body[0].text) throw new ApiError(400, "A template needs exactly one BODY component with text");
  const buttons = components.find((item) => String(item.type).toUpperCase() === "BUTTONS") as { buttons?: unknown[] } | undefined;
  if (buttons && (!Array.isArray(buttons.buttons) || buttons.buttons.length > 10)) throw new ApiError(400, "A template supports up to 10 buttons");
}

export const getTemplates = catchAsync(async (req: Request, res: Response) => {
  const creds = await credentials(req, req.query.phoneNumberId as string | undefined);
  if (!creds.wabaId) throw new ApiError(400, "The selected WhatsApp number has no WABA ID");
  return ok(res, await listMessageTemplates(creds.wabaId, creds.accessToken));
});

export const createTemplate = catchAsync(async (req: Request, res: Response) => {
  const body = templateSchema.parse(req.body);
  validateComponents(body.components);
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

const aiSchema = z.object({ prompt: z.string().min(8).max(4000), category: category.default("MARKETING") });
export const draftTemplateWithAi = catchAsync(async (req: Request, res: Response) => {
  const { prompt, category } = aiSchema.parse(req.body);
  if (!env.OPENAI_API_KEY) throw new ApiError(503, "AI drafting is not configured. Set OPENAI_API_KEY on the backend.");
  const instructions = `Return only a valid JSON object for a WhatsApp ${category} template draft. Schema: {name,language,category,parameter_format,components}. Use uppercase component types. Include exactly one BODY. Use {{1}}, {{2}} positional variables only when helpful and include Meta examples: BODY example must be {body_text:[[...]]}; TEXT HEADER must use {header_text:[...]}; media headers need no handle. Buttons may be QUICK_REPLY, URL, PHONE_NUMBER, COPY_CODE, or VOICE_CALL. Never invent unsupported fields. Name lowercase snake_case.`;
  const { data } = await axios.post("https://api.openai.com/v1/responses", {
    model: env.OPENAI_TEMPLATE_MODEL,
    instructions,
    input: prompt,
  }, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" } });
  const raw = data.output_text || data.output?.flatMap((o: any) => o.content || []).find((c: any) => c.type === "output_text")?.text;
  try { return ok(res, JSON.parse(raw)); } catch { throw new ApiError(502, "AI returned an invalid template draft. Please try again."); }
});
