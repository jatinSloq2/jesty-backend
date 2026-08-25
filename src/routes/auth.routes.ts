import { Router } from "express";
import { login, refresh, me, logout, ssoLogin } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email + password, checked directly against the Users model (second/shared Mongo connection)
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: "agent@company.com" }
 *               password: { type: string, example: "••••••••" }
 *     responses:
 *       200:
 *         description: >
 *           Logged in — accessToken + refreshToken issued by Jesty itself, plus the
 *           WhatsApp numbers (assignedPhoneNumberIds) this user has connected via
 *           /api/integrations/whatsapp
 *       401: { description: Invalid email or password }
 */
router.post("/login", login);

/**
 * @openapi
 * /auth/sso:
 *   post:
 *     tags: [Auth]
 *     summary: Log in via the short-lived SSO handoff token from FRONTEND_URL/sso/callback?token=... (the other backend's "Open inbox" button)
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Logged in — same response shape as /auth/login
 *       401: { description: Invalid, expired, or unrecognized SSO token }
 */
router.post("/sso", ssoLogin);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new access token
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string, description: "Optional if sent as an httpOnly cookie" }
 *     responses:
 *       200: { description: New access + refresh token issued }
 *       401: { description: Refresh token invalid or expired }
 */
router.post("/refresh", refresh);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the current logged-in user (mirrored locally from the Users model)
 *     responses:
 *       200: { description: Current user }
 */
router.get("/me", requireAuth, me);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke the refresh token and clear auth cookies
 *     responses:
 *       200: { description: Logged out }
 */
router.post("/logout", requireAuth, logout);

export default router;