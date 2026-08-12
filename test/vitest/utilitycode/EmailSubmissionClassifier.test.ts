import { describe, it, expect } from "vitest";
import {
  classifySubmissionResult,
  sanitizeError,
} from "@/service/emailReply/EmailSubmissionClassifier";

describe("classifySubmissionResult", () => {
  it("accepts a successful send and returns the provider message id", () => {
    const r = classifySubmissionResult({
      status: true,
      info: "<prov-1@x>",
    });
    expect(r.accepted).toBe(true);
    expect(r.certainty).toBe("accepted");
    expect(r.providerMessageId).toBe("<prov-1@x>");
    expect(r.sanitizedError).toBeNull();
  });

  it("classifies an auth failure as a definite rejection", () => {
    const r = classifySubmissionResult({
      status: false,
      info: "Invalid login: 535 5.7.0 Username and Password not accepted",
    });
    expect(r.certainty).toBe("definitely_rejected");
    expect(r.accepted).toBe(false);
  });

  it("classifies connection-refused / DNS failures as definite rejections", () => {
    expect(
      classifySubmissionResult({ status: false, info: "connect ECONNREFUSED 1.2.3.4:587" })
        .certainty
    ).toBe("definitely_rejected");
    expect(
      classifySubmissionResult({ status: false, info: "getaddrinfo ENOTFOUND smtp.x" })
        .certainty
    ).toBe("definitely_rejected");
  });

  it("classifies an envelope/recipient rejection as definite", () => {
    expect(
      classifySubmissionResult({
        status: false,
        info: "Recipient address rejected: User unknown",
      }).certainty
    ).toBe("definitely_rejected");
  });

  it("classifies a mid-transfer timeout as UNKNOWN (never a definite rejection)", () => {
    const r = classifySubmissionResult({
      status: false,
      info: "connect ETIMEDOUT 1.2.3.4:587",
    });
    expect(r.certainty).toBe("unknown");
  });

  it("classifies a socket disconnect as UNKNOWN", () => {
    expect(
      classifySubmissionResult({ status: false, info: "socket disconnected" }).certainty
    ).toBe("unknown");
  });

  it("defaults an unrecognized error to UNKNOWN (safe default)", () => {
    expect(
      classifySubmissionResult({ status: false, info: "something unusual happened" })
        .certainty
    ).toBe("unknown");
  });

  it("never returns an empty sanitized error", () => {
    const r = classifySubmissionResult({ status: false, info: "" });
    expect(r.sanitizedError).toBe("");
  });
});

describe("sanitizeError", () => {
  it("bounds a very long diagnostic", () => {
    const long = "ECONNREFUSED " + "x".repeat(500);
    const out = sanitizeError(long);
    expect(out.length).toBeLessThanOrEqual(241);
    expect(out.endsWith("…")).toBe(true);
  });
});
