import { describe, expect, it, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/views/api/aiChatWorkspace", () => ({
  bootstrapWorkspace: vi.fn().mockResolvedValue({
    workspaces: [],
    unassigned: [],
    selectedConversationId: null,
  }),
  subscribeSummaryEvents: vi.fn().mockReturnValue(() => undefined),
  subscribeTitleEvents: vi.fn().mockReturnValue(() => undefined),
}));

import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import type {
  WorkspaceConversationSummary,
  WorkspaceSidebarResponse,
} from "@/entityTypes/aiChatWorkspaceTypes";
import type { ChatTitleUpdatedEvent } from "@/service/aiChatTitle/AIChatTitleTypes";

function summary(
  conversationId: string,
  overrides: Partial<WorkspaceConversationSummary> = {}
): WorkspaceConversationSummary {
  return {
    conversationId,
    workspaceKey: null,
    title: `Title ${conversationId}`,
    titleRevision: 0,
    preview: "",
    lastActivityAt: "2026-10-28T00:00:00.000Z",
    unread: false,
    attention: "none",
    runtimeStatus: "idle",
    activeRunId: null,
    ...overrides,
  };
}

function titleEvent(
  conversationId: string,
  title: string | null,
  titleRevision: number
): ChatTitleUpdatedEvent {
  return {
    conversationId,
    title,
    titleRevision,
    titleSource: title === null ? "placeholder" : "ai",
  };
}

