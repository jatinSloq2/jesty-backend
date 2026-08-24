import mongoose from "mongoose";
import { env } from "./env";

// ---------------------------------------------------------------------------
// Jesty now talks to TWO MongoDB connections:
//
//  1) the DEFAULT mongoose connection (env.MONGO_URI) — Jesty's own
//     operational data: Contact, Conversation, Message, Group, Tag,
//     Attribute, DeviceToken, UserSession (the local login mirror).
//
//  2) `authConnection` (env.AUTH_MONGO_URI) — the shared database that also
//     backs your other services: the Users collection and the Integration
//     (per-channel credentials, e.g. WhatsApp numbers) collection. Models
//     bound to this connection live in models/User.ts and
//     models/Integration.ts and are created with `authConnection.model(...)`
//     instead of the default `mongoose.model(...)`.
// ---------------------------------------------------------------------------

export const authConnection = mongoose.createConnection(env.AUTH_MONGO_URI);

authConnection.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[db] auth/shared MongoDB connection error", err);
});

export async function connectDB(): Promise<void> {
  mongoose.set("strictQuery", true);

  try {
    await mongoose.connect(env.MONGO_URI);
    // eslint-disable-next-line no-console
    console.log(`[db] MongoDB connected (jesty) -> ${mongoose.connection.name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[db] MongoDB connection failed (jesty)", err);
    process.exit(1);
  }

  mongoose.connection.on("disconnected", () => {
    // eslint-disable-next-line no-console
    console.warn("[db] MongoDB disconnected (jesty)");
  });

  try {
    await authConnection.asPromise();
    // eslint-disable-next-line no-console
    console.log(`[db] MongoDB connected (auth/shared) -> ${authConnection.name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[db] MongoDB connection failed (auth/shared)", err);
    process.exit(1);
  }

  authConnection.on("disconnected", () => {
    // eslint-disable-next-line no-console
    console.warn("[db] MongoDB disconnected (auth/shared)");
  });
}
