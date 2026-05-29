import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "crypto";

const ROOT_SECRET =
  process.env.ENCRYPTION_ROOT_SECRET ?? "dev-field-encryption-secret-change-me-32ch";
const ENC_PREFIX = "enc:v1:";

function deriveUserKey(userId: string): Buffer {
  const ikm = Buffer.from(ROOT_SECRET, "utf8");
  const salt = Buffer.from(userId, "utf8");
  const info = Buffer.from("mm-field-v1", "utf8");
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, 32));
}

/**
 * Encrypt a field value with a per-user HKDF-derived AES-256-GCM key.
 * Output format: "enc:v1:" + base64(iv[12] || tag[16] || ciphertext)
 */
export function encryptField(userId: string, plaintext: string): string {
  const key = deriveUserKey(userId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypt a field encrypted by encryptField.
 * If the value does not start with the "enc:v1:" prefix it is assumed
 * to be legacy plaintext and returned as-is (migration-safe).
 */
export function decryptField(userId: string, encoded: string): string {
  if (!encoded.startsWith(ENC_PREFIX)) return encoded;
  const buf = Buffer.from(encoded.slice(ENC_PREFIX.length), "base64");
  const key = deriveUserKey(userId);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct).toString("utf8") + decipher.final("utf8");
}

/** Returns true if the string was encrypted by encryptField. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

/** SHA-256 hex digest — used as a stable lookup key for MCP tokens and device tokens. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