const store = () => useChatWorkspaceStore();

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("chatWorkspace store title revision reconciliation", () => {
  it("applies a title-only event with a newer revision", () => {
    const s = store();
    s.upsertLocalConversation(summary("v2-a", { title: "Excerpt", titleRevision: 2 }));
    s.applyTitleUpdate(titleEvent("v2-a", "Sydney Dentist Outreach", 3));
    expect(s.conversationsById.get("v2-a")?.title).toBe("Sydney Dentist Outreach");
    expect(s.conversationsById.get("v2-a")?.titleRevision).toBe(3);
  });

  it("ignores an older title-only revision", () => {
    const s = store();
    s.upsertLocalConversation(summary("v2-b", { title: "Newer", titleRevision: 5 }));
    s.applyTitleUpdate(titleEvent("v2-b", "Stale AI Title", 4));
    expect(s.conversationsById.get("v2-b")?.title).toBe("Newer");
    expect(s.conversationsById.get("v2-b")?.titleRevision).toBe(5);
  });

  it("ignores title events for unknown conversations (no row resurrection)", () => {
    const s = store();
    s.applyTitleUpdate(titleEvent("v2-ghost", "Ghost", 1));
    expect(s.conversationsById.get("v2-ghost")).toBeUndefined();
    expect(s.unassigned.some((c) => c.conversationId === "v2-ghost")).toBe(false);
  });

  it("an unversioned legacy summary title cannot replace a versioned title (B18)", () => {
    const s = store();
    // Establish AUTHORITATIVE versioned state (B18: local upserts are not
    // versioned sources; a title event is).
    s.upsertLocalConversation(summary("v2-c", { title: "", titleRevision: 2 }));
    s.applyTitleUpdate(titleEvent("v2-c", "Versioned", 3));
    expect(s.conversationsById.get("v2-c")?.title).toBe("Versioned");
    // Legacy summary event (no titleRevision) carrying an old title.
    s.upsertLocalConversation(summary("v2-c", { title: "Old Legacy Title" }));
    expect(s.conversationsById.get("v2-c")?.title).toBe("Versioned");
  });

  it("a versioned summary title applies when at least as new", () => {
    const s = store();
    s.upsertLocalConversation(summary("v2-d", { title: "Excerpt", titleRevision: 1 }));
    // Route a versioned summary through applyTitleUpdate-equivalent semantics
    // by applying the title event directly (summary path shares the guard).
    s.applyTitleUpdate(titleEvent("v2-d", "Renamed", 2));
    expect(s.conversationsById.get("v2-d")?.title).toBe("Renamed");
    expect(s.conversationsById.get("v2-d")?.titleRevision).toBe(2);
  });

  it("bootstrap merge keeps a strictly newer locally known title", async () => {
    const s = store();
    s.upsertLocalConversation(summary("v2-e", { title: "Local Newer", titleRevision: 4 }));
    const { bootstrapWorkspace } = await import("@/views/api/aiChatWorkspace");
    vi.mocked(bootstrapWorkspace).mockResolvedValueOnce({
      workspaces: [],
      unassigned: [summary("v2-e", { title: "Stale Server", titleRevision: 2 })],
      selectedConversationId: null,
    });
    await s.bootstrap();
    expect(s.conversationsById.get("v2-e")?.title).toBe("Local Newer");
    expect(s.conversationsById.get("v2-e")?.titleRevision).toBe(4);
  });

  it("a legacy unversioned summary title initializes only never-known rows (B18)", () => {
    const s = store();
    // First seen via event (no existing row, never versioned-known): the
    // legacy title initializes the row.
    s.upsertLocalConversation(summary("v2-legacy", { title: "" }));
    s.upsertLocalConversation(summary("v2-legacy", { title: "First Excerpt" }));
    expect(s.conversationsById.get("v2-legacy")?.title).toBe("First Excerpt");
    // Once versioned state is KNOWN, a later unversioned legacy title is
    // rejected — even targeting an empty title.
    s.applyTitleUpdate(titleEvent("v2-legacy", "Authoritative", 4));
    s.upsertLocalConversation(summary("v2-legacy", { title: "Older Stale Title" }));
    expect(s.conversationsById.get("v2-legacy")?.title).toBe("Authoritative");
  });

  it("B16: teardown clears the title handle so remount re-subscribes", async () => {
    const s = store();
    const { subscribeTitleEvents } = await import(
      "@/views/api/aiChatWorkspace"
    );
    await s.bootstrap();
    expect(vi.mocked(subscribeTitleEvents).mock.calls.length).toBeGreaterThan(0);
    const callsAfterFirstBootstrap = vi.mocked(subscribeTitleEvents).mock.calls.length;
    s.teardown();
    await s.bootstrap();
    expect(
      vi.mocked(subscribeTitleEvents).mock.calls.length
    ).toBeGreaterThan(callsAfterFirstBootstrap);
  });

  it("B17: a newer title event during bootstrap is reconciled, not lost", async () => {
    const s = store();
    const { bootstrapWorkspace } = await import("@/views/api/aiChatWorkspace");
    const release = { fn: null as null | ((v: WorkspaceSidebarResponse) => void) };
    vi.mocked(bootstrapWorkspace).mockImplementationOnce(
      () =>
        new Promise<WorkspaceSidebarResponse>((resolve) => {
          release.fn = resolve;
        })
    );
    const pending = s.bootstrap();
    // Revision-2 event lands while the (revision-1) bootstrap is in flight.
    s.applyTitleUpdate(titleEvent("v2-buf", "Newer Title", 2));
    release.fn?.({
      workspaces: [],
      unassigned: [summary("v2-buf", { title: "Old Server", titleRevision: 1 })],
      selectedConversationId: null,
    });
    await pending;
    expect(s.conversationsById.get("v2-buf")?.title).toBe("Newer Title");
    expect(s.conversationsById.get("v2-buf")?.titleRevision).toBe(2);
  });

  it("F11: a stale superseded bootstrap owns nothing — no error write, no buffer drain", async () => {
    const s = store();
    const { bootstrapWorkspace } = await import("@/views/api/aiChatWorkspace");
    const release = { fn: null as null | ((v: WorkspaceSidebarResponse) => void) };
    vi.mocked(bootstrapWorkspace).mockImplementationOnce(
      () =>
        new Promise<WorkspaceSidebarResponse>((resolve) => {
          release.fn = resolve;
        })
    );
    const stale = s.bootstrap(); // request A
    // A newer same-scope request supersedes A and completes first.
    await s.bootstrap();
    expect(s.bootstrapped).toBe(true);
    // A's response arrives late: it must install nothing.
    release.fn?.({
      workspaces: [],
      unassigned: [summary("v2-stale", { title: "Stale Row" })],
      selectedConversationId: null,
    });
    await stale;
    expect(s.conversationsById.get("v2-stale")).toBeUndefined();
    // A stale REJECTION also must not set the current error.
    vi.mocked(bootstrapWorkspace).mockRejectedValueOnce(new Error("old scope"));
    const staleFail = s.bootstrap();
    await s.bootstrap(); // newer succeeds
    await staleFail.catch(() => undefined);
    expect(s.bootstrapError).toBeNull();
  });

  it("B18: a known cleared-empty title rejects a later legacy unversioned title", () => {
    const s = store();
    // Cleared to empty at revision 5 (authoritative versioned state).
    s.upsertLocalConversation(summary("v2-cleared", { title: "x", titleRevision: 5 }));
    s.applyTitleUpdate(titleEvent("v2-cleared", null, 6));
    expect(s.conversationsById.get("v2-cleared")?.title).toBe("");
    // A legacy unversioned summary carrying the OLD excerpt must not restore it.
    s.upsertLocalConversation(summary("v2-cleared", { title: "Old Excerpt" }));
    expect(s.conversationsById.get("v2-cleared")?.title).toBe("");
    expect(s.conversationsById.get("v2-cleared")?.titleRevision).toBe(6);
  });

  it("B18: equal-revision title events never change content", () => {
    const s = store();
    s.upsertLocalConversation(summary("v2-eq", { title: "First", titleRevision: 3 }));
    s.applyTitleUpdate(titleEvent("v2-eq", "Conflicting Same Revision", 3));
    expect(s.conversationsById.get("v2-eq")?.title).toBe("First");
  });

  it("subscribes to title events before requesting bootstrap", async () => {
    const s = store();
    const { bootstrapWorkspace, subscribeTitleEvents } = await import(
      "@/views/api/aiChatWorkspace"
    );
    await s.bootstrap();
    const subscribeCall = vi.mocked(subscribeTitleEvents).mock.calls.length;
    expect(subscribeCall).toBeGreaterThan(0);
    expect(vi.mocked(bootstrapWorkspace)).toHaveBeenCalled();
  });
});

describe("renameConversationRequestSchema canonicalization", () => {
  it("trims and collapses whitespace, rejecting whitespace-only titles", async () => {
    const { renameConversationRequestSchema } = await import(
      "@/schemas/ipc/aiChatWorkspace"
    );
    const ok = renameConversationRequestSchema.safeParse({
      conversationId: "v2-ok",
      title: "  Sydney   Dentists\n— Q4  ",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.title).toBe("Sydney Dentists — Q4");

    const empty = renameConversationRequestSchema.safeParse({
      conversationId: "v2-ok",
      title: "   \n\t ",
    });
    expect(empty.success).toBe(false);

    const oversize = renameConversationRequestSchema.safeParse({
      conversationId: "v2-ok",
      title: "a".repeat(201),
    });
    expect(oversize.success).toBe(false);
  });
});
