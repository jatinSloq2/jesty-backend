import { Router } from "express";
import {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  updateMembers,
} from "../controllers/group.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /groups:
 *   get:
 *     tags: [Groups]
 *     summary: List all contact groups
 *     responses: { 200: { description: List of groups } }
 *   post:
 *     tags: [Groups]
 *     summary: Create a group
 *     responses: { 201: { description: Group created } }
 */
router.get("/", listGroups);
router.post("/", createGroup);

/**
 * @openapi
 * /groups/{id}:
 *   get:
 *     tags: [Groups]
 *     summary: Get a group with its members
 *     responses: { 200: { description: Group } }
 *   patch:
 *     tags: [Groups]
 *     summary: Update a group
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     tags: [Groups]
 *     summary: Delete a group
 *     responses: { 200: { description: Deleted } }
 */
router.get("/:id", getGroup);
router.patch("/:id", updateGroup);
router.delete("/:id", deleteGroup);

/**
 * @openapi
 * /groups/{id}/members:
 *   post:
 *     tags: [Groups]
 *     summary: Add/remove contacts from a group
 *     responses: { 200: { description: Updated group } }
 */
router.post("/:id/members", updateMembers);

export default router;
