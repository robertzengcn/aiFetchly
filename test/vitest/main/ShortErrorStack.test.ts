import { describe, it, expect } from "vitest";
import {
  shortErrorStack,
  splitTelemetryMessage,
} from "@/service/ShortErrorStack";

describe("shortErrorStack", () => {
  it("returns null when there is no stack", () => {
    // Force an error with no stack
    const e = new Error("no stack");
    e.stack = undefined;
    expect(shortErrorStack(e)).toBeNull();
  });

  it("returns at most maxFrames lines joined by newline", () => {
    const e = new Error();
    e.stack = [
      "Error: boom",
      "    at a (file.ts:1:1)",
      "    at b (file.ts:2:2)",
      "    at c (file.ts:3:3)",
      "    at d (file.ts:4:4)",
      "    at e (file.ts:5:5)",
      "    at f (file.ts:6:6)",
    ].join("\n");
    const out = shortErrorStack(e, 3);
    expect(out?.split("\n")).toHaveLength(4); // message + 3 frames
    expect(out).toContain("Error: boom");
    expect(out).not.toContain("file.ts:5:5");
  });

  it("uses default maxFrames=5", () => {
    const e = new Error();
    e.stack = [
      "Error: boom",
      ...Array.from({ length: 10 }, (_, i) => `    at f${i} (x:${i})`),
    ].join("\n");
    const out = shortErrorStack(e);
    expect(out?.split("\n").length).toBe(6); // message + 5 frames
  });
});

describe("splitTelemetryMessage", () => {
  it("returns the message unchanged when there are no file paths", () => {
    expect(
      splitTelemetryMessage(new Error("Network error")).telemetryMessage
    ).toBe("Network error");
  });

  it("strips absolute file paths from the message", () => {
    const e = new Error(
      "Failed to read /home/robertzeng/project/aiFetchly/secret.txt"
    );
    const out = splitTelemetryMessage(e);
    expect(out.telemetryMessage).not.toContain("/home/robertzeng");
    expect(out.telemetryMessage).toContain("Failed to read");
  });

  it("strips Windows absolute file paths from the message", () => {
    const e = new Error(
      "Failed to read C:\\Users\\robertzeng\\project\\secret.txt"
    );
    const out = splitTelemetryMessage(e);
    expect(out.telemetryMessage).not.toContain("C:\\Users");
    expect(out.telemetryMessage).not.toContain("secret.txt");
    expect(out.telemetryMessage).toContain("Failed to read");
  });

  it("preserves URLs in the message while still stripping file paths", () => {
    const e = new Error("fetch https://example.com/api/v1 failed");
    const out = splitTelemetryMessage(e);
    expect(out.telemetryMessage).toContain("https://example.com/api/v1");
    expect(out.telemetryMessage).toContain("fetch");
    expect(out.telemetryMessage).toContain("failed");
  });

  it("strips Windows paths containing spaces", () => {
    const e = new Error("Failed to read C:\\Program Files\\app\\src\\index.js");
    const out = splitTelemetryMessage(e);
    expect(out.telemetryMessage).not.toContain("Program Files");
    expect(out.telemetryMessage).not.toContain("index.js");
    expect(out.telemetryMessage).toContain("Failed to read");
  });

  it("preserves the original message in .message", () => {
    const e = new Error("Failed to read /tmp/x.txt");
    const out = splitTelemetryMessage(e);
    expect(out.message).toBe("Failed to read /tmp/x.txt");
  });
});
