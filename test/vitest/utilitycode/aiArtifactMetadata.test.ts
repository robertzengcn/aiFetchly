/**
 * Tests for the renderer-side artifact metadata extraction that drives the
 * chat card and auto-open behavior. Verifies malformed payloads never
 * produce a renderable card.
 */
import { describe, it, expect } from "vitest";
import {
  extractArtifactMetadata,
  extractToolOutputDescriptors,
  ensureArtifactMetadata,
  ensureToolOutputMetadata,
  type MessageWithMaybeArtifactMetadata,
} from "@/views/components/aiChatV2/artifactMetadata";

describe("extractArtifactMetadata", () => {
  const valid = {
    artifact: {
      id: "artifact-1",
      conversationId: "v2-c",
      type: "html",
      title: "Report",
      description: "desc",
      mimeType: "text/html",
      version: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      openImmediately: true,
    },
  };

  it("returns typed metadata for a valid artifact result", () => {
    const meta = extractArtifactMetadata(valid);
    expect(meta).not.toBeUndefined();
    expect(meta?.id).toBe("artifact-1");
    expect(meta?.type).toBe("html");
    expect(meta?.mimeType).toBe("text/html");
    expect(meta?.version).toBe(2);
    expect(meta?.openImmediately).toBe(true);
  });

  it("defaults openImmediately to true when absent", () => {
    const meta = extractArtifactMetadata({
      artifact: { ...valid.artifact, openImmediately: undefined },
    });
    expect(meta?.openImmediately).toBe(true);
  });

  it("respects openImmediately=false", () => {
    const meta = extractArtifactMetadata({
      artifact: { ...valid.artifact, openImmediately: false },
    });
    expect(meta?.openImmediately).toBe(false);
  });

  it("returns undefined when there is no artifact field", () => {
    expect(extractArtifactMetadata({})).toBeUndefined();
    expect(extractArtifactMetadata(undefined)).toBeUndefined();
    expect(extractArtifactMetadata(null)).toBeUndefined();
  });

  it("returns undefined when the artifact is not an object", () => {
    expect(extractArtifactMetadata({ artifact: "nope" })).toBeUndefined();
    expect(extractArtifactMetadata({ artifact: 42 })).toBeUndefined();
  });

  it("returns undefined for a wrong type or mimeType", () => {
    expect(
      extractArtifactMetadata({
        artifact: { ...valid.artifact, type: "markdown" },
      })
    ).toBeUndefined();
    expect(
      extractArtifactMetadata({
        artifact: { ...valid.artifact, mimeType: "text/plain" },
      })
    ).toBeUndefined();
  });

  it("returns undefined when required string fields are missing", () => {
    expect(
      extractArtifactMetadata({ artifact: { ...valid.artifact, id: 123 } })
    ).toBeUndefined();
    expect(
      extractArtifactMetadata({
        artifact: { ...valid.artifact, title: undefined },
      })
    ).toBeUndefined();
  });

  it("defaults missing optional fields safely", () => {
    const meta = extractArtifactMetadata({
      artifact: {
        id: "a",
        type: "html",
        title: "T",
        mimeType: "text/html",
      },
    });
    expect(meta?.description).toBeUndefined();
    expect(meta?.version).toBe(1);
    expect(meta?.conversationId).toBe("");
    // createdAt/updatedAt fall back to an ISO string.
    expect(typeof meta?.createdAt).toBe("string");
    expect(meta?.createdAt.length).toBeGreaterThan(0);
  });
});

// Regression: PRD ART-009 — artifact card must reappear when a conversation
// is reopened. Persisted tool-result rows carry the artifact nested inside
// `metadata.toolResult`; the renderer must re-derive the `metadata.artifact`
// shortcut on history load or the card disappears after close/reopen.
// Found by /qa on 2026-07-20.
describe("ensureArtifactMetadata (history reopen regression)", () => {
  const persistedToolResult = {
    success: true,
    artifact: {
      id: "artifact-hist",
      conversationId: "v2-c",
      type: "html",
      title: "Old report",
      mimeType: "text/html",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      openImmediately: true,
    },
    summary: "Created HTML artifact: Old report",
  };

  it("derives metadata.artifact from a persisted toolResult on history load", () => {
    const msg: MessageWithMaybeArtifactMetadata = {
      metadata: { toolResult: persistedToolResult },
    };
    const out = ensureArtifactMetadata(msg);
    expect(out.metadata?.artifact?.id).toBe("artifact-hist");
    // Original toolResult is preserved alongside the new shortcut.
    expect(out.metadata?.toolResult).toBe(persistedToolResult);
  });

  it("returns the message unchanged when artifact shortcut already present", () => {
    const existing = { id: "already-set" };
    const msg: MessageWithMaybeArtifactMetadata = {
      metadata: {
        toolResult: persistedToolResult,
        artifact: existing as never,
      },
    };
    expect(ensureArtifactMetadata(msg).metadata?.artifact).toBe(existing);
  });

  it("returns the message unchanged when toolResult has no artifact", () => {
    const msg: MessageWithMaybeArtifactMetadata = {
      metadata: { toolResult: { success: true, summary: "ok" } },
    };
    expect(ensureArtifactMetadata(msg).metadata?.artifact).toBeUndefined();
  });

  it("returns the message unchanged when there is no metadata", () => {
    const msg: MessageWithMaybeArtifactMetadata = { messageType: "message" };
    expect(ensureArtifactMetadata(msg)).toBe(msg);
  });

  it("does not mutate the input (immutability)", () => {
    const msg: MessageWithMaybeArtifactMetadata = {
      metadata: { toolResult: persistedToolResult },
    };
    const before = JSON.parse(JSON.stringify(msg));
    ensureArtifactMetadata(msg);
    expect(JSON.parse(JSON.stringify(msg))).toEqual(before);
  });
});

