import { describe, expect, it } from "vitest";
import { MessageType } from "@/entityTypes/commonType";
import { createWorkspaceStreamPresenter } from "@/views/utils/workspaceStreamPresenter";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";

let sequence = 0;

function event(
  conversationId: string,
  runId: string,
  payload: Record<string, unknown>
): ChatRunDetailEvent {
  sequence += 1;
  return {
    conversationId,
    runId,
    sequence,
    emittedAt: new Date(0).toISOString(),
    eventType: payload.eventType as ChatRunDetailEvent["eventType"],
    payload,
  };
}

/** Manual flush scheduler: the test decides when the window elapses. */
function manualScheduler(): {
  options: { scheduleFlush: (fn: () => void, ms: number) => () => void };
  elapse(): void;
  pendingCount(): number;
} {
  let queued: (() => void) | null = null;
  return {
    options: {
      scheduleFlush: (fn: () => void) => {
        queued = fn;
        return () => {
          queued = null;
        };
      },
    },
    elapse(): void {
      const fn = queued;
      queued = null;
      fn?.();
    },
    pendingCount(): number {
      return queued ? 1 : 0;
    },
  };
}

describe("workspaceStreamPresenter", () => {
  it("builds an assistant view and batches token deltas into one flush", () => {
    const scheduler = manualScheduler();
    const presenter = createWorkspaceStreamPresenter(scheduler.options);

    expect(
      presenter.applyEvent(
        event("v2-c", "run-1", { eventType: "start", messageId: "a1" })
      )
    ).toBe(true);
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "token",
        messageId: "a1",
        contentDelta: "Hel",
      })
    );
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "token",
        messageId: "a1",
        contentDelta: "lo ",
      })
    );
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "token",
        messageId: "a1",
        contentDelta: "world",
      })
    );

    // Buffered — not applied until the batch window elapses.
    expect(presenter.getState().messages[0].content).toBe("");
    expect(presenter.getState().unflushedDeltaCount).toBe(1);

    scheduler.elapse();
    const state = presenter.getState();
    expect(state.messages[0].content).toBe("Hello world");
    expect(state.streamStatus).toBe("streaming");
    expect(state.activeAssistantMessageId).toBe("a1");
  });

  it("terminal events flush immediately and finalize the message", () => {
    const presenter = createWorkspaceStreamPresenter({
      scheduleFlush: () => () => undefined, // never auto-flush
    });
    presenter.applyEvent(
      event("v2-c", "run-1", { eventType: "start", messageId: "a1" })
    );
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "token",
        messageId: "a1",
        contentDelta: "partial",
      })
    );
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "complete",
        messageId: "a1",
        fullContent: "full answer",
        finishReason: "stop",
        totalTokens: 42,
      })
    );

    const state = presenter.getState();
    expect(state.messages[0].content).toBe("full answer");
    expect(state.messages[0].tokensUsed).toBe(42);
    expect(state.streamStatus).toBe("idle");
    expect(state.activeAssistantMessageId).toBeNull();
  });

  it("ignores events for other conversations and duplicate sequences", () => {
    const presenter = createWorkspaceStreamPresenter();
    presenter.applyEvent(
      event("v2-c", "run-1", { eventType: "start", messageId: "a1" })
    );
    // Wrong conversation.
    expect(
      presenter.applyEvent(
        event("v2-OTHER", "run-1", { eventType: "token", messageId: "a1", contentDelta: "x" })
      )
    ).toBe(false);
    // Duplicate sequence (same run, sequence counter shared in test helper —
    // construct a duplicate manually).
    expect(
      presenter.applyEvent({
        conversationId: "v2-c",
        runId: "run-1",
        sequence: 1,
        emittedAt: new Date(0).toISOString(),
        eventType: "token",
        payload: { eventType: "token", messageId: "a1", contentDelta: "x" },
      })
    ).toBe(false);

    const state = presenter.getState();
    expect(state.messages).toHaveLength(1);
  });

  it("a new run's start event takes over; late content from the old run is dropped", () => {
    const presenter = createWorkspaceStreamPresenter({
      scheduleFlush: () => () => undefined,
    });
    presenter.applyEvent(
      event("v2-c", "run-1", { eventType: "start", messageId: "a1" })
    );
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "complete",
        messageId: "a1",
        fullContent: "first answer",
      })
    );
    // New run opens.
    expect(
      presenter.applyEvent(
        event("v2-c", "run-2", { eventType: "start", messageId: "a2" })
      )
    ).toBe(true);
    // Late non-terminal content from run-1 must not leak into run-2's view.
    expect(
      presenter.applyEvent(
        event("v2-c", "run-1", {
          eventType: "token",
          messageId: "a1",
          contentDelta: "late",
        })
      )
    ).toBe(false);
    expect(presenter.getState().activeAssistantMessageId).toBe("a2");
  });

  it("renders tool call/progress/result as message rows", () => {
    const presenter = createWorkspaceStreamPresenter({
      scheduleFlush: () => () => undefined,
    });
    presenter.applyEvent(
      event("v2-c", "run-1", { eventType: "start", messageId: "a1" })
    );
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "tool_call",
        messageId: "a1",
        toolCallId: "tc-1",
        toolName: "create_html_artifact",
        toolArguments: { title: "Report" },
      })
    );
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "tool_progress",
        toolCallId: "tc-1",
        phase: "running",
        progressFraction: 0.5,
        progressTimestamp: 123,
      })
    );
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "tool_result",
        messageId: "a1",
        toolCallId: "tc-1",
        toolName: "create_html_artifact",
        toolResult: { success: true },
      })
    );

    const rows = presenter.getState().messages;
    const call = rows.find((m) => m.id === "tool-call-tc-1");
    const result = rows.find((m) => m.id === "tool-result-tc-1");
    expect(call?.metadata?.toolName).toBe("create_html_artifact");
    expect(call?.metadata?.toolProgress?.phase).toBe("running");
    expect(call?.metadata?.toolProgress?.progress).toBe(0.5);
    expect(result?.metadata?.toolCallId).toBe("tc-1");
  });

  it("seeds history, prepends older pages, and trims the window", () => {
    const presenter = createWorkspaceStreamPresenter();
    presenter.seedHistory([
      {
        id: "m2",
        conversationId: "v2-c",
        role: "user",
        content: "two",
        timestamp: "2026-08-20T10:00:00Z",
        messageType: MessageType.MESSAGE,
      },
    ]);
    presenter.prependHistory([
      {
        id: "m1",
        conversationId: "v2-c",
        role: "user",
        content: "one",
        timestamp: "2026-08-20T09:00:00Z",
        messageType: MessageType.MESSAGE,
      },
    ]);
    expect(presenter.getState().messages.map((m) => m.id)).toEqual([
      "m1",
      "m2",
    ]);
    // Prepending an existing id does not duplicate.
    presenter.prependHistory([
      {
        id: "m1",
        conversationId: "v2-c",
        role: "user",
        content: "one",
        timestamp: "2026-08-20T09:00:00Z",
        messageType: MessageType.MESSAGE,
      },
    ]);
    expect(presenter.getState().messages).toHaveLength(2);

    presenter.trimToWindow(1);
    expect(presenter.getState().messages.map((m) => m.id)).toEqual(["m2"]);
  });

  it("dispose clears buffers without touching state ownership", () => {
    const scheduler = manualScheduler();
    const presenter = createWorkspaceStreamPresenter(scheduler.options);
    presenter.applyEvent(
      event("v2-c", "run-1", { eventType: "start", messageId: "a1" })
    );
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "token",
        messageId: "a1",
        contentDelta: "x",
      })
    );
    presenter.dispose();
    expect(presenter.getState().unflushedDeltaCount).toBe(0);
    expect(presenter.getState().messages).toHaveLength(0);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("maps error and cancelled terminals to stream status", () => {
    const presenter = createWorkspaceStreamPresenter({
      scheduleFlush: () => () => undefined,
    });
    presenter.applyEvent(
      event("v2-c", "run-1", { eventType: "start", messageId: "a1" })
    );
    presenter.applyEvent(
      event("v2-c", "run-1", {
        eventType: "error",
        messageId: "a1",
        errorMessage: "provider failed",
      })
    );
    expect(presenter.getState().streamStatus).toBe("error");
    expect(presenter.getState().errorMessage).toBe("provider failed");

    // A fresh run that is cancelled.
    presenter.applyEvent(
      event("v2-c", "run-2", { eventType: "start", messageId: "a2" })
    );
    presenter.applyEvent(
      event("v2-c", "run-2", {
        eventType: "cancelled",
        messageId: "a2",
        fullContent: "partial",
      })
    );
    expect(presenter.getState().streamStatus).toBe("cancelled");
  });
});
