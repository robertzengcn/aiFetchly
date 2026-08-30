import { describe, expect, it } from "vitest";
import { aiContentReportCapabilitiesResponseSchema } from "@/schemas/api/aiContentReport";

describe("aiContentReportCapabilitiesResponseSchema", () => {
  it("accepts a valid v2-enabled envelope", () => {
    const r = aiContentReportCapabilitiesResponseSchema().safeParse({
      status: true,
      code: 0,
      msg: "ok",
      data: {
        acceptedSchemaVersions: [1, 2],
        conversationReporting: {
          enabled: true,
          maxAIItems: 10,
          maxUserItems: 10,
          maxTotalItems: 20,
          maxItemTextChars: 8000,
          maxAggregateTextChars: 32000,
          maxImages: 3,
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts a disabled/fail-closed envelope", () => {
    const r = aiContentReportCapabilitiesResponseSchema().safeParse({
      status: true,
      code: 0,
      msg: "ok",
      data: {
        acceptedSchemaVersions: [1],
        conversationReporting: { enabled: false, maxAIItems: 10, maxUserItems: 10, maxTotalItems: 20, maxItemTextChars: 8000, maxAggregateTextChars: 32000, maxImages: 3 },
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative or fractional limits", () => {
    const r = aiContentReportCapabilitiesResponseSchema().safeParse({
      status: true, code: 0, msg: "ok",
      data: {
        acceptedSchemaVersions: [1, 2],
        conversationReporting: { enabled: true, maxAIItems: -1, maxUserItems: 10, maxTotalItems: 20, maxItemTextChars: 8000, maxAggregateTextChars: 32000, maxImages: 3 },
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys in the envelope and data", () => {
    const r = aiContentReportCapabilitiesResponseSchema().safeParse({
      status: true, code: 0, msg: "ok",
      data: {
        acceptedSchemaVersions: [1, 2],
        conversationReporting: { enabled: true, maxAIItems: 10, maxUserItems: 10, maxTotalItems: 20, maxItemTextChars: 8000, maxAggregateTextChars: 32000, maxImages: 3, sneaky: "leak" },
      },
      extra: "leak",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing conversationReporting block", () => {
    const r = aiContentReportCapabilitiesResponseSchema().safeParse({
      status: true, code: 0, msg: "ok",
      data: { acceptedSchemaVersions: [1] },
    });
    expect(r.success).toBe(false);
  });
});
