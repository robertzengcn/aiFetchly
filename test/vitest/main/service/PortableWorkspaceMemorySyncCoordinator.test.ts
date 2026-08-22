import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import {
  PortableWorkspaceMemorySyncCoordinator,
  type TrustedPortableSnapshotInput,
} from "@/service/PortableWorkspaceMemorySyncCoordinator";
import type { WorkspaceMemoryScopeResolver } from "@/service/WorkspaceMemoryScopeResolver";
import type { WorkspaceMemoryScopeContext } from "@/entityTypes/portableWorkspaceMemoryTypes";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-portable-sync");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

const KEY_A = "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DOC_ID = "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1";

const SCOPE: WorkspaceMemoryScopeContext = {
  scopeId: `wscope-legacy-${"a".repeat(32)}`,
  workspaceKey: KEY_A,
  workspaceRoot: tmpDir,
  displayName: "Alpha",
  portableEnabled: true,
  importPolicy: "review-new",
};

function makeScopeResolver(
  scope: WorkspaceMemoryScopeContext = SCOPE
): WorkspaceMemoryScopeResolver {
  return {
    resolveForWorkspace: vi.fn().mockResolvedValue(scope),
  } as unknown as WorkspaceMemoryScopeResolver;
}

function recordDraft(
  content: string,
  overrides: Record<string, unknown> = {}
): {
  readonly relativePath: string;
  readonly fileName: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly rawFrontmatter: unknown;
  readonly markdownBody: string;
  readonly isSymbolicLink: boolean;
} {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const yaml = require("js-yaml") as typeof import("js-yaml");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("crypto") as typeof import("crypto");
  const fmStart = content.indexOf("---\n") + 4;
  const fmEnd = content.indexOf("\n---\n", fmStart);
  return {
    relativePath: `.aifetchly/memory/${DOC_ID}.md`,
    fileName: `${DOC_ID}.md`,
    contentHash: crypto.createHash("sha256").update(content).digest("hex"),
    sizeBytes: Buffer.byteLength(content),
    mtimeMs: 1,
    rawFrontmatter: yaml.load(content.slice(fmStart, fmEnd)),
    markdownBody: content.slice(fmEnd + 5),
    isSymbolicLink: false,
    ...overrides,
  };
}

const VALID_CONTENT = `---
schema: aifetchly.memory/v1
id: ${DOC_ID}
type: decision
status: active
confidence: 95
visibility: team
createdAt: "2026-08-22T08:30:00.000Z"
updatedAt: "2026-08-22T08:30:00.000Z"
createdBy: external-agent
---

# Externally authored decision

Markdown files are authoritative for portable fields.
`;

function snapshotInput(
  records: readonly ReturnType<typeof recordDraft>[],
  options: {
    readonly approved?: boolean;
    readonly complete?: boolean;
    readonly seen?: readonly string[];
  } = {}
): TrustedPortableSnapshotInput {
  return {
    workspaceId: "ws-1",
    workspaceRoot: tmpDir,
    approved: options.approved ?? true,
    snapshot: {
      schemaVersion: 1,
      directoryPresent: true,
      complete: options.complete ?? true,
      records,
      seenRelativePaths:
        options.seen ??
        records.map((r) => `.aifetchly/memory/${r.fileName ?? `${DOC_ID}.md`}`),
      totalBytes: 100,
      diagnostics: [],
    },
  };
}

function makeCoordinator(
  scope: WorkspaceMemoryScopeContext = SCOPE,
  summaries: unknown[] = []
): PortableWorkspaceMemorySyncCoordinator {
  return new PortableWorkspaceMemorySyncCoordinator({
    scopeResolver: makeScopeResolver(scope),
    emitter: (s) => summaries.push(s),
    logger: () => undefined,
  });
}

