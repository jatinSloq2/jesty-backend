import crypto from "crypto";
import { env } from "../config/env";

// AES-256-GCM helper used to encrypt/decrypt secret fields on the Integration
// model (access tokens, API keys, app secrets, etc — see models/Integration.ts).
// Uses the SAME ENCRYPTION_KEY convention as your other service so both can
// read each other's Integration documents.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV size for GCM

function getKey(): Buffer {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not configured — required to encrypt/decrypt Integration secrets");
  }
  // A 64-char hex string is used as-is (32 raw bytes); anything else is
  // hashed down to 32 bytes so any passphrase works too.
  if (env.ENCRYPTION_KEY.length === 64 && /^[0-9a-f]+$/i.test(env.ENCRYPTION_KEY)) {
    return Buffer.from(env.ENCRYPTION_KEY, "hex");
  }
  return crypto.createHash("sha256").update(env.ENCRYPTION_KEY).digest();
}

// Format: <iv>:<authTag>:<ciphertext>, all hex-encoded.
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decrypt(value: string): string {
  const parts = value.split(":");
  if (parts.length !== 3) return value; // not our format — return as-is defensively
  const [ivHex, authTagHex, dataHex] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    // Wrong/rotated ENCRYPTION_KEY, or corrupted data — surface as empty
    // rather than throwing inside a schema getter on every field access.
    return "";
  }
}
