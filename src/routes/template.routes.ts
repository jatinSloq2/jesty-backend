import { Router } from "express";
import multer from "multer";
import { createTemplate, deleteDraft, getDrafts, getTemplates, saveDraft, uploadTemplateHeader } from "../controllers/template.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
router.use(requireAuth);

/**
 * @swagger
 * tags:
 *   name: Templates
 *   description: >
 *     WhatsApp Message Templates — create, list, and locally draft templates
 *     that go through Meta's Message Templates API for review/approval.
 *     Every write endpoint validates against Meta's official component rules
 *     before calling Graph, so a 400 here means it would have failed at Meta
 *     anyway (wrong category, missing example, bad button combo, etc).
 *
 * components:
 *   schemas:
 *     TemplateButton:
 *       type: object
 *       required: [type]
 *       properties:
 *         type:
 *           type: string
 *           enum: [QUICK_REPLY, URL, PHONE_NUMBER, COPY_CODE, FLOW, OTP]
 *         text:
 *           type: string
 *           maxLength: 25
 *           description: Required for QUICK_REPLY, URL, PHONE_NUMBER. Max 25 characters.
 *         url:
 *           type: string
 *           description: Required for URL buttons. Must be a full https:// URL.
 *         example:
 *           description: >
 *             Sample value(s) required when the button contains a variable.
 *             A dynamic URL button ({{1}} in `url`) needs `example: ["sample-suffix"]`.
 *             A COPY_CODE button needs `example: "SAMPLECODE"` (string, max 15 chars).
 *           oneOf:
 *             - type: array
 *               items: { type: string }
 *             - type: string
 *         phone_number:
 *           type: string
 *           maxLength: 20
 *           description: Required for PHONE_NUMBER buttons.
 *         flow_id:
 *           type: string
 *           description: Required for FLOW buttons (or flow_name).
 *         flow_name:
 *           type: string
 *         otp_type:
 *           type: string
 *           enum: [COPY_CODE, ONE_TAP, ZERO_TAP]
 *           description: Required for OTP buttons (AUTHENTICATION templates only).
 *         copy_code_button_text:
 *           type: string
 *           maxLength: 25
 *         package_name:
 *           type: string
 *           description: Required when otp_type is ONE_TAP or ZERO_TAP (Android autofill).
 *         signature_hash:
 *           type: string
 *           description: Required when otp_type is ONE_TAP or ZERO_TAP (Android autofill).
 *
 *     TemplateComponent:
 *       type: object
 *       required: [type]
 *       description: >
 *         One of HEADER, BODY, FOOTER, or BUTTONS. Components must appear in
 *         that order. Each template needs exactly one BODY; HEADER, FOOTER,
 *         and BUTTONS are each optional and limited to one occurrence.
 *         AUTHENTICATION templates only allow BODY, FOOTER, and a single
 *         BUTTONS component containing one OTP button — no HEADER, and BODY
 *         text must be omitted entirely (Meta generates the copy).
 *       properties:
 *         type:
 *           type: string
 *           enum: [HEADER, BODY, FOOTER, BUTTONS]
 *         format:
 *           type: string
 *           enum: [TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION]
 *           description: HEADER only. TEXT max 60 chars, one {{1}} variable max.
 *         text:
 *           type: string
 *           description: >
 *             Required for BODY (max 1024 chars) and FOOTER (max 60 chars,
 *             no variables allowed). Required for HEADER when format is TEXT.
 *             Must be omitted for AUTHENTICATION BODY/FOOTER.
 *         example:
 *           type: object
 *           description: >
 *             Sample values for any {{1}}/{{name}} variables in this
 *             component's text — required whenever variables are present.
 *           properties:
 *             body_text:
 *               type: array
 *               items: { type: array, items: { type: string } }
 *               description: BODY positional example, e.g. [["John", "12345"]] for {{1}}, {{2}}.
 *             body_text_named_params:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   param_name: { type: string }
 *                   example: { type: string }
 *               description: BODY named-variable example (parameter_format = "named").
 *             header_text:
 *               type: array
 *               items: { type: string }
 *               maxItems: 1
 *               description: HEADER text example, e.g. ["Order #1234"] for its single {{1}}.
 *             header_handle:
 *               type: array
 *               items: { type: string }
 *               maxItems: 1
 *               description: Media HEADER handle from POST /api/templates/header-media.
 *         add_security_recommendation:
 *           type: boolean
 *           description: AUTHENTICATION BODY only. Adds Meta's "don't share this code" line.
 *         code_expiration_minutes:
 *           type: number
 *           minimum: 1
 *           maximum: 90
 *           description: AUTHENTICATION FOOTER only.
 *         buttons:
 *           type: array
 *           maxItems: 10
 *           items:
 *             $ref: '#/components/schemas/TemplateButton'
 *
 *     TemplateCreateRequest:
 *       type: object
 *       required: [name, language, category, components]
 *       properties:
 *         phoneNumberId:
 *           type: string
 *           description: Which connected WhatsApp number's WABA to create this template under. Omit to use your default number.
 *         name:
 *           type: string
 *           pattern: '^[a-z0-9_]{1,512}$'
 *           description: Lowercase letters, numbers, and underscores only.
 *         language:
 *           type: string
 *           pattern: '^[a-z]{2,3}(_[A-Z]{2})?$'
 *           example: en_US
 *           description: Meta-supported language code (e.g. en, en_US, pt_BR).
 *         category:
 *           type: string
 *           enum: [MARKETING, UTILITY, AUTHENTICATION]
 *         parameter_format:
 *           type: string
 *           enum: [named, positional]
 *           description: Required if any component uses {{name}} style variables.
 *         allow_category_change:
 *           type: boolean
 *           default: true
 *           description: If content doesn't match the chosen category, let Meta reclassify instead of rejecting.
 *         components:
 *           type: array
 *           minItems: 1
 *           maxItems: 5
 *           items:
 *             $ref: '#/components/schemas/TemplateComponent'
 *
 *     TemplateDraft:
 *       allOf:
 *         - $ref: '#/components/schemas/TemplateCreateRequest'
 *         - type: object
 *           properties:
 *             id:
 *               type: string
 *               description: Present on saved drafts; include it in the body of POST /drafts to update instead of create.
 *
 *     ApiErrorResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: false }
 *         message: { type: string, example: "BODY text must be 1024 characters or fewer" }
 */

