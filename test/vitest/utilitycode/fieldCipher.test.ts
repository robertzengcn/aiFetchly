import { describe, it, expect } from "vitest";
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";

// Deterministic 32-byte key for tests (DO NOT use in production).
const TEST_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hex"
);

describe("FieldCipher.isEncrypted", () => {
  it("returns true for an ENC1: envelope", () => {
    expect(FieldCipher.isEncrypted("ENC1:aaaa:bbbb")).toBe(true);
  });

  it("returns false for a plaintext string", () => {
    expect(FieldCipher.isEncrypted("my-password-123")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(FieldCipher.isEncrypted("")).toBe(false);
  });

  it("returns false for null", () => {
    expect(FieldCipher.isEncrypted(null as unknown as string)).toBe(false);
  });

  it("returns false for a different version prefix", () => {
    expect(FieldCipher.isEncrypted("ENC2:aaaa:bbbb")).toBe(false);
  });
});

describe("FieldCipher.encrypt", () => {
  it("produces an ENC1: envelope matching the documented format", () => {
    const out = FieldCipher.encrypt("hello", TEST_KEY);
    expect(out).toMatch(/^ENC1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  it("produces a different ciphertext for the same plaintext (random IV)", () => {
    const a = FieldCipher.encrypt("same", TEST_KEY);
    const b = FieldCipher.encrypt("same", TEST_KEY);
    expect(a).not.toEqual(b);
  });

  it("throws on a 31-byte key", () => {
    const shortKey = Buffer.alloc(31, 0xab);
    expect(() => FieldCipher.encrypt("x", shortKey)).toThrow();
  });

  it("throws on a 33-byte key", () => {
    const longKey = Buffer.alloc(33, 0xab);
    expect(() => FieldCipher.encrypt("x", longKey)).toThrow();
  });

  it("accepts an empty string plaintext", () => {
    const out = FieldCipher.encrypt("", TEST_KEY);
    expect(FieldCipher.isEncrypted(out)).toBe(true);
  });
});

describe("FieldCipher.decrypt", () => {
  it("round-trips an encrypt() output back to the original plaintext", () => {
    const plaintext = "super-secret-password-123!";
    const encrypted = FieldCipher.encrypt(plaintext, TEST_KEY);
    expect(FieldCipher.decrypt(encrypted, TEST_KEY)).toBe(plaintext);
  });

  it("round-trips an empty plaintext", () => {
    const encrypted = FieldCipher.encrypt("", TEST_KEY);
    expect(FieldCipher.decrypt(encrypted, TEST_KEY)).toBe("");
  });

  it("throws when the auth tag does not verify (wrong key)", () => {
    const encrypted = FieldCipher.encrypt("secret", TEST_KEY);
    const wrongKey = Buffer.alloc(32, 0x00);
    expect(() => FieldCipher.decrypt(encrypted, wrongKey)).toThrow();
  });

  it("throws on a tampered ciphertext (bit flipped)", () => {
    const encrypted = FieldCipher.encrypt("secret", TEST_KEY);
    // Flip the last chars of the ciphertext portion.
    const parts = encrypted.split(":");
    const tampered = parts[2].slice(0, -2) + (parts[2].slice(-2) === "AA" ? "BB" : "AA");
    const malformed = `${parts[0]}:${parts[1]}:${tampered}`;
    expect(() => FieldCipher.decrypt(malformed, TEST_KEY)).toThrow();
  });

  it("throws on a malformed envelope (missing parts)", () => {
    expect(() => FieldCipher.decrypt("ENC1:onlyonepart", TEST_KEY)).toThrow();
  });

  it("throws on a malformed envelope (wrong prefix)", () => {
    expect(() => FieldCipher.decrypt("ENC2:aa:bb", TEST_KEY)).toThrow();
  });

  it("throws on a 31-byte key", () => {
    const encrypted = FieldCipher.encrypt("x", TEST_KEY);
    const shortKey = Buffer.alloc(31, 0xab);
    expect(() => FieldCipher.decrypt(encrypted, shortKey)).toThrow();
  });
});
