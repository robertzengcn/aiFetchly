import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/service/aiChatGoal/goalRedaction";

describe("redactSecrets", () => {
  it("redacts a password value while keeping the key", () => {
    expect(redactSecrets('config password: hunter2-stuff')).toBe(
      "config password: [REDACTED]"
    );
  });

  it("redacts api_key = value assignments", () => {
    expect(redactSecrets("api_key = sk_live_abcdef123456")).toBe(
      "api_key = [REDACTED]"
    );
  });

  it("redacts Bearer tokens", () => {
    expect(redactSecrets("Authorization: Bearer abc.def.ghi_jkl==")).toContain(
      "[REDACTED]"
    );
  });

  it("redacts JWT tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(redactSecrets(`token=${jwt}`)).toContain("[REDACTED]");
    expect(redactSecrets(jwt)).not.toContain(jwt);
  });

  it("redacts AWS access key ids", () => {
    expect(redactSecrets("aws AKIAIOSFODNN7EXAMPLE used")).toContain(
      "[REDACTED]"
    );
  });

  it("redacts GitHub tokens", () => {
    const tok = "ghp_0123456789abcdef0123456789abcdef01234567";
    expect(redactSecrets(tok)).not.toContain(tok);
  });

  it("redacts PEM private key blocks", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAabcd1234\n-----END RSA PRIVATE KEY-----";
    const out = redactSecrets(`key: ${pem} done`);
    expect(out).not.toContain("MIIEpAIBAAKCAQEAabcd1234");
    expect(out).toContain("[REDACTED]");
  });

  it("leaves ordinary text intact", () => {
    const text = "the scraper returned 42 results rows in 1.2s";
    expect(redactSecrets(text)).toBe(text);
  });

  it("does not mutate the input string", () => {
    const input = "password: secret-value-1234";
    redactSecrets(input);
    expect(input).toBe("password: secret-value-1234");
  });
});
