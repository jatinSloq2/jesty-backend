import { Router } from "express";
import { listTags, createTag, updateTag, deleteTag } from "../controllers/tag.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /tags:
 *   get:
 *     tags: [Tags]
 *     summary: List all tags
 *     responses: { 200: { description: List of tags } }
 *   post:
 *     tags: [Tags]
 *     summary: Create a tag
 *     responses: { 201: { description: Tag created } }
 */
router.get("/", listTags);
router.post("/", createTag);

/**
 * @openapi
 * /tags/{id}:
 *   patch:
 *     tags: [Tags]
 *     summary: Update a tag
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Tags]
 *     summary: Delete a tag
 *     responses: { 200: { description: Deleted } }
 */
router.patch("/:id", updateTag);
router.delete("/:id", deleteTag);

export default router;