// Regression: PRD §11 cross-restart durability — the preserved-output receipt
// card must reappear when a conversation is reopened. Persisted tool-result rows
// nest the descriptors (`toolOutputRefs`/`toolOutputPreservation`/`toolOutputPreview`)
// under `metadata.toolResult`; the renderer reads them at metadata top level.
// Without a lift on history load the card never renders from persisted state.
describe("ensureToolOutputMetadata (history reopen regression)", () => {
  const persistedToolResult = {
    success: true,
    operationStatus: "complete",
    toolOutputRefs: [
      {
        outputId: "out_0123456789abcdef0123456789abcdef",
        capturedBytes: 2048,
        preservation: "complete",
        sourceCompleteness: "complete",
      },
    ],
    toolOutputPreservation: "complete",
    toolOutputPreview: "first line...",
    summary: "ok",
  };

  it("lifts all three tool-output descriptors to metadata top level", () => {
    const msg: MessageWithMaybeArtifactMetadata = {
      metadata: { toolResult: persistedToolResult },
    };
    const out = ensureToolOutputMetadata(msg);
    expect(out.metadata?.toolOutputRefs).toBe(
      persistedToolResult.toolOutputRefs
    );
    expect(out.metadata?.toolOutputPreservation).toBe("complete");
    expect(out.metadata?.toolOutputPreview).toBe("first line...");
    // The nested toolResult is preserved.
    expect(out.metadata?.toolResult).toBe(persistedToolResult);
  });

  it("lifts only the keys that are absent at top level (partial shortcut)", () => {
    const existingRefs = [{ outputId: "out_existing", capturedBytes: 1 }];
    const msg: MessageWithMaybeArtifactMetadata = {
      metadata: {
        toolResult: persistedToolResult,
        toolOutputRefs: existingRefs as never,
      },
    };
    const out = ensureToolOutputMetadata(msg);
    // Existing top-level slot is NOT overwritten.
    expect(out.metadata?.toolOutputRefs).toBe(existingRefs);
    // The other two absent keys are still lifted.
    expect(out.metadata?.toolOutputPreservation).toBe("complete");
    expect(out.metadata?.toolOutputPreview).toBe("first line...");
  });

  it("returns the message unchanged when no descriptors are nested", () => {
    const msg: MessageWithMaybeArtifactMetadata = {
      metadata: { toolResult: { success: true, summary: "no outputs" } },
    };
    expect(ensureToolOutputMetadata(msg)).toBe(msg);
  });

  it("returns the message unchanged when there is no toolResult", () => {
    const msg: MessageWithMaybeArtifactMetadata = {
      metadata: { toolOutputRefs: [] as never },
    };
    expect(ensureToolOutputMetadata(msg)).toBe(msg);
  });

  it("returns the message unchanged when there is no metadata", () => {
    const msg: MessageWithMaybeArtifactMetadata = { messageType: "message" };
    expect(ensureToolOutputMetadata(msg)).toBe(msg);
  });

  it("composes with ensureArtifactMetadata without clobbering either lift", () => {
    // A persisted row can carry BOTH an artifact and tool-output descriptors
    // nested under toolResult. loadHistory applies ensureToolOutputMetadata(
    // ensureArtifactMetadata(m)) — both shortcuts must end up at top level.
    const withBoth = {
      ...persistedToolResult,
      artifact: {
        id: "artifact-x",
        conversationId: "c",
        type: "html",
        title: "T",
        mimeType: "text/html",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        openImmediately: true,
      },
    };
    const msg: MessageWithMaybeArtifactMetadata = {
      metadata: { toolResult: withBoth },
    };
    const out = ensureToolOutputMetadata(ensureArtifactMetadata(msg));
    expect(out.metadata?.artifact?.id).toBe("artifact-x");
    expect(out.metadata?.toolOutputRefs).toBe(withBoth.toolOutputRefs);
    expect(out.metadata?.toolOutputPreservation).toBe("complete");
    expect(out.metadata?.toolOutputPreview).toBe("first line...");
  });

  it("does not mutate the input (immutability)", () => {
    const msg: MessageWithMaybeArtifactMetadata = {
      metadata: { toolResult: persistedToolResult },
    };
    const before = JSON.parse(JSON.stringify(msg));
    ensureToolOutputMetadata(msg);
    expect(JSON.parse(JSON.stringify(msg))).toEqual(before);
  });
});

