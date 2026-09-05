import { describe, expect, it } from "vitest";
import { mapReportError } from "@/service/AIContentReportErrorMapper";
import { AIContentReportError } from "@/entityTypes/aiContentReportTypes";

describe("mapReportError", () => {
  it("returns the inner code for an AIContentReportError", () => {
    const err = new AIContentReportError("rate_limited", "too many");
    expect(mapReportError(err)).toBe("rate_limited");
  });

  it("maps 400 to invalid_evidence", () => {
    expect(mapReportError({ status: 400 })).toBe("invalid_evidence");
  });

  it("maps 422 to invalid_evidence", () => {
    expect(mapReportError({ status: 422 })).toBe("invalid_evidence");
  });

  it("maps 401 to auth_failed", () => {
    expect(mapReportError({ status: 401 })).toBe("auth_failed");
  });

  it("maps 403 to auth_failed", () => {
    expect(mapReportError({ status: 403 })).toBe("auth_failed");
  });

  it("maps 413 to payload_too_large", () => {
    expect(mapReportError({ status: 413 })).toBe("payload_too_large");
  });

  it("maps 429 to rate_limited", () => {
    expect(mapReportError({ status: 429 })).toBe("rate_limited");
  });

  it("maps 503 to service_disabled", () => {
    expect(mapReportError({ status: 503 })).toBe("service_disabled");
  });

  it("maps a generic 5xx to server_error", () => {
    expect(mapReportError({ status: 500 })).toBe("server_error");
    expect(mapReportError({ status: 502 })).toBe("server_error");
  });

  it("maps a network TypeError to network", () => {
    expect(mapReportError(new TypeError("Failed to fetch"))).toBe("network");
  });

  it("maps a network-flagged error to network", () => {
    expect(mapReportError({ isNetwork: true })).toBe("network");
  });

  it("maps a connection-refused message to network", () => {
    expect(mapReportError(new Error("connect ECONNREFUSED"))).toBe("network");
  });

  it("maps an unknown value to unknown", () => {
    expect(mapReportError({})).toBe("unknown");
    expect(mapReportError("some string")).toBe("unknown");
  });

  it("maps a 200 with no status property to unknown", () => {
    expect(mapReportError({ foo: "bar" })).toBe("unknown");
  });
});
