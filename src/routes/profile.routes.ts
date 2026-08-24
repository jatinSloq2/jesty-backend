import { Router } from "express";
import multer from "multer";
import { getProfile, updateProfile, updateProfilePicture } from "../controllers/profile.controller";
import { requireAuth, requireServiceToken } from "../middleware/auth";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /profile:
 *   get:
 *     tags: [Profile]
 *     summary: Get WhatsApp Business profile (about, description, address, picture, etc.)
 *     responses: { 200: { description: Profile } }
 *   patch:
 *     tags: [Profile]
 *     summary: Update WhatsApp Business profile fields
 *     responses: { 200: { description: Updated } }
 */
router.get("/", getProfile);
router.patch("/", updateProfile);

/**
 * @openapi
 * /profile/picture:
 *   post:
 *     tags: [Profile]
 *     summary: Upload and set the WhatsApp Business profile picture
 *     description: >
 *       Media endpoint — in addition to the usual Bearer access token, this
 *       call must also include the `jesty-backend-service-token` header
 *       (see middleware/auth.ts#requireServiceToken).
 *     security:
 *       - bearerAuth: []
 *         serviceToken: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *               phoneNumberId: { type: string, description: "Defaults to the caller's default connected WhatsApp number" }
 *     responses: { 200: { description: Updated } }
 */
router.post("/picture", requireServiceToken, upload.single("file"), updateProfilePicture);

export default router;
