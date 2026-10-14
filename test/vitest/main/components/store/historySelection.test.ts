import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHistorySelectionStore } from "@/views/store/historySelection";
import { createPinia, setActivePinia } from "pinia";

beforeEach(() => {
  setActivePinia(createPinia());
  useHistorySelectionStore().clearAll();
});

/**
 * B14: history selection drafts + submission identities are
 * conversation-keyed with a defined lifecycle — stable across switches and
 * remounts, resolved only by acceptance, rotated on intentional change.
 */
describe("historySelection store (B14)", () => {
  it("keeps per-conversation chips isolated", () => {
    const store = useHistorySelectionStore();
    store.setItems("conv-a", [
      { sourceId: "s1", preview: "p1", estimatedTokens: 10 },
    ]);
    expect(store.getItems("conv-b")).toEqual([]);
    expect(store.getItems("conv-a")).toHaveLength(1);
  });

  it("reuses the submission identity across retrievals until resolved", () => {
    const store = useHistorySelectionStore();
    const first = store.ensureSubmissionId("conv-a");
    // A→B→A round-trip and transport retries observe the SAME identity.
    expect(store.ensureSubmissionId("conv-a")).toBe(first);
    expect(store.peekSubmissionId("conv-a")).toBe(first);
    // Acceptance (accepted or mixed) resolves it; the next draft mints fresh.
    store.resolveSubmission("conv-a");
    expect(store.peekSubmissionId("conv-a")).toBeNull();
    expect(store.ensureSubmissionId("conv-a")).not.toBe(first);
  });

  it("rotates a pending identity on intentional chip change", () => {
    const store = useHistorySelectionStore();
    store.setItems("conv-a", [
      { sourceId: "s1", preview: "p1", estimatedTokens: 10 },
    ]);
    const first = store.ensureSubmissionId("conv-a");
    store.setItems("conv-a", [
      { sourceId: "s1", preview: "p1", estimatedTokens: 10 },
      { sourceId: "s2", preview: "p2", estimatedTokens: 5 },
    ]);
    // Changed payload: the old identity must never be reused for it.
    expect(store.peekSubmissionId("conv-a")).toBeNull();
    expect(store.ensureSubmissionId("conv-a")).not.toBe(first);
  });

  it("survives a store re-read (remount) within the session", () => {
    const first = useHistorySelectionStore();
    first.setItems("conv-a", [
      { sourceId: "s1", preview: "p1", estimatedTokens: 10 },
    ]);
    const id = first.ensureSubmissionId("conv-a");
    // A remounted surface reads the same pinia store instance.
    const second = useHistorySelectionStore();
    expect(second.getItems("conv-a")).toHaveLength(1);
    expect(second.ensureSubmissionId("conv-a")).toBe(id);
  });

  it("returns isolated copies that cannot mutate store state", () => {
    const store = useHistorySelectionStore();
    const input = [{ sourceId: "s1", preview: "p1", estimatedTokens: 10 }];
    store.setItems("conv-a", input);
    // Mutating the caller's array after setItems must not affect the store.
    input.push({ sourceId: "s2", preview: "p2", estimatedTokens: 5 });
    expect(store.getItems("conv-a")).toHaveLength(1);
    // Each chip is cloned on the way in and out: the surface's working copy
    // shares no object refs with the drafts map, so a caller-held mutation
    // can never corrupt store state except through setItems (which handles
    // cap + submission-identity rotation).
    expect(store.getItems("conv-a")[0]).not.toBe(
      input[0] as unknown as object
    );
    const retrieved = store.getItems("conv-a");
    retrieved.push({ sourceId: "s3", preview: "p3", estimatedTokens: 1 });
    expect(store.getItems("conv-a")).toHaveLength(1);
    expect(store.getItems("conv-a")[0]).not.toBe(
      retrieved[0] as unknown as object
    );
  });
});
