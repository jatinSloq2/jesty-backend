import { Router } from "express";
import authRoutes from "./auth.routes";
import contactRoutes from "./contact.routes";
import tagRoutes from "./tag.routes";
import groupRoutes from "./group.routes";
import attributeRoutes from "./attribute.routes";
import conversationRoutes from "./conversation.routes";
import messageRoutes from "./message.routes";
import webhookRoutes from "./webhook.routes";
import profileRoutes from "./profile.routes";
import notificationRoutes from "./notification.routes";
import integrationRoutes from "./integration.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/integrations", integrationRoutes);
router.use("/contacts", contactRoutes);
router.use("/tags", tagRoutes);
router.use("/groups", groupRoutes);
router.use("/attributes", attributeRoutes);
router.use("/conversations", conversationRoutes);
router.use("/messages", messageRoutes);
router.use("/webhook", webhookRoutes);
router.use("/profile", profileRoutes);
router.use("/notifications", notificationRoutes);

export default router;