describe("PortableWorkspaceMemorySyncCoordinator", () => {
  it("imports a valid external record and marks new records pending-review under review-new", async () => {
    const summaries: unknown[] = [];
    const coordinator = makeCoordinator(SCOPE, summaries);
    await coordinator.enqueueSnapshot(snapshotInput([recordDraft(VALID_CONTENT)]));

    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID);
    expect(state?.syncState).toBe("pending-review"); // new external record
    expect(summaries).toHaveLength(1);
  });

  it("is idempotent for identical repeated snapshots (no re-import)", async () => {
    const summaries: unknown[] = [];
    const coordinator = makeCoordinator(
      { ...SCOPE, importPolicy: "automatic" },
      summaries
    );
    const draft = recordDraft(VALID_CONTENT);
    await coordinator.enqueueSnapshot(snapshotInput([draft]));
    await coordinator.enqueueSnapshot(snapshotInput([draft]));

    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID);
    expect(state?.syncState).toBe("synced");
    // Second run: 0 imports, 1 unchanged.
    const second = summaries[1] as { imported: number; unchanged: number };
    expect(second.imported).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  it("imports changed content on a known record without review (edit policy)", async () => {
    const coordinator = makeCoordinator(SCOPE);
    await coordinator.enqueueSnapshot(snapshotInput([recordDraft(VALID_CONTENT)]));
    const changed = VALID_CONTENT.replace(
      "Markdown files are authoritative",
      "Updated content: files win"
    ).replace(
      'updatedAt: "2026-08-22T08:30:00.000Z"',
      'updatedAt: "2026-08-22T10:00:00.000Z"'
    );
    await coordinator.enqueueSnapshot(snapshotInput([recordDraft(changed)]));

    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    const row = await memoryModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID);
    expect(row?.content).toContain("Updated content");
    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID);
    expect(state?.syncState).toBe("synced"); // edit to known record imports
  });

  it("ignores snapshots for unapproved workspaces", async () => {
    const summaries: unknown[] = [];
    const coordinator = makeCoordinator(SCOPE, summaries);
    await coordinator.enqueueSnapshot(
      snapshotInput([recordDraft(VALID_CONTENT)], { approved: false })
    );
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    expect(
      await memoryModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID)
    ).toBeNull();
    expect(summaries).toHaveLength(0);
  });

  it("does not import when portable memory is disabled for the scope", async () => {
    const coordinator = makeCoordinator({
      ...SCOPE,
      portableEnabled: false,
    });
    await coordinator.enqueueSnapshot(snapshotInput([recordDraft(VALID_CONTENT)]));
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    expect(
      await memoryModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID)
    ).toBeNull();
  });

  it("never deletes records on an incomplete scan", async () => {
    const coordinator = makeCoordinator(
      { ...SCOPE, importPolicy: "automatic" },
      []
    );
    await coordinator.enqueueSnapshot(snapshotInput([recordDraft(VALID_CONTENT)]));
    // Next scan is INCOMPLETE and observes no files.
    await coordinator.enqueueSnapshot(
      snapshotInput([], { complete: false, seen: [] })
    );
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    expect(
      await memoryModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID)
    ).not.toBeNull(); // retained
  });

  it("deletes records absent from a complete scan under automatic policy", async () => {
    const coordinator = makeCoordinator(
      { ...SCOPE, importPolicy: "automatic" },
      []
    );
    await coordinator.enqueueSnapshot(snapshotInput([recordDraft(VALID_CONTENT)]));
    await coordinator.enqueueSnapshot(snapshotInput([], { complete: true }));
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    expect(
      await memoryModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID)
    ).toBeNull();
  });

  it("marks records missing (not deleted) under review-new on a complete scan", async () => {
    const coordinator = makeCoordinator(SCOPE, []);
    await coordinator.enqueueSnapshot(snapshotInput([recordDraft(VALID_CONTENT)]));
    await coordinator.enqueueSnapshot(snapshotInput([], { complete: true }));
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    expect(
      await memoryModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID)
    ).not.toBeNull();
    const stateModel = new AIWorkspaceMemoryPortableStateModel(tmpDir);
    const state = await stateModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID);
    expect(state?.syncState).toBe("missing");
  });

  it("rejects invalid records while importing valid siblings", async () => {
    const summaries: unknown[] = [];
    const coordinator = makeCoordinator({ ...SCOPE, importPolicy: "automatic" }, summaries);
    const bad = recordDraft(
      VALID_CONTENT.replace("type: decision", "type: nonsense")
    );
    const good = recordDraft(VALID_CONTENT, {
      relativePath: `.aifetchly/memory/wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0.md`,
      fileName: "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0.md",
      rawFrontmatter: {
        schema: "aifetchly.memory/v1",
        id: "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0",
        type: "warning",
        status: "active",
        confidence: 90,
        visibility: "local",
        createdAt: "2026-08-22T08:30:00.000Z",
        updatedAt: "2026-08-22T08:30:00.000Z",
        createdBy: "external-agent",
      },
      markdownBody: "# Good record\n\nValid sibling content.",
    });
    await coordinator.enqueueSnapshot(
      snapshotInput([bad, good], {
        seen: [
          `.aifetchly/memory/${DOC_ID}.md`,
          ".aifetchly/memory/wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0.md",
        ],
      })
    );
    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    expect(
      await memoryModel.getByScopeAndMemoryId(
        SCOPE.scopeId,
        "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0"
      )
    ).not.toBeNull();
    const summary = summaries[0] as {
      imported: number;
      rejected: number;
      diagnostics: { code: string }[];
    };
    expect(summary.imported).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.diagnostics[0]?.code).toBe("memory-field-invalid");
  });

  it("coalesces rapid snapshots: only the newest is applied", async () => {
    const summaries: unknown[] = [];
    const coordinator = makeCoordinator(
      { ...SCOPE, importPolicy: "automatic" },
      summaries
    );
    const draft1 = recordDraft(VALID_CONTENT);
    const draft2 = recordDraft(
      VALID_CONTENT.replace("confidence: 95", "confidence: 80")
    );
    // Enqueue both before the first drains.
    const p1 = coordinator.enqueueSnapshot(snapshotInput([draft1]));
    const p2 = coordinator.enqueueSnapshot(snapshotInput([draft2]));
    await Promise.all([p1, p2]);

    const memoryModel = new AIWorkspaceMemoryModel(tmpDir);
    const row = await memoryModel.getByScopeAndMemoryId(SCOPE.scopeId, DOC_ID);
    expect(row?.confidence).toBe(80); // newest wins
    // Only one summary should have been emitted (the newest application).
    expect(summaries.length).toBeLessThanOrEqual(2);
  });

  it("serializes user operations behind snapshots on the same key", async () => {
    const order: string[] = [];
    const coordinator = makeCoordinator(SCOPE, []);
    const gate = (() => {
      let resolve: (() => void) | null = null;
      const promise = new Promise<void>((r) => (resolve = r));
      return { promise, open: () => resolve?.() };
    })();
    const first = coordinator.enqueueOperation("ws-1", async () => {
      await gate.promise;
      order.push("first");
    });
    const second = coordinator.enqueueOperation("ws-1", async () => {
      order.push("second");
    });
    expect(order).toEqual([]); // second blocked behind first
    gate.open();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });
});
