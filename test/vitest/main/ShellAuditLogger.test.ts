/**
 * Unit tests for ShellAuditLogger — command redaction and audit logging.
 *
 * Tests cover:
 * - Redaction of API keys (sk-*, ghp-*, AKIA*)
 * - Redaction of passwords, tokens, secrets
 * - Redaction of credential URLs
 * - ShellAuditLogger.log() fire-and-forget behavior
 */
import { describe, it, expect, vi } from "vitest";
import { redactCommand, ShellAuditLogger } from "@/service/ShellAuditLogger";

// ---------------------------------------------------------------------------
// T025: Command redaction
// ---------------------------------------------------------------------------

describe("redactCommand — sensitive token redaction", () => {
  it("redacts OpenAI-style API keys (sk-*)", () => {
    const cmd = "export OPENAI_API_KEY=sk-abc123def456ghi789jkl012mno345";
    const redacted = redactCommand(cmd);
    expect(redacted).not.toContain("sk-abc123def456ghi789jkl012mno345");
    expect(redacted).toContain("[REDACTED_API_KEY]");
  });

  it("redacts Anthropic API keys (sk-ant-*)", () => {
    const cmd =
      "export API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890";
    const redacted = redactCommand(cmd);
    expect(redacted).not.toContain("sk-ant-api03-");
    expect(redacted).toContain("[REDACTED_API_KEY]");
  });

  it("redacts GitHub tokens (ghp_*)", () => {
    const cmd =
      "git clone https://ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ@github.com/repo.git";
    const redacted = redactCommand(cmd);
    expect(redacted).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(redacted).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  it("redacts AWS access keys (AKIA*)", () => {
    const cmd = "aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE";
    const redacted = redactCommand(cmd);
    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redacted).toContain("[REDACTED_AWS_KEY]");
  });

  it("redacts password assignments", () => {
    const cmd = "mysql -u root --password=supersecret123 -e 'SELECT 1'";
    const redacted = redactCommand(cmd);
    expect(redacted).not.toContain("supersecret123");
    expect(redacted).toContain("[REDACTED_PASSWORD]");
  });

  it("redacts token assignments", () => {
    const cmd =
      'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig" https://api.example.com';
    const redacted = redactCommand(cmd);
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9.test.sig");
    expect(redacted).toContain("[REDACTED_TOKEN]");
  });

  it("redacts API key assignments", () => {
    const cmd = "python script.py --api-key=my_secret_key_12345";
    const redacted = redactCommand(cmd);
    expect(redacted).not.toContain("my_secret_key_12345");
    expect(redacted).toContain("[REDACTED_API_KEY]");
  });

  it("redacts secret assignments", () => {
    const cmd = "export SECRET=my_top_secret_value";
    const redacted = redactCommand(cmd);
    expect(redacted).not.toContain("my_top_secret_value");
    expect(redacted).toContain("[REDACTED_SECRET]");
  });

  it("redacts URLs with embedded credentials", () => {
    const cmd = "curl https://admin:password123@api.example.com/endpoint";
    const redacted = redactCommand(cmd);
    expect(redacted).not.toContain("admin:password123@");
    expect(redacted).toContain("[REDACTED_USER]:[REDACTED_PASS]@");
  });

  it("preserves safe command text", () => {
    const cmd = "echo 'hello world' && ls -la /tmp";
    const redacted = redactCommand(cmd);
    expect(redacted).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// T026: Audit log creation (fire-and-forget behavior)
// ---------------------------------------------------------------------------

describe("ShellAuditLogger — log entry behavior", () => {
  it("does not throw when database is unavailable", async () => {
    const logger = new ShellAuditLogger();

    // This should not throw even if the database is not accessible
    // (fire-and-forget pattern)
    await expect(
      logger.log({
        conversationId: "test-conv",
        toolCallId: "test-tool",
        commandRedacted: "echo test",
        cwd: "/tmp",
        shell: "bash",
        success: true,
        exitCode: 0,
        timedOut: false,
        durationMs: 100,
      })
    ).resolves.toBeUndefined();
  });
});
