import { describe, it, expect } from "vitest";
import {
  sessionMetadataInputSchema,
  browserImportAvailabilityInputSchema,
  browserImportStartPairingInputSchema,
  browserImportCancelInputSchema,
} from "@/schemas/ipc/browserProfileImport";

describe("sessionMetadataInputSchema", () => {
  it("accepts a positive integer id", () => {
    expect(sessionMetadataInputSchema().parse({ id: 5 }).id).toBe(5);
  });
  it("rejects missing / non-positive / string ids", () => {
    expect(() => sessionMetadataInputSchema().parse({})).toThrow();
    expect(() => sessionMetadataInputSchema().parse({ id: 0 })).toThrow();
    expect(() => sessionMetadataInputSchema().parse({ id: "5" })).toThrow();
  });
  it("rejects extra fields (strictObject) - no caller-supplied domains", () => {
    expect(() =>
      sessionMetadataInputSchema().parse({ id: 5, allowedDomains: ["evil.com"] })
    ).toThrow();
  });
});

describe("browserImportAvailabilityInputSchema", () => {
  it("accepts an id and rejects extras", () => {
    expect(browserImportAvailabilityInputSchema().parse({ id: 1 }).id).toBe(1);
    expect(() =>
      browserImportAvailabilityInputSchema().parse({ id: 1, platformId: 99 })
    ).toThrow();
  });
});

describe("browserImportStartPairingInputSchema", () => {
  it("requires confirmed === true (user gesture)", () => {
    expect(
      browserImportStartPairingInputSchema().parse({ id: 1, confirmed: true }).id
    ).toBe(1);
    expect(() =>
      browserImportStartPairingInputSchema().parse({ id: 1, confirmed: false })
    ).toThrow();
    expect(() =>
      browserImportStartPairingInputSchema().parse({ id: 1 })
    ).toThrow();
  });
});

describe("browserImportCancelInputSchema", () => {
  it("requires a non-empty requestId", () => {
    expect(
      browserImportCancelInputSchema().parse({ requestId: "req-123" }).requestId
    ).toBe("req-123");
    expect(() => browserImportCancelInputSchema().parse({ requestId: "" })).toThrow();
    expect(() => browserImportCancelInputSchema().parse({})).toThrow();
  });
});
