import { describe, it, expect } from "vitest";
import {
  nativeImportRequestSchema,
  nativeImportResultSchema,
  nativeMessageSchema,
  NATIVE_MESSAGE_MAX_BYTES,
} from "@/schemas/nativeMessaging";

describe("nativeImportRequestSchema", () => {
  it("accepts a well-formed import_request", () => {
    const req = nativeImportRequestSchema.parse({
      version: 1,
      type: "import_request",
      requestId: "req-1",
      requestSecret: "abcdefghijklmnop",
      platformId: 2,
      allowedDomains: ["youtube.com", "google.com"],
      expiresAt: "2026-08-05T13:55:00.000Z",
    });
    expect(req.platformId).toBe(2);
  });

  it("rejects an empty allowedDomains list (must request at least one domain)", () => {
    expect(() =>
      nativeImportRequestSchema.parse({
        version: 1,
        type: "import_request",
        requestId: "r",
        requestSecret: "abcdefghijklmnop",
        platformId: 2,
        allowedDomains: [],
        expiresAt: "x",
      })
    ).toThrow();
  });

  it("rejects unknown fields (strictObject)", () => {
    expect(() =>
      nativeImportRequestSchema.parse({
        version: 1,
        type: "import_request",
        requestId: "r",
        requestSecret: "abcdefghijklmnop",
        platformId: 2,
        allowedDomains: ["youtube.com"],
        expiresAt: "x",
        extra: true,
      })
    ).toThrow();
  });
});

describe("nativeImportResultSchema", () => {
  it("accepts a result with a cookie array", () => {
    const res = nativeImportResultSchema.parse({
      version: 1,
      type: "import_result",
      requestId: "r",
      requestSecret: "abcdefghijklmnop",
      cookies: [{ domain: ".youtube.com", name: "SID", value: "x" }],
      extensionVersion: "1.0.0",
    });
    expect(res.cookies).toHaveLength(1);
  });
});

describe("nativeMessageSchema discriminated union", () => {
  it("dispatches by type", () => {
    const req = nativeMessageSchema.parse({
      version: 1,
      type: "import_request",
      requestId: "r",
      requestSecret: "abcdefghijklmnop",
      platformId: 2,
      allowedDomains: ["youtube.com"],
      expiresAt: "x",
    });
    expect(req.type).toBe("import_request");
  });
});

describe("NATIVE_MESSAGE_MAX_BYTES", () => {
  it("is 1 MiB", () => {
    expect(NATIVE_MESSAGE_MAX_BYTES).toBe(1024 * 1024);
  });
});
