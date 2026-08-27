import { Router } from "express";
import multer from "multer";
import { createTemplate, draftTemplateWithAi, getTemplates, uploadTemplateHeader } from "../controllers/template.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
router.use(requireAuth);
router.get("/", getTemplates);
router.post("/", createTemplate);
router.post("/ai-draft", draftTemplateWithAi);
router.post("/header-media", upload.single("file"), uploadTemplateHeader);
export default router;