/**
 * @swagger
 * /templates:
 *   get:
 *     summary: List message templates from Meta
 *     description: >
 *       Fetches the live list of templates (with current status, quality
 *       score, and rejected_reason) from Meta for the selected WhatsApp
 *       number's WABA. This is NOT the local drafts list — see /templates/drafts for that.
 *     tags: [Templates]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: phoneNumberId
 *         schema: { type: string }
 *         description: Connected WhatsApp number to read templates for. Omit to use your default number.
 *     responses:
 *       200:
 *         description: Templates returned by Meta.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: OK }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       name: { type: string }
 *                       language: { type: string }
 *                       status: { type: string, enum: [PENDING, APPROVED, REJECTED, PAUSED, DISABLED] }
 *                       category: { type: string }
 *                       quality_score: { type: object }
 *                       rejected_reason: { type: string }
 *       400:
 *         description: The selected WhatsApp number has no WABA ID configured.
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 *       403:
 *         description: You don't have access to that WhatsApp number.
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 *   post:
 *     summary: Submit a new message template to Meta for review
 *     description: >
 *       Validates the template against Meta's component rules for the chosen
 *       category (see TemplateComponent schema) before submitting to Meta.
 *       On success the template is PENDING until Meta reviews it — poll
 *       GET /templates to see status changes.
 *     tags: [Templates]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TemplateCreateRequest'
 *           examples:
 *             utilityTemplate:
 *               summary: UTILITY template with a positional body variable
 *               value:
 *                 name: order_shipped
 *                 language: en_US
 *                 category: UTILITY
 *                 components:
 *                   - type: BODY
 *                     text: "Hi {{1}}, your order has shipped!"
 *                     example: { body_text: [["Alex"]] }
 *             authenticationTemplate:
 *               summary: AUTHENTICATION template with a COPY_CODE OTP button
 *               value:
 *                 name: login_otp
 *                 language: en
 *                 category: AUTHENTICATION
 *                 components:
 *                   - type: BODY
 *                   - type: BUTTONS
 *                     buttons:
 *                       - type: OTP
 *                         otp_type: COPY_CODE
 *     responses:
 *       201:
 *         description: Template submitted to Meta for review.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Template submitted to Meta for review" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     status: { type: string, example: PENDING }
 *                     category: { type: string }
 *       400:
 *         description: Validation failed — either the request body is malformed or it would violate one of Meta's template rules (see message for specifics).
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 *       403:
 *         description: You don't have access to that WhatsApp number.
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 */
router.get("/", getTemplates);

/**
 * @swagger
 * /templates/drafts:
 *   get:
 *     summary: List your locally saved template drafts
 *     description: Drafts are stored in Jesty only — they are never sent to Meta until POST /templates is called.
 *     tags: [Templates]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Your drafts, most recently updated first.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: OK }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/TemplateDraft' }
 *   post:
 *     summary: Create or update a template draft
 *     description: Include `id` in the body to update an existing draft you own; omit it to create a new one. Unlike POST /templates, a draft's components are NOT validated against Meta's rules, so it can be saved incomplete.
 *     tags: [Templates]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TemplateDraft'
 *     responses:
 *       201:
 *         description: New draft created.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Draft saved" }
 *                 data: { $ref: '#/components/schemas/TemplateDraft' }
 *       200:
 *         description: Existing draft updated.
 *       404:
 *         description: No draft with that id belongs to you.
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 */
router.get("/drafts", getDrafts);
router.post("/drafts", saveDraft);

/**
 * @swagger
 * /templates/drafts/{id}:
 *   delete:
 *     summary: Delete a template draft
 *     tags: [Templates]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Draft deleted (also returns 200 if it never existed or belonged to someone else — this endpoint doesn't leak that distinction).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Draft deleted" }
 *                 data: { nullable: true, example: null }
 */
router.delete("/drafts/:id", deleteDraft);

router.post("/", createTemplate);

/**
 * @swagger
 * /templates/header-media:
 *   post:
 *     summary: Upload media for a template's IMAGE/VIDEO/DOCUMENT header
 *     description: >
 *       Returns Meta's resumable-upload handle (e.g. "4::..."). Pass this
 *       handle as `example.header_handle: ["<handle>"]` on the HEADER
 *       component when calling POST /templates. This is a DIFFERENT
 *       endpoint/handle format than sending media in a live message
 *       (POST /messages/upload uses /media, not this resumable-upload flow).
 *     tags: [Templates]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               phoneNumberId:
 *                 type: string
 *                 description: Connected WhatsApp number whose Meta App ID is used for the upload session. Omit to use your default number.
 *     responses:
 *       200:
 *         description: Upload handle to reference in the template's HEADER example.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Template media uploaded" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     handle: { type: string, example: "4::abc123..." }
 *       400:
 *         description: file is required, or the selected WhatsApp number has no Meta App ID configured.
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 */
router.post("/header-media", upload.single("file"), uploadTemplateHeader);

export default router;