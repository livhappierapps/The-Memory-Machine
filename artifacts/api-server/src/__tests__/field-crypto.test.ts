import { describe, it, expect } from "vitest";
import {
  encryptField,
  decryptField,
  isEncrypted,
  sha256Hex,
} from "../lib/field-crypto.js";

const ENC_PREFIX = "enc:v1:";
const USER_A = "user_test_alice";
const USER_B = "user_test_bob";

describe("encryptField", () => {
  it("returns a string with the enc:v1: prefix", () => {
    const result = encryptField(USER_A, "hello world");
    expect(result.startsWith(ENC_PREFIX)).toBe(true);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const a = encryptField(USER_A, "same plaintext");
    const b = encryptField(USER_A, "same plaintext");
    expect(a).not.toBe(b);
  });

  it("encrypts empty string without throwing", () => {
    const result = encryptField(USER_A, "");
    expect(result.startsWith(ENC_PREFIX)).toBe(true);
  });

  it("encrypts unicode content", () => {
    const plaintext = "こんにちは世界 🔒";
    const encrypted = encryptField(USER_A, plaintext);
    expect(encrypted.startsWith(ENC_PREFIX)).toBe(true);
    expect(decryptField(USER_A, encrypted)).toBe(plaintext);
  });
});

describe("decryptField (round-trip)", () => {
  it("decrypts back to the original plaintext", () => {
    const plaintext = "The quick brown fox jumps over the lazy dog";
    const encrypted = encryptField(USER_A, plaintext);
    expect(decryptField(USER_A, encrypted)).toBe(plaintext);
  });

  it("round-trips a long message", () => {
    const plaintext = "A".repeat(10_000);
    const encrypted = encryptField(USER_A, plaintext);
    const decrypted = decryptField(USER_A, encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("round-trips an empty string", () => {
    const encrypted = encryptField(USER_A, "");
    expect(decryptField(USER_A, encrypted)).toBe("");
  });

  it("returns legacy plaintext unchanged (no enc:v1: prefix)", () => {
    const legacy = "this was stored before encryption was introduced";
    expect(decryptField(USER_A, legacy)).toBe(legacy);
  });

  it("decrypted value does NOT start with enc:v1:", () => {
    const plaintext = "sensitive conversation content";
    const encrypted = encryptField(USER_A, plaintext);
    const decrypted = decryptField(USER_A, encrypted);
    expect(decrypted.startsWith(ENC_PREFIX)).toBe(false);
  });

  it("throws (GCM auth tag failure) when decrypted with wrong user key", () => {
    const encrypted = encryptField(USER_A, "secret");
    expect(() => decryptField(USER_B, encrypted)).toThrow();
  });

  it("handles multiple round-trips independently", () => {
    const values = ["first", "second", "third"];
    for (const v of values) {
      expect(decryptField(USER_A, encryptField(USER_A, v))).toBe(v);
    }
  });
});

describe("isEncrypted", () => {
  it("returns true for enc:v1: prefixed values", () => {
    const enc = encryptField(USER_A, "test");
    expect(isEncrypted(enc)).toBe(true);
  });

  it("returns false for plaintext values", () => {
    expect(isEncrypted("plain text")).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted("enc:v2:something")).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("returns a 64-character hex string", () => {
    const h = sha256Hex("some-device-token");
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });

  it("is deterministic", () => {
    const input = "stable-token-value";
    expect(sha256Hex(input)).toBe(sha256Hex(input));
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256Hex("token-a")).not.toBe(sha256Hex("token-b"));
  });
});

describe("API response contract: messages are returned as plaintext", () => {
  it("simulates the messages route transformation: enc content becomes plaintext", () => {
    const userId = "user_contract_test";
    const originalContent = "My private conversation message";

    const storedInDb = encryptField(userId, originalContent);

    expect(storedInDb.startsWith(ENC_PREFIX)).toBe(true);

    const mockDbRows = [
      { id: 1, threadId: 10, role: "user", content: storedInDb, isSummary: false },
      { id: 2, threadId: 10, role: "assistant", content: encryptField(userId, "AI reply"), isSummary: false },
    ];

    const apiResponse = mockDbRows.map((m) => ({
      ...m,
      content: decryptField(userId, m.content),
    }));

    for (const msg of apiResponse) {
      expect(msg.content.startsWith(ENC_PREFIX)).toBe(false);
    }
    expect(apiResponse[0].content).toBe(originalContent);
    expect(apiResponse[1].content).toBe("AI reply");
  });

  it("simulates the messages/recent route: enc content becomes plaintext", () => {
    const userId = "user_contract_recent";
    const messages = [
      { id: 100, content: encryptField(userId, "message one") },
      { id: 101, content: "legacy plaintext message" },
      { id: 102, content: encryptField(userId, "message three") },
    ];

    const result = messages.map((m) => ({
      ...m,
      content: decryptField(userId, m.content),
    }));

    expect(result[0].content).toBe("message one");
    expect(result[1].content).toBe("legacy plaintext message");
    expect(result[2].content).toBe("message three");

    for (const m of result) {
      expect(m.content.startsWith(ENC_PREFIX)).toBe(false);
    }
  });
});
