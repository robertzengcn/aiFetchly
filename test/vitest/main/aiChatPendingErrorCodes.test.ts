import { describe, expect, it } from "vitest";
import {
  pendingErrorCode,
  userSafeError,
  PENDING_ERROR_CODES,
} from "@/service/AIChatErrorMapper";
import { AIChatPendingMessageModuleError } from "@/modules/AIChatPendingMessageModule";
import { AIChatTurnQueueError } from "@/service/AIChatTurnQueueService";

/**
 * B15: typed queue/preparation/terminal errors keep a stable bounded code
 * through workspace IPC so the renderer can map them to localized copy.
 */
describe("pending error codes through userSafeError (B15)", () => {
  it("classifies module + queue error codes", () => {
    expect(
      pendingErrorCode(
        new AIChatPendingMessageModuleError("QUEUE_LIMIT_REACHED", "full")
      )
    ).toBe("QUEUE_LIMIT_REACHED");
    expect(
      pendingErrorCode(new AIChatTurnQueueError("QUEUE_DISABLED", "off"))
    ).toBe("QUEUE_DISABLED");
    expect(pendingErrorCode(new Error("plain"))).toBeNull();
    expect(pendingErrorCode("string")).toBeNull();
  });

  it("preserves the code prefix with user-safe guidance", () => {
    const out = userSafeError(
      new AIChatPendingMessageModuleError(
        "QUEUE_LIMIT_REACHED",
        "Queue limit reached (5 messages). Remove one before sending again."
      )
    );
    expect(out.startsWith("[QUEUE_LIMIT_REACHED] ")).toBe(true);
    expect(out).toContain("Remove one before sending again");
  });

  it("leaves unmapped errors on the generic path", () => {
    expect(userSafeError(new Error("weird boom"))).toBe(
      "An unexpected error occurred. Please try again."
    );
  });

  it("codes are bounded and carry no payload", () => {
    for (const code of PENDING_ERROR_CODES) {
      expect(code).toMatch(/^[A-Z_]+$/);
    }
    // Guidance text carries counts/actions only — never prompt content.
    const out = userSafeError(
      new AIChatPendingMessageModuleError("QUEUE_LIMIT_REACHED", "limit (5)")
    );
    expect(out).not.toContain("sk-");
  });
});
