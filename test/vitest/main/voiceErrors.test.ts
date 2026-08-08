import { describe, it, expect } from "vitest";
import { classifyRecorderError } from "@/views/components/aiChatV2/voice/voiceErrors";

describe("classifyRecorderError", () => {
  it("maps permission-denied DOMExceptions", () => {
    expect(
      classifyRecorderError(new DOMException("denied", "NotAllowedError"))
    ).toBe("permission_denied");
    expect(
      classifyRecorderError(new DOMException("blocked", "SecurityError"))
    ).toBe("permission_denied");
  });

  it("maps no-microphone DOMExceptions", () => {
    expect(
      classifyRecorderError(new DOMException("none", "NotFoundError"))
    ).toBe("no_microphone");
    expect(
      classifyRecorderError(
        new DOMException("over", "OverconstrainedError")
      )
    ).toBe("no_microphone");
  });

  it("maps unsupported MIME type errors", () => {
    expect(
      classifyRecorderError(new DOMException("nope", "NotSupportedError"))
    ).toBe("unsupported_mime");
    expect(
      classifyRecorderError(new Error("mediaRecorder mime type not supported"))
    ).toBe("unsupported_mime");
    expect(classifyRecorderError(new Error("unsupported codec"))).toBe(
      "unsupported_mime"
    );
  });

  it("falls back to unknown for generic errors", () => {
    expect(classifyRecorderError(new Error("something broke"))).toBe("unknown");
    expect(
      classifyRecorderError(new DOMException("aborted", "AbortError"))
    ).toBe("unknown");
    expect(classifyRecorderError("a plain string")).toBe("unknown");
    expect(classifyRecorderError(undefined)).toBe("unknown");
  });
});
