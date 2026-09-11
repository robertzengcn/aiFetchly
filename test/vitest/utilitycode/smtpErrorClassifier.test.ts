import { describe, expect, it } from "vitest";
import { classifySmtpFailure } from "@/modules/lib/smtpErrorClassifier";

describe("classifySmtpFailure (§19)", () => {
  it("classifies AUTH/535 as smtp_auth_failed (safe)", () => {
    const r = classifySmtpFailure({ code: "EAUTH", message: "Invalid login" });
    expect(r.code).toBe("smtp_auth_failed");
    expect(r.retrySafety).toBe("safe");
  });

  it("classifies MAIL FROM rejection as smtp_from_rejected (safe)", () => {
    const r = classifySmtpFailure({
      command: "MAIL",
      message: "Sender address rejected",
    });
    expect(r.code).toBe("smtp_from_rejected");
    expect(r.retrySafety).toBe("safe");
  });

  it("classifies RCPT rejection as smtp_recipient_rejected (safe)", () => {
    const r = classifySmtpFailure({ message: "Recipient address rejected" });
    expect(r.code).toBe("smtp_recipient_rejected");
  });

  it("classifies structured command AUTH as smtp_auth_failed", () => {
    const r = classifySmtpFailure({ command: "AUTH", message: "bad creds" });
    expect(r.code).toBe("smtp_auth_failed");
  });

  it("classifies structured command RCPT as smtp_recipient_rejected", () => {
    const r = classifySmtpFailure({ command: "RCPT", message: "unknown user" });
    expect(r.code).toBe("smtp_recipient_rejected");
  });

  it("handles Error instances and primitive strings via text()", () => {
    const fromError = classifySmtpFailure(
      new Error("ENOTFOUND name not known")
    );
    expect(fromError.code).toBe("smtp_connection_failed");
    expect(fromError.sanitizedMessage).toContain("ENOTFOUND");

    const fromPrimitive = classifySmtpFailure("ECONNREFUSED connect refused");
    expect(fromPrimitive.code).toBe("smtp_connection_failed");
  });

  it("classifies TLS/cert errors as smtp_tls_failed (safe)", () => {
    const r = classifySmtpFailure({ message: "self-signed certificate" });
    expect(r.code).toBe("smtp_tls_failed");
  });

  it("classifies DNS/refused as smtp_connection_failed (safe)", () => {
    const r = classifySmtpFailure({
      code: "ENOTFOUND",
      message: "getaddrinfo",
    });
    expect(r.code).toBe("smtp_connection_failed");
  });

  it("classifies uncertain post-DATA as delivery_unknown (non-retryable)", () => {
    const r = classifySmtpFailure({ code: "ETIMEDOUT", message: "timeout" });
    expect(r.code).toBe("delivery_unknown");
    expect(r.retrySafety).toBe("unknown");
  });

  it("sanitizes the message (no password leakage)", () => {
    const r = classifySmtpFailure({
      message: "Auth failed for password=secret123",
    });
    expect(r.sanitizedMessage).not.toContain("secret123");
    expect(r.sanitizedMessage).toContain("[REDACTED]");
  });

  it("redacts common credential variants (§19.3)", () => {
    const variants = [
      "Auth failed for password=secret123",
      "Login rejected passwd=p4ss",
      "Authorization: Bearer abc-123-def",
      "Query ?token=s3cret&state=xyz",
      "Cookie: session=cookiedata",
    ];
    for (const msg of variants) {
      const r = classifySmtpFailure({ message: msg });
      expect(r.sanitizedMessage).not.toContain("secret123");
      expect(r.sanitizedMessage).not.toContain("p4ss");
      expect(r.sanitizedMessage).not.toContain("abc-123-def");
      expect(r.sanitizedMessage).not.toContain("s3cret");
      expect(r.sanitizedMessage).not.toContain("cookiedata");
    }
  });

  it("classifies EENVELOPE as smtp_from_rejected", () => {
    const r = classifySmtpFailure({
      code: "EENVELOPE",
      message: "Message rejected",
    });
    expect(r.code).toBe("smtp_from_rejected");
  });

  it("truncates very long messages to the log limit", () => {
    const long = "x".repeat(500);
    const r = classifySmtpFailure({ message: long });
    expect(r.sanitizedMessage.length).toBeLessThanOrEqual(241); // 240 + ellipsis
  });

  it("classifies relay access denied as smtp_from_rejected", () => {
    const r = classifySmtpFailure({ message: "relay access denied" });
    expect(r.code).toBe("smtp_from_rejected");
  });

  it("classifies ECONNREFUSED as smtp_connection_failed", () => {
    const r = classifySmtpFailure({ code: "ECONNREFUSED", message: "connect" });
    expect(r.code).toBe("smtp_connection_failed");
  });
});