// Regression: PRD §11 — the preserved-output receipt card must render during a
// LIVE tool_result stream, not only after a history reopen. The live
// `upsertToolResultMessage` handler extracts descriptors from the payload to
// metadata top level (the same boundary `artifact` uses); without this the
// capture pipeline runs (descriptors are present in the payload, spread there
// by `toolResultReceiptUiMetadata`) but the renderer reads them at the top
// level and the card never appears. Found while running the T18 E2E spec.
describe("extractToolOutputDescriptors (live stream render regression)", () => {
  const validPayload = {
    success: true,
    toolResultReceipt: { schemaVersion: 1 },
    operationStatus: "complete",
    toolOutputRefs: [
      {
        outputId: "out_0123456789abcdef0123456789abcdef",
        capturedBytes: 102400,
        preservation: "complete" as const,
        sourceCompleteness: "complete" as const,
      },
    ],
    toolOutputPreservation: "complete" as const,
    toolOutputPreview: "first line...",
    previewComplete: true,
  };

  it("returns validated descriptors for a live externalized payload", () => {
    const out = extractToolOutputDescriptors(validPayload);
    expect(out).not.toBeUndefined();
    expect(out?.toolOutputRefs).toHaveLength(1);
    expect(out?.toolOutputRefs[0].outputId).toBe(
      "out_0123456789abcdef0123456789abcdef"
    );
    expect(out?.toolOutputRefs[0].capturedBytes).toBe(102400);
    expect(out?.toolOutputPreservation).toBe("complete");
    expect(out?.toolOutputPreview).toBe("first line...");
  });

  it("defaults preview to empty string when absent", () => {
    const { toolOutputPreview, ...noPreview } = validPayload;
    void toolOutputPreview;
    const out = extractToolOutputDescriptors(noPreview);
    expect(out?.toolOutputPreview).toBe("");
  });

  it("returns undefined when there are no refs (inline result)", () => {
    expect(
      extractToolOutputDescriptors({ success: true, toolOutputRefs: [] })
    ).toBeUndefined();
    expect(
      extractToolOutputDescriptors({ success: true })
    ).toBeUndefined();
  });

  it("returns undefined for a malformed ref entry", () => {
    expect(
      extractToolOutputDescriptors({
        ...validPayload,
        toolOutputRefs: [{ outputId: 123, capturedBytes: 1 }],
      })
    ).toBeUndefined();
    expect(
      extractToolOutputDescriptors({
        ...validPayload,
        toolOutputRefs: [{ outputId: "x", capturedBytes: 1, preservation: "bad" }],
      })
    ).toBeUndefined();
    expect(
      extractToolOutputDescriptors({
        ...validPayload,
        toolOutputRefs: [
          {
            outputId: "x",
            capturedBytes: 1,
            preservation: "complete",
            sourceCompleteness: "wrong",
          },
        ],
      })
    ).toBeUndefined();
  });

  it("returns undefined when preservation is malformed", () => {
    expect(
      extractToolOutputDescriptors({
        ...validPayload,
        toolOutputPreservation: "maybe",
      })
    ).toBeUndefined();
  });

  it("returns undefined when preview is not a string", () => {
    expect(
      extractToolOutputDescriptors({
        ...validPayload,
        toolOutputPreview: 42,
      })
    ).toBeUndefined();
  });

  it("returns undefined for null/undefined/non-object payloads", () => {
    expect(extractToolOutputDescriptors(undefined)).toBeUndefined();
    expect(extractToolOutputDescriptors(null)).toBeUndefined();
    // A non-object payload is rejected at runtime; the cast mirrors how a
    // defensive boundary would receive genuinely unknown input.
    expect(extractToolOutputDescriptors("nope" as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it("does not mutate the input (immutability)", () => {
    const before = JSON.parse(JSON.stringify(validPayload));
    extractToolOutputDescriptors(validPayload);
    expect(JSON.parse(JSON.stringify(validPayload))).toEqual(before);
  });
});
