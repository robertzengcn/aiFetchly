import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { WorkspaceConversationSummary } from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * Audit R7 (2026-10-22-r7) — R7-03: the selected conversation is lost across
 * a renderer reload, so a run completing after the reload reconnects to a
 * conversation nobody has selected (its transcript only reappears if the
 * user re-clicks the row).
 *
 * The fix persists a lightweight selection POINTER in localStorage. The
 * restore deliberately does NOT validate against the boot-time sidebar
 * projection: durable summary rows for turns completed in the previous
 * session materialize later (once-per-process backfill + summary events),
 * so the projection legitimately lags at boot. The AUTHORITATIVE validator
 * is the selection handshake's runtime snapshot — an unknown/deleted
 * conversation hydrates an empty transcript and never starts a run; the
 * pointer itself is a best-effort last-selection breadcrumb.
 */

vi.mock("@/views/api/aiChatWorkspace", () => ({
  bootstrapWorkspace: vi.fn(),
  subscribeSummaryEvents: vi.fn().mockReturnValue(() => undefined),
}));

import { bootstrapWorkspace } from "@/views/api/aiChatWorkspace";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";

const SELECTED_POINTER_KEY = "aiChatWorkspace.selectedConversation";

const bootstrapWorkspaceMock = vi.mocked(bootstrapWorkspace);

function summary(
  conversationId: string,
  overrides: Partial<WorkspaceConversationSummary> = {}
): WorkspaceConversationSummary {
  return {
    conversationId,
    workspaceKey: null,
    title: `Title ${conversationId}`,
    preview: "",
    lastActivityAt: "2026-10-22T00:00:00.000Z",
    unread: false,
    attention: "none",
    runtimeStatus: "idle",
    activeRunId: null,
    ...overrides,
  };
}

async function bootstrapWith(
  conversations: WorkspaceConversationSummary[]
): Promise<void> {
  bootstrapWorkspaceMock.mockResolvedValueOnce({
    workspaces: [],
    unassigned: conversations,
    selectedConversationId: null,
  });
  const store = useChatWorkspaceStore();
  await store.bootstrap();
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  bootstrapWorkspaceMock.mockReset();
  bootstrapWorkspaceMock.mockResolvedValue({
    workspaces: [],
    unassigned: [],
    selectedConversationId: null,
  });
});

describe("selection pointer persistence (audit R7-03)", () => {
  it("persists the selected conversation id on every selection", () => {
    const store = useChatWorkspaceStore();
    expect(localStorage.getItem(SELECTED_POINTER_KEY)).toBeNull();

    store.setSelected("conv-1");
    expect(localStorage.getItem(SELECTED_POINTER_KEY)).toBe("conv-1");

    // Explicit deselection (delete flow) drops the pointer immediately.
    store.setSelected(null);
    expect(localStorage.getItem(SELECTED_POINTER_KEY)).toBeNull();
  });

  it("returns the stored pointer before or without any bootstrap", () => {
    localStorage.setItem(SELECTED_POINTER_KEY, "conv-1");
    const store = useChatWorkspaceStore();
    // No bootstrap ran: the sidebar projection is not the validator —
    // the store hands the back the pointer for the selection handshake.
    expect(store.consumeRestorableSelectionPointer()).toBe("conv-1");
  });

  it("keeps returning the pointer even when bootstrap failed", async () => {
    localStorage.setItem(SELECTED_POINTER_KEY, "conv-1");
    bootstrapWorkspaceMock.mockRejectedValueOnce(new Error("offline"));
    const store = useChatWorkspaceStore();
    await store.bootstrap();
    // The restore path's authority is the loadSelection snapshot, not the
    // project — a failed bootstrap must not silently strand the pointer.
    expect(store.consumeRestorableSelectionPointer()).toBe("conv-1");
  });

  it("overwrites the pointer on each re-selection (last selection wins)", async () => {
    await bootstrapWith([summary("conv-1"), summary("conv-2")]);
    const store = useChatWorkspaceStore();
    store.setSelected("conv-1");
    store.setSelected("conv-2");
    expect(localStorage.getItem(SELECTED_POINTER_KEY)).toBe("conv-2");
  });

  it("returns null when nothing was stored", async () => {
    await bootstrapWith([summary("conv-1")]);
    const store = useChatWorkspaceStore();
    expect(store.consumeRestorableSelectionPointer()).toBeNull();
  });

  it("keeps an already-active selection without a restore", async () => {
    await bootstrapWith([summary("conv-1"), summary("conv-2")]);
    const store = useChatWorkspaceStore();
    // A selection is already active (deep link / notification entry won the
    // race before the restore ran) — the pointer must not override it.
    store.setSelected("conv-1");
    // Simulate a stale pointer left by the PREVIOUS session that the fresh
    // selection has not yet overwritten (notified entry selected conv-1 and
    // bootstrap's projected conv-2 pointer is read only afterwards).
    localStorage.setItem(SELECTED_POINTER_KEY, "conv-2");
    expect(store.consumeRestorableSelectionPointer()).toBeNull();
    // The pointer is untouched; the next explicit selection re-aligns it.
    expect(localStorage.getItem(SELECTED_POINTER_KEY)).toBe("conv-2");
  });
});
