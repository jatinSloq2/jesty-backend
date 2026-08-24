import { Router } from "express";
import {
  listConversations,
  getConversation,
  updateConversation,
  markConversationRead,
} from "../controllers/conversation.controller";
import { listMessages, sendMessageInConversation } from "../controllers/message.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /conversations:
 *   get:
 *     tags: [Inbox]
 *     summary: List conversations (the WhatsApp-style inbox), each flagged with canSendFreeform (24h window)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, pending, closed] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: phoneNumberId
 *         schema: { type: string }
 *         description: Channel selector — scope the inbox to one connected WhatsApp number (must be one of the caller's assignedPhoneNumberIds). Omit to see all connected numbers together.
 *     responses: { 200: { description: Paginated conversations } }
 */
router.get("/", listConversations);

/**
 * @openapi
 * /conversations/{id}:
 *   get:
 *     tags: [Inbox]
 *     summary: Get one conversation
 *     responses: { 200: { description: Conversation } }
 *   patch:
 *     tags: [Inbox]
 *     summary: Update conversation status
 *     responses: { 200: { description: Updated } }
 */
router.get("/:id", getConversation);
router.patch("/:id", updateConversation);

/**
 * @openapi
 * /conversations/{id}/read:
 *   post:
 *     tags: [Inbox]
 *     summary: Mark conversation as read (resets unread count)
 *     responses: { 200: { description: Updated } }
 */
router.post("/:id/read", markConversationRead);

/**
 * @openapi
 * /conversations/{conversationId}/messages:
 *   get:
 *     tags: [Inbox]
 *     summary: List messages in a conversation (paginated, oldest->newest)
 *     responses: { 200: { description: Messages } }
 *   post:
 *     tags: [Inbox]
 *     summary: Send a message. Blocked outside the 24h window unless type=template.
 *     responses:
 *       201: { description: Sent }
 *       403: { description: Outside 24h window - use a template }
 */
router.get("/:conversationId/messages", listMessages);
router.post("/:conversationId/messages", sendMessageInConversation);

export default router;
