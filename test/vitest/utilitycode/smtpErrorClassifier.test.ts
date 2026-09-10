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

  it("classifies TLS/cert errors as smtp_tls_failed (safe)", () => {
    const r = classifySmtpFailure({ message: "self-signed certificate" });
    expect(r.code).toBe("smtp_tls_failed");
  });

  it("classifies DNS/refused as smtp_connection_failed (safe)", () => {
    const r = classifySmtpFailure({ code: "ENOTFOUND", message: "getaddrinfo" });
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
  });

  it("classifies EENVELOPE as smtp_from_rejected", () => {
    const r = classifySmtpFailure({ code: "EENVELOPE", message: "Message rejected" });
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
