import { Router } from "express";
import multer from "multer";
import {
  searchMessages,
  forwardMessage,
  reactToMessage,
  removeReaction,
  sendMessage,
  sendMediaUpload,
} from "../controllers/message.controller";
import { requireAuth, requireServiceToken } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

// In-memory upload for media messages. The buffer is forwarded straight to
// Meta's /media endpoint inside sendMediaUpload, so we don't need to write
// the file to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB, matches Meta's documented cap
});

/**
 * @openapi
 * /messages:
 *   post:
 *     tags: [Inbox]
 *     summary: Send a message (text, hosted media, or template) via JSON
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [conversationId]
 *             properties:
 *               conversationId: { type: string }
 *               type: { type: string, enum: [text, image, video, audio, document, sticker, template] }
 *               text: { type: string }
 *               mediaUrl: { type: string, description: "Public HTTPS URL of the media" }
 *               mediaId: { type: string, description: "A Meta media id (skip the upload step)" }
 *               caption: { type: string }
 *               filename: { type: string }
 *               templateName: { type: string }
 *               languageCode: { type: string }
 *               replyToMessageId: { type: string }
 *     responses: { 201: { description: Message sent } }
 */
router.post("/", sendMessage);

/**
 * @openapi
 * /messages/upload:
 *   post:
 *     tags: [Inbox]
 *     summary: Send a media message by uploading the file (image/video/audio/document/sticker)
 *     description: |
 *       Multipart upload. Jesty uploads the file to Meta's
 *       `POST /{phone-number-id}/media` endpoint using the connected WhatsApp
 *       number's own access token (see models/Integration.ts), then sends the
 *       message referencing the returned media id. This is the same flow
 *       WhatsApp itself uses for in-app media.
 *
 *       Media endpoint — in addition to the usual Bearer access token, this
 *       call must also include the `jesty-backend-service-token` header
 *       (see middleware/auth.ts#requireServiceToken).
 *     security:
 *       - bearerAuth: []
 *         serviceToken: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [conversationId, type, file]
 *             properties:
 *               conversationId: { type: string }
 *               type: { type: string, enum: [image, video, audio, document, sticker] }
 *               caption: { type: string }
 *               filename: { type: string, description: "Required for document" }
 *               replyToMessageId: { type: string }
 *               file: { type: string, format: binary }
 *     responses: { 201: { description: Message sent } }
 */
router.post("/upload", requireServiceToken, upload.single("file"), sendMediaUpload);

/**
 * @openapi
 * /messages/search:
 *   get:
 *     tags: [Inbox]
 *     summary: Full-text search across all messages
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *     responses: { 200: { description: Matching messages } }
 */
router.get("/search", searchMessages);

/**
 * @openapi
 * /messages/{messageId}/forward:
 *   post:
 *     tags: [Inbox]
 *     summary: Forward a message's content to one or more other conversations
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [conversationIds]
 *             properties:
 *               conversationIds:
 *                 type: array
 *                 items: { type: string }
 *     responses: { 200: { description: Per-conversation forward results } }
 */
router.post("/:messageId/forward", forwardMessage);

/**
 * @openapi
 * /messages/{messageId}/react:
 *   post:
 *     tags: [Inbox]
 *     summary: Send an emoji reaction to a message
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [emoji]
 *             properties:
 *               emoji: { type: string, example: "👍" }
 *     responses: { 200: { description: Reaction sent } }
 *   delete:
 *     tags: [Inbox]
 *     summary: Remove our reaction from a message
 *     responses: { 200: { description: Reaction removed } }
 */
router.post("/:messageId/react", reactToMessage);
router.delete("/:messageId/react", removeReaction);

export default router;
