/**
 * WorkspaceWatchProtocol — WAT-06 zod schema tests.
 *
 * The worker↔main IPC boundary is UNTRUSTED on the worker→main side even
 * though we forked the worker ourselves (a buggy or future-compromised
 * worker could emit a malformed message). The manager (Plan 14-02) will
 * `workerEventSchema.safeParse(msg)` every event before use and terminate
 * + restart the worker on parse failure. These table-driven tests assert
 * the accept/reject contract that the manager relies on.
 *
 * Acceptance (per PLAN.md Task 1):
 *   - safeParse accepts all 4 main→worker commands and all 4 worker→main events
 *   - safeParse rejects: missing workspaceId, empty workspaceRoot, unknown type
 *     literal, oversized error.message (>2000 chars), non-string fields
 *   - the schemas reuse the existing Phase 13 snapshot/diff/diagnostic shape
 *     (referenced, not redefined inline)
 */

import { describe, expect, it } from "vitest";
import {
  workerCommandSchema,
  workerEventSchema,
} from "@/service/workspaceWatch/WorkspaceWatchProtocol";
import type { AIFetchlyConfigSnapshot } from "@/entityTypes/aifetchlyConfigTypes";

/** Minimal snapshot helper — shape conforms to AIFetchlyConfigSnapshot. */
function emptySnapshot(workspaceId = "w1"): AIFetchlyConfigSnapshot {
  return {
    source: "workspace",
    sourceId: `workspace:${workspaceId}`,
    rootPath: "/tmp/ws",
    version: 1,
    files: [],
    instructions: [],
    commands: [],
    agents: [],
    hooks: [],
    skills: [],
    diagnostics: [],
  };
}

/** Minimal diff helper. */
const EMPTY_DIFF = {
  added: [],
  changed: [],
  removed: [],
  commandsChanged: false,
  agentsChanged: false,
  skillsChanged: false,
  hooksChanged: false,
  instructionsChanged: false,
  diagnosticsChanged: false,
};

describe("workerCommandSchema (main → worker) — WAT-06 accept cases", () => {
  it("accepts watch-workspace with all fields", () => {
    const r = workerCommandSchema.safeParse({
      type: "watch-workspace",
      workspaceId: "w1",
      workspaceRoot: "/tmp/ws",
      includeRootAgentsFile: true,
    });
    expect(r.success).toBe(true);
  });

  it("accepts unwatch-workspace", () => {
    const r = workerCommandSchema.safeParse({
      type: "unwatch-workspace",
      workspaceId: "w1",
    });
    expect(r.success).toBe(true);
  });

  it("accepts rescan-workspace", () => {
    const r = workerCommandSchema.safeParse({
      type: "rescan-workspace",
      workspaceId: "w1",
    });
    expect(r.success).toBe(true);
  });

  it("accepts shutdown", () => {
    const r = workerCommandSchema.safeParse({ type: "shutdown" });
    expect(r.success).toBe(true);
  });
});

