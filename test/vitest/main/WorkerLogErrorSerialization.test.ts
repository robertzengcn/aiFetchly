/**
 * Regression tests for worker→main log serialization.
 *
 * Production failure (2026-11-12..14): the contact-extraction worker logged
 * `log.error("AI extraction error:", error)` but main.log showed
 * "AI extraction error: {}" — 182 times in one day. The worker log proxy
 * forwards args via process.send, which uses JSON serialization by default;
 * Error's message/stack are non-enumerable, so every raw Error arrived in the
 * main process as an empty object and the actual failure (the packaged worker
 * falling back to http://localhost:3000 for the AI extraction endpoint) was
 * invisible in diagnostics. The same mechanism rendered puppeteer's
 * TimeoutError as "{ name: 'TimeoutError' }".
 */
import { describe, expect, it } from "vitest";
import { serializeWorkerLogArg } from "@/modules/Logger";

describe("serializeWorkerLogArg", () => {
  it("flattens a standard Error to its stack so the message survives JSON IPC", () => {
    const error = new Error("AI extraction request failed with HTTP 500.");
    const serialized = serializeWorkerLogArg(error);
    expect(typeof serialized).toBe("string");
    expect(serialized).toContain("AI extraction request failed with HTTP 500.");
    // Round-trips through JSON.stringify like process.send's default
    // serialization does — non-empty, unlike the raw Error.
    expect(JSON.parse(JSON.stringify(serialized))).not.toEqual({});
  });

  it("flattens an Error subclass whose only enumerable field is name", () => {
    // Matches the observed "{ name: 'TimeoutError' }" rendering: subclasses
    // that assign this.name keep it enumerable while message/stack stay hidden.
    const timeoutError = new Error("Navigation timeout of 30000 ms exceeded");
    timeoutError.name = "TimeoutError";
    const serialized = serializeWorkerLogArg(timeoutError);
    expect(typeof serialized).toBe("string");
    expect(String(serialized)).toContain("Navigation timeout of 30000 ms exceeded");
    expect(String(serialized)).toContain("TimeoutError");
  });

  it("falls back to name+message when the stack is missing", () => {
    const error = new Error("no stack");
    error.stack = undefined;
    expect(serializeWorkerLogArg(error)).toBe("Error: no stack");
  });

  it("passes non-Error arguments through unchanged", () => {
    const obj = { page_content_length: 1200, url: "https://example.com" };
    expect(serializeWorkerLogArg(obj)).toBe(obj);
    expect(serializeWorkerLogArg("plain text")).toBe("plain text");
    expect(serializeWorkerLogArg(42)).toBe(42);
    expect(serializeWorkerLogArg(null)).toBeNull();
  });
});
