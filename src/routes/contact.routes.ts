import { Router } from "express";
import {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  setBlocked,
} from "../controllers/contact.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /contacts:
 *   get:
 *     tags: [Contacts]
 *     summary: List / search contacts (filter by tag, group)
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: tag
 *         schema: { type: string }
 *       - in: query
 *         name: group
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Paginated list of contacts }
 *   post:
 *     tags: [Contacts]
 *     summary: Create a contact
 *     responses:
 *       201: { description: Contact created }
 */
router.get("/", listContacts);
router.post("/", createContact);

/**
 * @openapi
 * /contacts/{id}:
 *   get:
 *     tags: [Contacts]
 *     summary: Get a contact by id
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Contact } }
 *   patch:
 *     tags: [Contacts]
 *     summary: Update a contact
 *     responses: { 200: { description: Updated contact } }
 *   delete:
 *     tags: [Contacts]
 *     summary: Delete a contact
 *     responses: { 200: { description: Deleted } }
 */
router.get("/:id", getContact);
router.patch("/:id", updateContact);
router.delete("/:id", deleteContact);

/**
 * @openapi
 * /contacts/{id}/block:
 *   post:
 *     tags: [Contacts]
 *     summary: Block or unblock a contact
 *     responses: { 200: { description: Updated } }
 */
router.post("/:id/block", setBlocked);

export default router;
