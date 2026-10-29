import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  COMPOSER_DRAFT_CAP,
  composerDraftKeyFor,
  useComposerDraftStore,
} from "@/views/store/composerDrafts";

describe("composerDrafts store (FR-COMP-011)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("returns null for unknown keys and pending keys map to the sentinel", () => {
    const store = useComposerDraftStore();
    expect(store.getDraft("conv-1")).toBeNull();
    expect(composerDraftKeyFor(null)).toBe("__pending_conversation__");
    expect(composerDraftKeyFor("conv-1")).toBe("conv-1");
  });

  it("updates the composer slice while preserving generated-image references", () => {
    const store = useComposerDraftStore();
    store.setGeneratedImageReferences("conv-1", [
      { messageId: "m1", imageIndex: 0 },
    ]);
    store.updateComposerState("conv-1", "typed", [], {}, []);

    const draft = store.getDraft("conv-1");
    expect(draft?.text).toBe("typed");
    expect(draft?.generatedImageReferences).toEqual([
      { messageId: "m1", imageIndex: 0 },
    ]);
  });

  it("updates the reference tray while preserving typed content", () => {
    const store = useComposerDraftStore();
    store.updateComposerState("conv-1", "typed", [], {}, []);
    store.setGeneratedImageReferences("conv-1", [
      { messageId: "m1", imageIndex: 1 },
    ]);
    expect(store.getDraft("conv-1")?.text).toBe("typed");
    expect(store.getDraft("conv-1")?.generatedImageReferences).toEqual([
      { messageId: "m1", imageIndex: 1 },
    ]);
  });

  it("deletes entries that become empty (bounded memory)", () => {
    const store = useComposerDraftStore();
    store.updateComposerState("conv-1", "typed", [], {}, []);
    expect(store.drafts.size).toBe(1);
    store.clearDraft("conv-1");
    expect(store.drafts.size).toBe(0);
    expect(store.getDraft("conv-1")).toBeNull();
  });

  it("keeps drafts isolated per conversation", () => {
    const store = useComposerDraftStore();
    store.updateComposerState("conv-1", "one", [], {}, []);
    store.updateComposerState("conv-2", "two", [], {}, []);
    store.setGeneratedImageReferences("conv-2", [
      { messageId: "m2", imageIndex: 0 },
    ]);
    expect(store.getDraft("conv-1")?.text).toBe("one");
    expect(store.getDraft("conv-1")?.generatedImageReferences).toEqual([]);
    expect(store.getDraft("conv-2")?.generatedImageReferences).toEqual([
      { messageId: "m2", imageIndex: 0 },
    ]);
  });

  it("evicts the oldest conversation's draft beyond the cap without dropping active keys", () => {
    const store = useComposerDraftStore();
    for (let i = 0; i < COMPOSER_DRAFT_CAP; i += 1) {
      store.updateComposerState(`conv-${i}`, `text-${i}`, [], {}, []);
    }
    expect(store.drafts.size).toBe(COMPOSER_DRAFT_CAP);

    // A NEW key beyond the cap evicts the oldest inserted key…
    store.setGeneratedImageReferences("conv-new", [
      { messageId: "m", imageIndex: 0 },
    ]);
    expect(store.drafts.size).toBe(COMPOSER_DRAFT_CAP);
    expect(store.getDraft("conv-0")).toBeNull();
    expect(store.getDraft("conv-1")).not.toBeNull();
    // …and the just-written key survives.
    expect(store.getDraft("conv-new")?.generatedImageReferences).toEqual([
      { messageId: "m", imageIndex: 0 },
    ]);
  });
});
