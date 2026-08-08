/**
 * Tests for the renderer-side artifact metadata extraction that drives the
 * chat card and auto-open behavior. Verifies malformed payloads never
 * produce a renderable card.
 */
import { describe, it, expect } from "vitest";
import {
  extractArtifactMetadata,
  ensureArtifactMetadata,
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
