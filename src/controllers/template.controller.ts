import { Request, Response } from "express";
import { z } from "zod";
import { catchAsync } from "../utils/catchAsync";
import { ApiError, ok } from "../utils/apiResponse";
import { getDefaultWhatsappCredentials, getWhatsappCredentialsByPhoneNumberId } from "../services/integration.service";
import { createMessageTemplate, listMessageTemplates, uploadTemplateMedia } from "../services/whatsapp.service";
import { TemplateDraft } from "../models/TemplateDraft";

/**
 * ---------------------------------------------------------------------------
 * Validation is intentionally strict here. Meta's own error messages for a
 * malformed `message_templates` POST are vague ("Param text is invalid" with
 * no indication of which component), so we catch the mistakes ourselves
 * before we ever call Graph — this is what "correct template creation flow"
 * means in practice.
 *
 * Reference: Meta "Message Templates" API (WhatsApp Business Platform),
 * Cloud API v20+ / current v25 behaviour used elsewhere in this service.
 * ---------------------------------------------------------------------------
 */

const category = z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]);

// Meta's supported language codes look like "en", "en_US", "pt_BR" — two or
// three lowercase letters, optionally followed by an underscore and an
// uppercase two-letter region. A bare length check let garbage like "ENGLISH"
// or "eng-us" through before.
const languageCode = z
  .string()
  .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Use a Meta-supported language code, e.g. en, en_US, pt_BR");

const templateSchema = z.object({
  phoneNumberId: z.string().optional(),
  name: z.string().regex(/^[a-z0-9_]{1,512}$/, "Use lowercase letters, numbers, and underscores only"),
  language: languageCode,
  category,
  parameter_format: z.enum(["named", "positional"]).optional(),
  components: z.array(z.record(z.unknown())).min(1).max(5),
  // Recommended by Meta: if the content doesn't match the chosen category,
  // Meta reclassifies it instead of outright rejecting the submission.
  // Defaults to true — opting out should be an explicit choice.
  allow_category_change: z.boolean().optional().default(true),
});

async function credentials(req: Request, phoneNumberId?: string) {
  if (phoneNumberId && !req.user?.assignedPhoneNumberIds.includes(phoneNumberId)) {
    throw new ApiError(403, "You don't have access to that WhatsApp number");
  }
  return phoneNumberId
    ? getWhatsappCredentialsByPhoneNumberId(phoneNumberId)
    : getDefaultWhatsappCredentials(req.user!.id);
}

// ---------------------------------------------------------------------------
// Component-level validation
// ---------------------------------------------------------------------------

type Comp = Record<string, unknown>;

function typeOf(c: Comp) {
  return String(c.type ?? "").toUpperCase();
}

/** Finds every {{1}} / {{name}} token in a piece of template text. */
function extractVariables(text: string): { positional: number[]; named: string[] } {
  const positional = new Set<number>();
  const named = new Set<string>();
  const re = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (/^\d+$/.test(m[1])) positional.add(Number(m[1]));
    else named.add(m[1]);
  }
  return { positional: [...positional].sort((a, b) => a - b), named: [...named] };
}

function assertBodyOrHeaderExample(
  label: "HEADER" | "BODY",
  text: string,
  paramFormat: "named" | "positional" | undefined,
  example: unknown,
) {
  const { positional, named } = extractVariables(text);
  if (positional.length === 0 && named.length === 0) return; // no variables, no example needed

  if (named.length > 0 && positional.length > 0) {
    throw new ApiError(400, `${label} text mixes named ({{name}}) and numbered ({{1}}) variables — use only one style`);
  }

  if (named.length > 0) {
    if (paramFormat !== "named") {
      throw new ApiError(400, `${label} uses named variables but parameter_format is not "named"`);
    }
    const ex = example as { body_text_named_params?: { param_name: string; example: string }[] } | undefined;
    const params = label === "BODY" ? ex?.body_text_named_params : undefined;
    if (label === "BODY") {
      if (!Array.isArray(params) || params.length !== named.length) {
        throw new ApiError(400, "BODY component needs example.body_text_named_params with one sample value per named variable");
      }
      const missing = named.filter((n) => !params.some((p) => p?.param_name === n));
      if (missing.length) throw new ApiError(400, `Missing example values for named variable(s): ${missing.join(", ")}`);
    }
    return;
  }

  // positional
  const expectedCount = positional[positional.length - 1];
  if (positional.some((n, i) => n !== i + 1)) {
    throw new ApiError(400, `${label} numbered variables must start at {{1}} and be sequential with no gaps`);
  }
  if (label === "BODY") {
    const ex = example as { body_text?: string[][] } | undefined;
    const sample = ex?.body_text?.[0];
    if (!Array.isArray(sample) || sample.length !== expectedCount) {
      throw new ApiError(400, `BODY component needs example.body_text: [[...]] with ${expectedCount} sample value(s)`);
    }
  } else {
    // HEADER only ever supports a single positional variable.
    const ex = example as { header_text?: string[] } | undefined;
    if (expectedCount !== 1) throw new ApiError(400, "HEADER text supports only a single {{1}} variable");
    if (!Array.isArray(ex?.header_text) || ex!.header_text.length !== 1) {
      throw new ApiError(400, "HEADER component needs example.header_text: [\"sample\"]");
    }
  }
}

