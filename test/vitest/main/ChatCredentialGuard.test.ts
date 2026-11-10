/**
 * FR-31 / NFR-03 (PRD §19.1–§19.2, audit finding 8): a pasted credential
 * must be rejected at the ordinary-chat persistence boundary — before the
 * message is saved, before any provider call.
 */
import { describe, expect, it } from "vitest";
import { checkChatMessageForCredentials } from "@/service/ChatCredentialGuard";

describe("checkChatMessageForCredentials", () => {
  it("rejects the concrete credential shapes the installer schemas reject", () => {
    for (const message of [
      "here is my key sk-ant-api03-abcdef0123456789abcdef0123456789",
      "token: ghp_1234567890abcdefghijklmnopqrstuv",
      "-----BEGIN RSA PRIVATE KEY-----",
      "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456abc123def456",
    ]) {
      const result = checkChatMessageForCredentials(message);
      expect(result.rejected, message.slice(0, 30)).toBe(true);
      expect(result.errorCode).toBe("CHAT_CREDENTIAL_REJECTED");
      // The safe message never includes the matched value.
      expect(result.message).not.toContain("sk-ant");
      expect(result.message).not.toContain("ghp_");
    }
  });

  it("allows ordinary conversation about keys and redaction guidance", () => {
    for (const message of [
      "what is an API key and where do I get one?",
      "my key starts with sk- and I will NOT paste it",
      "use the secure input instead of chat for the ELEVENLABS_API_KEY",
      "",
    ]) {
      const result = checkChatMessageForCredentials(message);
      expect(result.rejected, message.slice(0, 40)).toBe(false);
    }
  });
});
