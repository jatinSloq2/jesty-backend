import { Router } from "express";
import { receiveWebhook, verifyForwardSecret } from "../controllers/webhook.controller";

const router = Router();

/**
 * @openapi
 * /webhook:
 *   post:
 *     tags: [Webhook]
 *     summary: >
 *       Receives WhatsApp events FORWARDED from your other backend (which owns the
 *       real Meta webhook + verify-token handshake). Authenticated via the
 *       x-webhook-secret header, not Meta's hub.verify_token.
 *     parameters:
 *       - in: header
 *         name: x-webhook-secret
 *         required: true
 *         schema: { type: string }
 *     responses: { 200: { description: Always 200, processed async } }
 */
router.post("/", verifyForwardSecret, receiveWebhook);

export default router;