function validateHeader(header: Comp) {
  const format = String(header.format ?? "").toUpperCase();
  if (!["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(format)) {
    throw new ApiError(400, "HEADER format must be TEXT, IMAGE, VIDEO, DOCUMENT, or LOCATION");
  }
  if (format === "TEXT") {
    if (typeof header.text !== "string" || !header.text.trim()) throw new ApiError(400, "HEADER text is required when format is TEXT");
    if (header.text.length > 60) throw new ApiError(400, "HEADER text must be 60 characters or fewer");
    assertBodyOrHeaderExample("HEADER", header.text, undefined, header.example);
  } else if (format === "LOCATION") {
    if (header.text !== undefined) throw new ApiError(400, "A LOCATION header does not take text");
  } else {
    // IMAGE / VIDEO / DOCUMENT — needs an upload handle from
    // POST /api/templates/header-media (uploadTemplateMedia) beforehand.
    const ex = header.example as { header_handle?: unknown[] } | undefined;
    if (!ex || !Array.isArray(ex.header_handle) || ex.header_handle.length !== 1 || !ex.header_handle[0]) {
      throw new ApiError(400, `${format} header needs example.header_handle: ["<handle>"] — upload the file via /api/templates/header-media first`);
    }
  }
}

function validateFooter(footer: Comp) {
  if (typeof footer.text !== "string" || !footer.text.trim()) throw new ApiError(400, "FOOTER text is required");
  if (footer.text.length > 60) throw new ApiError(400, "FOOTER text must be 60 characters or fewer");
  if (/{{\s*[a-zA-Z0-9_]+\s*}}/.test(footer.text)) throw new ApiError(400, "FOOTER text cannot contain variables");
}

function validateButtons(buttonsComp: Comp) {
  const buttons = buttonsComp.buttons;
  if (!Array.isArray(buttons) || buttons.length < 1) throw new ApiError(400, "BUTTONS component needs at least one button");
  if (buttons.length > 10) throw new ApiError(400, "A template supports a maximum of 10 buttons total");

  const counts: Record<string, number> = {};
  let lastType: string | null = null;
  let sawInterleave = false;

  for (const raw of buttons) {
    const btn = raw as Comp;
    const type = String(btn.type ?? "").toUpperCase();
    counts[type] = (counts[type] ?? 0) + 1;
    if (lastType && lastType !== type && buttons.some((b) => String((b as Comp).type).toUpperCase() === lastType && buttons.indexOf(b) > buttons.indexOf(raw))) {
      sawInterleave = true;
    }
    lastType = type;

    switch (type) {
      case "OTP":
        throw new ApiError(400, "OTP buttons are only allowed on AUTHENTICATION templates, and must be the template's only button");
      case "QUICK_REPLY":
        if (typeof btn.text !== "string" || !btn.text.trim() || btn.text.length > 25) {
          throw new ApiError(400, "QUICK_REPLY button text is required and must be 25 characters or fewer");
        }
        break;
      case "URL":
        if (typeof btn.text !== "string" || !btn.text.trim() || btn.text.length > 25) {
          throw new ApiError(400, "URL button text is required and must be 25 characters or fewer");
        }
        if (typeof btn.url !== "string" || !/^https:\/\/.+/.test(btn.url)) {
          throw new ApiError(400, "URL button requires a full https:// URL");
        }
        if (/{{\s*1\s*}}/.test(btn.url)) {
          const ex = btn.example;
          if (!Array.isArray(ex) || ex.length !== 1 || !ex[0]) {
            throw new ApiError(400, "A dynamic URL button ({{1}}) needs example: [\"sample-suffix\"]");
          }
        }
        break;
      case "PHONE_NUMBER":
        if (typeof btn.text !== "string" || !btn.text.trim() || btn.text.length > 25) {
          throw new ApiError(400, "PHONE_NUMBER button text is required and must be 25 characters or fewer");
        }
        if (typeof btn.phone_number !== "string" || btn.phone_number.length > 20) {
          throw new ApiError(400, "PHONE_NUMBER button requires a phone_number of 20 characters or fewer");
        }
        break;
      case "COPY_CODE":
        if (typeof btn.example !== "string" || !btn.example.trim() || btn.example.length > 15) {
          throw new ApiError(400, "COPY_CODE button needs example (sample code), 15 characters or fewer");
        }
        break;
      case "FLOW":
        if (!btn.flow_id && !btn.flow_name) throw new ApiError(400, "FLOW button requires flow_id (or flow_name)");
        break;
      default:
        throw new ApiError(400, `Unsupported button type: ${type || "(missing)"}`);
    }
  }

  if ((counts.PHONE_NUMBER ?? 0) > 1) throw new ApiError(400, "Only one PHONE_NUMBER button is allowed per template");
  if ((counts.URL ?? 0) > 2) throw new ApiError(400, "A maximum of two URL buttons is allowed per template");
  if ((counts.FLOW ?? 0) > 1) throw new ApiError(400, "Only one FLOW button is allowed per template");
  if ((counts.COPY_CODE ?? 0) > 1) throw new ApiError(400, "Only one COPY_CODE button is allowed per template");
  if (sawInterleave) throw new ApiError(400, "Buttons of the same type must be grouped together, not interleaved");
}

/** MARKETING / UTILITY templates. AUTHENTICATION has its own, stricter branch in createTemplate. */
function validateComponents(components: Comp[], parameterFormat: "named" | "positional" | undefined) {
  const order = ["HEADER", "BODY", "FOOTER", "BUTTONS"];
  let lastIndex = -1;
  for (const c of components) {
    const idx = order.indexOf(typeOf(c));
    if (idx === -1) throw new ApiError(400, `Unknown component type: ${typeOf(c) || "(missing)"}`);
    if (idx < lastIndex) throw new ApiError(400, "Components must be ordered HEADER, BODY, FOOTER, then BUTTONS");
    lastIndex = idx;
  }

  const byType = (t: string) => components.filter((c) => typeOf(c) === t);
  if (byType("HEADER").length > 1) throw new ApiError(400, "Only one HEADER component is allowed");
  if (byType("FOOTER").length > 1) throw new ApiError(400, "Only one FOOTER component is allowed");
  if (byType("BUTTONS").length > 1) throw new ApiError(400, "Only one BUTTONS component is allowed");

  const body = byType("BODY");
  if (body.length !== 1) throw new ApiError(400, "A template needs exactly one BODY component");
  if (typeof body[0].text !== "string" || !body[0].text.trim()) throw new ApiError(400, "BODY text is required");
  if ((body[0].text as string).length > 1024) throw new ApiError(400, "BODY text must be 1024 characters or fewer");
  assertBodyOrHeaderExample("BODY", body[0].text as string, parameterFormat, body[0].example);

  const header = byType("HEADER")[0];
  if (header) validateHeader(header);

  const footer = byType("FOOTER")[0];
  if (footer) validateFooter(footer);

  const buttons = byType("BUTTONS")[0];
  if (buttons) validateButtons(buttons);
}

/** AUTHENTICATION templates: Meta generates the body copy itself — you only send structure, no text. */
function validateAuthenticationComponents(components: Comp[]) {
  if (components.some((c) => typeOf(c) === "HEADER")) {
    throw new ApiError(400, "AUTHENTICATION templates do not support a HEADER component");
  }

  const body = components.filter((c) => typeOf(c) === "BODY");
  if (body.length !== 1) throw new ApiError(400, "A template needs exactly one BODY component");
  if (body[0].text !== undefined) throw new ApiError(400, "AUTHENTICATION templates must leave BODY text empty — Meta generates it");
  if (body[0].add_security_recommendation !== undefined && typeof body[0].add_security_recommendation !== "boolean") {
    throw new ApiError(400, "BODY add_security_recommendation must be a boolean");
  }

  const footers = components.filter((c) => typeOf(c) === "FOOTER");
  if (footers.length > 1) throw new ApiError(400, "Only one FOOTER component is allowed");
  if (footers[0]) {
    if (footers[0].text !== undefined) throw new ApiError(400, "AUTHENTICATION FOOTER cannot include text — Meta generates it");
    const mins = footers[0].code_expiration_minutes;
    if (mins !== undefined && (typeof mins !== "number" || mins < 1 || mins > 90)) {
      throw new ApiError(400, "FOOTER code_expiration_minutes must be a number between 1 and 90");
    }
  }

  const buttonsComp = components.find((c) => typeOf(c) === "BUTTONS") as { buttons?: unknown[] } | undefined;
  const otp = buttonsComp?.buttons?.[0] as Record<string, unknown> | undefined;
  if (!buttonsComp || !Array.isArray(buttonsComp.buttons) || buttonsComp.buttons.length !== 1 || otp?.type !== "OTP") {
    throw new ApiError(400, "AUTHENTICATION templates require exactly one BUTTONS component with a single OTP button");
  }
  if (!["COPY_CODE", "ONE_TAP", "ZERO_TAP"].includes(otp.otp_type as string)) {
    throw new ApiError(400, "Unsupported authentication OTP type — use COPY_CODE, ONE_TAP, or ZERO_TAP");
  }
  if (otp.otp_type === "ONE_TAP" || otp.otp_type === "ZERO_TAP") {
    // Android autofill requires the app's package name + APK signing-cert hash.
    if (!otp.package_name || !otp.signature_hash) {
      throw new ApiError(400, `${otp.otp_type} requires package_name and signature_hash for Android autofill`);
    }
  }
  if (otp.copy_code_button_text !== undefined && (typeof otp.copy_code_button_text !== "string" || (otp.copy_code_button_text as string).length > 25)) {
    throw new ApiError(400, "copy_code_button_text must be 25 characters or fewer");
  }

  const allowedTypes = new Set(["BODY", "FOOTER", "BUTTONS"]);
  if (components.some((c) => !allowedTypes.has(typeOf(c)))) {
    throw new ApiError(400, "AUTHENTICATION templates only support BODY, FOOTER, and BUTTONS components");
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const getDrafts = catchAsync(async (req: Request, res: Response) => {
  const drafts = await TemplateDraft.find({ createdBy: req.user!.id }).sort({ updatedAt: -1 });
  return ok(res, drafts.map((draft) => ({ ...draft.toObject(), id: draft._id.toString() })));
});

export const saveDraft = catchAsync(async (req: Request, res: Response) => {
  const body = templateSchema.partial({ components: true }).parse(req.body) as Partial<z.infer<typeof templateSchema>>;
  if (req.body.id) {
    const draft = await TemplateDraft.findOneAndUpdate(
      { _id: req.body.id, createdBy: req.user!.id },
      { ...body, createdBy: req.user!.id },
      { new: true },
    );
    if (!draft) throw new ApiError(404, "Draft not found");
    return ok(res, { ...draft.toObject(), id: draft._id.toString() }, "Draft saved");
  }
  const draft = await TemplateDraft.create({ ...body, createdBy: req.user!.id });
  return ok(res, { ...draft.toObject(), id: draft._id.toString() }, "Draft saved", 201);
});

export const deleteDraft = catchAsync(async (req: Request, res: Response) => {
  await TemplateDraft.deleteOne({ _id: req.params.id, createdBy: req.user!.id });
  return ok(res, null, "Draft deleted");
});

export const getTemplates = catchAsync(async (req: Request, res: Response) => {
  const creds = await credentials(req, req.query.phoneNumberId as string | undefined);
  if (!creds.wabaId) throw new ApiError(400, "The selected WhatsApp number has no WABA ID");
  return ok(res, await listMessageTemplates(creds.wabaId, creds.accessToken));
});

export const createTemplate = catchAsync(async (req: Request, res: Response) => {
  const body = templateSchema.parse(req.body);

  if (body.category === "AUTHENTICATION") {
    validateAuthenticationComponents(body.components);
  } else {
    validateComponents(body.components, body.parameter_format);
  }

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