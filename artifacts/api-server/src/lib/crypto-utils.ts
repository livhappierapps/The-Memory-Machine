import { createHmac, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-me";

function deriveKey(salt: Buffer): Buffer {
  return scryptSync(SESSION_SECRET, salt, 32);
}

export function encryptText(plaintext: string): string {
  const salt = randomBytes(16);
  const key = deriveKey(salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString("base64");
}

export function decryptText(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const encrypted = buf.subarray(44);
  const key = deriveKey(salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

export function signToken(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
}

export function verifySignedToken(payload: string, sig: string): boolean {
  const expected = createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return expected === sig;
}

export function generateOtp(): string {
  const n = Number(randomBytes(3).readUIntBE(0, 3)) % 1000000;
  return n.toString().padStart(6, "0");
}
