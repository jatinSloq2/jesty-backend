import { Router } from "express";
import multer from "multer";
import { createTemplate, deleteDraft, getDrafts, getTemplates, saveDraft, uploadTemplateHeader } from "../controllers/template.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
router.use(requireAuth);
router.get("/", getTemplates);
router.get("/drafts", getDrafts);
router.post("/drafts", saveDraft);
router.delete("/drafts/:id", deleteDraft);
router.post("/", createTemplate);
router.post("/header-media", upload.single("file"), uploadTemplateHeader);
export default router;
