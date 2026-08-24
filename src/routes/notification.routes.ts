import { Router } from "express";
import { registerDeviceToken, unregisterDeviceToken } from "../controllers/notification.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /notifications/device-token:
 *   post:
 *     tags: [Notifications]
 *     summary: Register an FCM device token for push notifications
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *               platform: { type: string, enum: [web, android, ios] }
 *     responses: { 200: { description: Registered } }
 *   delete:
 *     tags: [Notifications]
 *     summary: Unregister an FCM device token (e.g. on logout)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses: { 200: { description: Unregistered } }
 */
router.post("/device-token", registerDeviceToken);
router.delete("/device-token", unregisterDeviceToken);

export default router;
