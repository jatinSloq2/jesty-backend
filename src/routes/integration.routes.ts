import { Router } from "express";
import {
  listWhatsappIntegrations,
  connectWhatsappIntegration,
  updateWhatsappIntegration,
  removeWhatsappIntegration,
} from "../controllers/integration.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /integrations/whatsapp:
 *   get:
 *     tags: [Integrations]
 *     summary: List every WhatsApp number connected to the current login
 *     description: >
 *       One Jesty login can maintain multiple WhatsApp numbers at once — each
 *       is its own Integration document (channel "whatsapp") owned by this
 *       user. accessToken/appSecret are never returned.
 *     responses: { 200: { description: Connected WhatsApp numbers } }
 *   post:
 *     tags: [Integrations]
 *     summary: Connect a new WhatsApp number to the current login
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNumber, phoneNumberId, wabaId, appId, accessToken]
 *             properties:
 *               label: { type: string, example: "Support number" }
 *               phoneNumber: { type: string, example: "+919876543210" }
 *               phoneNumberId: { type: string, description: "Meta phone_number_id" }
 *               wabaId: { type: string, description: "Meta WhatsApp Business Account id" }
 *               appId: { type: string, description: "Meta App id used to verify inbound webhook signatures" }
 *               appSecret: { type: string }
 *               accessToken: { type: string, description: "System User / permanent access token for this number" }
 *               tokenType: { type: string, enum: [temporary, permanent] }
 *               isDefault: { type: boolean }
 *     responses: { 201: { description: WhatsApp number connected } }
 */
router.get("/whatsapp", listWhatsappIntegrations);
router.post("/whatsapp", connectWhatsappIntegration);

/**
 * @openapi
 * /integrations/whatsapp/{id}:
 *   patch:
 *     tags: [Integrations]
 *     summary: Update a connected WhatsApp number (rename, rotate token, activate/deactivate, set as default)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label: { type: string }
 *               isActive: { type: boolean }
 *               isDefault: { type: boolean }
 *               accessToken: { type: string }
 *               appSecret: { type: string }
 *               tokenType: { type: string, enum: [temporary, permanent] }
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Integrations]
 *     summary: Disconnect a WhatsApp number from the current login
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses: { 200: { description: Disconnected } }
 */
router.patch("/whatsapp/:id", updateWhatsappIntegration);
router.delete("/whatsapp/:id", removeWhatsappIntegration);

export default router;
