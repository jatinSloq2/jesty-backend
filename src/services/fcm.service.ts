import admin from "firebase-admin";
import { env } from "../config/env";
import { DeviceToken } from "../models/DeviceToken";

let app: admin.app.App | null = null;

function getApp(): admin.app.App | null {
  if (app) return app;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    // Not configured yet — push notifications are a no-op until env vars are set.
    return null;
  }
  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
  return app;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Sends a push to every device token registered by this user, pruning any
// tokens Firebase reports as dead (uninstalled app, expired registration, etc.)
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const fcmApp = getApp();
  if (!fcmApp) return;

  const tokens = await DeviceToken.find({ user: userId }).distinct("token");
  if (!tokens.length) return;

  await sendPushToTokens(tokens, payload);
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  const fcmApp = getApp();
  if (!fcmApp || !userIds.length) return;

  const tokens = await DeviceToken.find({ user: { $in: userIds } }).distinct("token");
  if (!tokens.length) return;

  await sendPushToTokens(tokens, payload);
}

export async function sendPushToTokens(tokens: string[], payload: PushPayload): Promise<void> {
  const fcmApp = getApp();
  if (!fcmApp || !tokens.length) return;

  const response = await admin.messaging(fcmApp).sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data || {},
  });

  const deadTokens: string[] = [];
  response.responses.forEach((r, i) => {
    if (!r.success && (r.error?.code === "messaging/registration-token-not-registered" || r.error?.code === "messaging/invalid-registration-token")) {
      deadTokens.push(tokens[i]);
    }
  });

  if (deadTokens.length) {
    await DeviceToken.deleteMany({ token: { $in: deadTokens } });
  }
}