describe("workerCommandSchema (main → worker) — WAT-06 reject cases", () => {
  it("rejects unknown command type literal", () => {
    const r = workerCommandSchema.safeParse({
      type: "watch-everything",
      workspaceId: "w1",
    });
    expect(r.success).toBe(false);
  });

  it("rejects watch-workspace with empty workspaceId", () => {
    const r = workerCommandSchema.safeParse({
      type: "watch-workspace",
      workspaceId: "",
      workspaceRoot: "/tmp/ws",
      includeRootAgentsFile: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects watch-workspace with empty workspaceRoot", () => {
    const r = workerCommandSchema.safeParse({
      type: "watch-workspace",
      workspaceId: "w1",
      workspaceRoot: "",
      includeRootAgentsFile: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects watch-workspace with non-boolean includeRootAgentsFile", () => {
    const r = workerCommandSchema.safeParse({
      type: "watch-workspace",
      workspaceId: "w1",
      workspaceRoot: "/tmp/ws",
      includeRootAgentsFile: "yes",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unwatch-workspace with missing workspaceId", () => {
    const r = workerCommandSchema.safeParse({ type: "unwatch-workspace" });
    expect(r.success).toBe(false);
  });

  it("rejects rescan-workspace with non-string workspaceId", () => {
    const r = workerCommandSchema.safeParse({
      type: "rescan-workspace",
      workspaceId: 42,
    });
    expect(r.success).toBe(false);
  });

  it("rejects shutdown carrying unexpected type payload", () => {
    const r = workerCommandSchema.safeParse({ type: "shutdown", workspaceId: "w1" });
    // shutdown takes no other fields; an extra field is a parse fail under strict mode.
    expect(r.success).toBe(false);
  });

  it("rejects a completely malformed payload (not an object)", () => {
    const r = workerCommandSchema.safeParse("not-an-object");
    expect(r.success).toBe(false);
  });
});

describe("workerEventSchema (worker → main) — WAT-06 accept cases", () => {
  it("accepts snapshot event", () => {
    const r = workerEventSchema.safeParse({
      type: "snapshot",
      workspaceId: "w1",
      snapshot: emptySnapshot(),
    });
    expect(r.success).toBe(true);
  });

  it("accepts changed event with diff", () => {
    const r = workerEventSchema.safeParse({
      type: "changed",
      workspaceId: "w1",
      snapshot: emptySnapshot(),
      diff: EMPTY_DIFF,
    });
    expect(r.success).toBe(true);
  });

  it("accepts diagnostic event", () => {
    const r = workerEventSchema.safeParse({
      type: "diagnostic",
      workspaceId: "w1",
      diagnostic: {
        severity: "warning",
        source: "workspace",
        sourceId: "workspace:w1",
        filePath: "AGENTS.md",
        code: "file-too-large",
        message: "AGENTS.md too large",
        recoverable: true,
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts error event at the size boundary (2000 chars)", () => {
    const r = workerEventSchema.safeParse({
      type: "error",
      workspaceId: "w1",
      message: "x".repeat(2000),
      recoverable: false,
    });
    expect(r.success).toBe(true);
  });
});

describe("workerEventSchema (worker → main) — WAT-06 reject cases", () => {
  it("rejects unknown event type literal", () => {
    const r = workerEventSchema.safeParse({
      type: "warning",
      workspaceId: "w1",
      message: "hi",
    });
    expect(r.success).toBe(false);
  });

  it("rejects error event with missing workspaceId", () => {
    const r = workerEventSchema.safeParse({
      type: "error",
      message: "boom",
      recoverable: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects error event with oversized message (>2000 chars per §14.4)", () => {
    const r = workerEventSchema.safeParse({
      type: "error",
      workspaceId: "w1",
      message: "x".repeat(2001),
      recoverable: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects error event with non-boolean recoverable flag", () => {
    const r = workerEventSchema.safeParse({
      type: "error",
      workspaceId: "w1",
      message: "boom",
      recoverable: "maybe",
    });
    expect(r.success).toBe(false);
  });

  it("rejects snapshot event with non-object snapshot payload", () => {
    const r = workerEventSchema.safeParse({
      type: "snapshot",
      workspaceId: "w1",
      snapshot: "not-a-snapshot",
    });
    expect(r.success).toBe(false);
  });

  it("rejects snapshot event for empty workspaceId", () => {
    const r = workerEventSchema.safeParse({
      type: "snapshot",
      workspaceId: "",
      snapshot: emptySnapshot(),
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-object payload", () => {
    const r = workerEventSchema.safeParse(null);
    expect(r.success).toBe(false);
  });
});


// --- Portable-memory payload bounds (design §12.5) ---------------------------

describe("WorkspaceWatchProtocol — portable memory snapshot bounds", () => {
  function portableBase(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      directoryPresent: true,
      complete: true,
      records: [],
      seenRelativePaths: [],
      totalBytes: 0,
      diagnostics: [],
    };
  }

  function snapshotWith(portable: unknown): unknown {
    return {
      type: "snapshot",
      workspaceId: "w1",
      snapshot: {
        source: "workspace",
        sourceId: "workspace:w1",
        rootPath: "/tmp/w1",
        version: 1,
        files: [],
        instructions: [],
        commands: [],
        agents: [],
        hooks: [],
        skills: [],
        diagnostics: [],
        portableMemory: portable,
      },
    };
  }

  it("accepts a bounded portable payload", () => {
    const r = workerEventSchema.safeParse(snapshotWith(portableBase()));
    expect(r.success).toBe(true);
  });

  it("accepts an absent portable payload", () => {
    const r = workerEventSchema.safeParse({
      type: "snapshot",
      workspaceId: "w1",
      snapshot: {
        source: "workspace",
        sourceId: "workspace:w1",
        rootPath: "/tmp/w1",
        version: 1,
        files: [],
        instructions: [],
        commands: [],
        agents: [],
        hooks: [],
        skills: [],
        diagnostics: [],
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects malformed portable payloads (bad hash, over caps, wrong version)", () => {
    const badHash = {
      ...portableBase(),
      records: [
        {
          relativePath: ".aifetchly/memory/wmem-x.md",
          fileName: "wmem-x.md",
          contentHash: "not-a-hash",
          sizeBytes: 10,
          mtimeMs: 1,
          rawFrontmatter: null,
          markdownBody: "x",
          isSymbolicLink: false,
        },
      ],
    };
    expect(workerEventSchema.safeParse(snapshotWith(badHash)).success).toBe(
      false
    );

    const badVersion = { ...portableBase(), schemaVersion: 2 };
    expect(workerEventSchema.safeParse(snapshotWith(badVersion)).success).toBe(
      false
    );

    const overCount = {
      ...portableBase(),
      records: Array.from({ length: 1001 }, (_, i) => ({
        relativePath: `.aifetchly/memory/wmem-${i}.md`,
        fileName: `wmem-${i}.md`,
        contentHash: "a".repeat(64),
        sizeBytes: 1,
        mtimeMs: 1,
        rawFrontmatter: null,
        markdownBody: "x",
        isSymbolicLink: false,
      })),
    };
    expect(workerEventSchema.safeParse(snapshotWith(overCount)).success).toBe(
      false
    );
  });
});
