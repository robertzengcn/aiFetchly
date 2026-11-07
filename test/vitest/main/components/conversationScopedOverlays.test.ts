import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useConversationScopedOverlays } from "@/views/composables/aiChatWorkspace/useConversationScopedOverlays";

/**
 * G01: conversation-bound overlay ownership (AD-008). Selection changes
 * close stale overlays; global overlays survive; failures are isolated.
 */
describe("useConversationScopedOverlays (G01)", () => {
  it("closes owned overlays whose conversation is no longer selected", async () => {
    const selection = ref<string | null>("conv-a");
    const host = useConversationScopedOverlays(() => selection.value);
    const closed: string[] = [];
    host.registerOverlay({
      id: "email-review",
      conversationId: "conv-a",
      close: () => closed.push("email-review"),
    });
    host.registerOverlay({
      id: "report",
      conversationId: "conv-b",
      close: () => closed.push("report"),
    });
    expect(host.openCount()).toBe(2);

    selection.value = "conv-b";
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toEqual(["email-review"]);
    expect(host.openCount()).toBe(1);
  });

  it("keeps global overlays across selection changes", async () => {
    const selection = ref<string | null>("conv-a");
    const host = useConversationScopedOverlays(() => selection.value);
    let closed = 0;
    host.registerOverlay({
      id: "settings",
      conversationId: null,
      close: () => {
        closed += 1;
      },
    });
    selection.value = "conv-b";
    await Promise.resolve();
    expect(closed).toBe(0);
    expect(host.openCount()).toBe(1);
  });

  it("runs selection-bound closers on every change without consuming them", async () => {
    const selection = ref<string | null>("conv-a");
    const host = useConversationScopedOverlays(() => selection.value);
    let runs = 0;
    host.registerSelectionBoundOverlay("reports", () => {
      runs += 1;
    });
    selection.value = "conv-b";
    await Promise.resolve();
    selection.value = "conv-a";
    await Promise.resolve();
    selection.value = null;
    await Promise.resolve();
    expect(runs).toBe(3);
    expect(host.openCount()).toBe(1);
  });

  it("isolates closer failures and supports unregister + explicit close", () => {
    const selection = ref<string | null>("conv-a");
    const host = useConversationScopedOverlays(() => selection.value);
    const closed: string[] = [];
    host.registerOverlay({
      id: "broken",
      conversationId: "conv-a",
      close: () => {
        throw new Error("boom");
      },
    });
    host.registerOverlay({
      id: "fine",
      conversationId: "conv-a",
      close: () => closed.push("fine"),
    });
    // Explicit close drops both despite the failure.
    expect(host.closeOverlays()).toEqual(["broken", "fine"]);
    expect(closed).toEqual(["fine"]);
    expect(host.openCount()).toBe(0);

    const unregister = host.registerSelectionBoundOverlay("temp", () => {
      closed.push("temp");
    });
    unregister();
    expect(host.openCount()).toBe(0);
  });
});
