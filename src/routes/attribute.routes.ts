import { Router } from "express";
import {
  listAttributes,
  createAttribute,
  updateAttribute,
  deleteAttribute,
} from "../controllers/attribute.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /attributes:
 *   get:
 *     tags: [Attributes]
 *     summary: List custom contact attribute definitions
 *     responses: { 200: { description: List } }
 *   post:
 *     tags: [Attributes]
 *     summary: Create a custom attribute definition
 *     responses: { 201: { description: Created } }
 */
router.get("/", listAttributes);
router.post("/", createAttribute);

/**
 * @openapi
 * /attributes/{id}:
 *   patch:
 *     tags: [Attributes]
 *     summary: Update an attribute definition
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Attributes]
 *     summary: Delete an attribute definition
 *     responses: { 200: { description: Deleted } }
 */
router.patch("/:id", updateAttribute);
router.delete("/:id", deleteAttribute);

export default router;
