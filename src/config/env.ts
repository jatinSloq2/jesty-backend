import dotenv from "dotenv";
dotenv.config();

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[env] Missing env var: ${key}`);
    return "";
  }
  return value;
}

export const env = {
  PORT: parseInt(required("PORT", "5000"), 10),
  NODE_ENV: required("NODE_ENV", "development"),
  FRONTEND_URL: required("FRONTEND_URL", "http://localhost:3000"),

  // ---- Primary MongoDB connection ----
  // Jesty's own operational data: Contact, Conversation, Message, Group, Tag,
  // Attribute, DeviceToken, UserSession (local login mirror). See config/db.ts.
  MONGO_URI: required("MONGO_URI", "mongodb://127.0.0.1:27017/jesty"),

  // ---- Second MongoDB connection (shared "auth" database) ----
  // Jesty now owns login itself instead of proxying to another service, and
  // reads/writes the SAME Users + IntegrationCredential collections your
  // other services already use. Point this at that shared database.
  // Falls back to MONGO_URI so the app still boots in a single-DB dev setup.
  AUTH_MONGO_URI: required("AUTH_MONGO_URI", required("MONGO_URI", "mongodb://127.0.0.1:27017/jesty")),

  // ---- Meta / WhatsApp Cloud API (Official App) ----
  WHATSAPP_API_VERSION: required("WHATSAPP_API_VERSION", "v25.0"),
  // These three are now OPTIONAL — a per-user WhatsApp number is normally
  // connected via POST /api/integrations/whatsapp (see models/Integration.ts)
  // and its own accessToken/phoneNumberId are used for that conversation.
  // Kept here only as a single-tenant fallback for local dev / back-compat.
  WHATSAPP_PHONE_NUMBER_ID: required("WHATSAPP_PHONE_NUMBER_ID", ""),
  WHATSAPP_BUSINESS_ACCOUNT_ID: required("WHATSAPP_BUSINESS_ACCOUNT_ID", ""),
  WHATSAPP_ACCESS_TOKEN: required("WHATSAPP_ACCESS_TOKEN", ""),
  WHATSAPP_WINDOW_HOURS: parseInt(required("WHATSAPP_WINDOW_HOURS", "24"), 10),

  // ---- Auth (owned locally now — email + password against the Users model
  // on the second/shared Mongo connection) ----
  JWT_ACCESS_SECRET: required("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: required("JWT_REFRESH_SECRET"),
  JWT_ACCESS_EXPIRES_IN: required("JWT_ACCESS_EXPIRES_IN", "15m"),
  JWT_REFRESH_EXPIRES_IN: required("JWT_REFRESH_EXPIRES_IN", "30d"),

  // ---- Inbox SSO (handoff from the other backend's "Open inbox" button) ----
  // The other backend mints a short-lived (2m) signed token — see that repo's
  // services/inboxSso.service.js — and redirects the browser to
  // FRONTEND_URL/sso/callback?token=... . POST /api/auth/sso verifies it
  // with this SAME secret and logs the matching user (by `sub`, the shared
  // Users._id) into Jesty exactly like a normal login. Must be identical on
  // both sides; a leak of this secret doesn't expose JWT_ACCESS_SECRET or
  // vice versa.
  INBOX_SSO_SECRET: required("INBOX_SSO_SECRET", ""),
  INBOX_SSO_AUDIENCE: required("INBOX_SSO_AUDIENCE", "jestbot-inbox"),
  INBOX_SSO_ISSUER: required("INBOX_SSO_ISSUER", "jestbot-backend"),

  // AES-256-GCM key used to encrypt/decrypt secret fields on the Integration
  // model (access tokens, API keys, etc — see utils/crypto.ts). Use the SAME
  // value your other service uses so both can read each other's Integration
  // documents. Accepts a 64-char hex string, or any passphrase (hashed down
  // to 32 bytes).
  ENCRYPTION_KEY: required("ENCRYPTION_KEY", ""),

  // Shared static token required on Jesty's media-handling endpoints
  // (POST /api/messages/upload, POST /api/profile/picture) via the
  // `jesty-backend-service-token` header — see middleware/auth.ts#requireServiceToken.
  JESTY_BACKEND_SERVICE_TOKEN: required("JESTY_BACKEND_SERVICE_TOKEN", ""),

  // Shared secret your other service must send as `x-webhook-secret` when forwarding
  // Meta webhook events to POST /api/webhook.
  INTERNAL_WEBHOOK_SECRET: required("INTERNAL_WEBHOOK_SECRET", ""),

  // ---- Firebase Cloud Messaging (push notifications when an agent is offline) ----
  FIREBASE_PROJECT_ID: required("FIREBASE_PROJECT_ID", ""),
  FIREBASE_CLIENT_EMAIL: required("FIREBASE_CLIENT_EMAIL", ""),
  // Paste the private key from the service-account JSON. Keep the literal "\n" sequences;
  // they're converted to real newlines in fcm.service.ts.
  FIREBASE_PRIVATE_KEY: required("FIREBASE_PRIVATE_KEY", ""),
};