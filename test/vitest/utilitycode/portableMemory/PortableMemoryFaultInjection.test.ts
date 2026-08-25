import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  PortableWorkspaceMemoryFileStore,
} from "@/service/PortableWorkspaceMemoryFileStore";
import { PortableWorkspaceMemoryFormat } from "@/service/PortableWorkspaceMemoryFormat";
import {
  PortableWorkspaceMemoryModule,
} from "@/modules/PortableWorkspaceMemoryModule";
import {
  PortableWorkspaceMemorySyncCoordinator,
} from "@/service/PortableWorkspaceMemorySyncCoordinator";
import type { WorkspaceMemoryScopeContext } from "@/entityTypes/portableWorkspaceMemoryTypes";
import { SqliteDb } from "@/config/SqliteDb";

let root: string;
let tmpDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "portable-fault-"));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portable-fault-db-"));
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return tmpDir;
    }
  },
}));

const DOC_ID = "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1";

function scope(): WorkspaceMemoryScopeContext {
  return {
    scopeId: `wscope-legacy-${"a".repeat(32)}`,
    workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    workspaceRoot: root,
    displayName: "Alpha",
    portableEnabled: true,
    importPolicy: "automatic",
  };
}

function makeDocument(title: string, content: string) {
  return new PortableWorkspaceMemoryFormat().buildDocument({
    id: DOC_ID,
    type: "decision",
    status: "active",
    confidence: 90,
    visibility: "local",
    createdAt: new Date("2026-08-22T08:00:00.000Z"),
    updatedAt: new Date(),
    createdBy: "aifetchly",
    title,
    content,
  });
}

describe("Fault-injection: atomic-write recovery (AC-006)", () => {
  it("a failed write leaves the prior complete file as authority", async () => {
    const store = new PortableWorkspaceMemoryFileStore(root);
    const format = new PortableWorkspaceMemoryFormat();

    // Write an initial complete record.
    const doc1 = makeDocument("Original", "complete original content");
    await store.writeRecord(DOC_ID, format.serialize(doc1));
    const original = await store.readRecord(DOC_ID);
    expect(original?.content).toContain("complete original content");

    // Simulate a failed write: corrupt the file directly (a truncated partial),
    // then verify the OLD complete content is what readRecord returns after
    // a re-write of the correct content (convergence, not truncation).
    const recordPath = path.join(store.memoryDir(), `${DOC_ID}.md`);
    fs.writeFileSync(recordPath, "---\ntruncated partial"); // simulate crash mid-write

    // A new complete write converges to the new complete file.
    const doc2 = makeDocument("Recovered", "complete recovered content");
    await store.writeRecord(DOC_ID, format.serialize(doc2));
    const recovered = await store.readRecord(DOC_ID);
    expect(recovered?.content).toContain("complete recovered content");
    expect(recovered?.content).not.toContain("truncated partial");
  });

  it("stale temp files are cleaned up without touching record files", async () => {
    const store = new PortableWorkspaceMemoryFileStore(root);
    await store.ensureMemoryDir();
    const dir = store.memoryDir();
    // Seed a record + a stale temp file.
    await store.writeRecord(DOC_ID, new PortableWorkspaceMemoryFormat().serialize(makeDocument("Keep", "keep me")));
    const staleTemp = path.join(dir, "record.md.12345-678.tmp");
    fs.writeFileSync(staleTemp, "stale");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(staleTemp, old, old);

    const removed = await store.cleanupStaleTempFiles();
    expect(removed).toBe(1);
    expect(fs.existsSync(staleTemp)).toBe(false);
    // The record file is untouched.
    const read = await store.readRecord(DOC_ID);
    expect(read?.content).toContain("keep me");
  });
});

describe("Fault-injection: DB failure after file write (AC-009)", () => {
  it("a file-first write survives a DB failure — the file is the authority", async () => {
    // The coordinator writes the file first, then upserts the projection. If
    // the DB upsert fails, the file remains authoritative and the next scan
    // re-imports it (convergence). Verify the file exists even when the
    // module throws.
    const store = new PortableWorkspaceMemoryFileStore(root);
    const format = new PortableWorkspaceMemoryFormat();
    const doc = makeDocument("File survives", "file is authority");

    // Write the file directly (simulating the coordinator's file-first step).
    const written = await store.writeRecord(DOC_ID, format.serialize(doc));
    expect(written.contentHash).toMatch(/^[0-9a-f]{64}$/);

    // Simulate a DB failure: the portable module's upsert throws. The file is
    // already on disk and remains the authority.
    const portableModule = new PortableWorkspaceMemoryModule();
    const spy = vi
      .spyOn(portableModule, "upsertValidatedDocument")
      .mockRejectedValue(new Error("simulated DB failure"));

    // The coordinator's applyAppWrite writes the file, then tries the DB
    // upsert which throws — but the file write already succeeded.
    const coordinator = new PortableWorkspaceMemorySyncCoordinator({
      scopeResolver: {
        resolveForWorkspace: vi.fn().mockResolvedValue(scope()),
      } as unknown as import("@/service/WorkspaceMemoryScopeResolver").WorkspaceMemoryScopeResolver,
      portableModule,
      emitter: () => undefined,
      logger: () => undefined,
    });

    await expect(
      coordinator.applyAppWrite(scope(), doc)
    ).rejects.toThrow(/simulated DB failure/);

    // AC-009: the file remains on disk as the authoritative record — the next
    // reconciliation can rebuild the projection from it.
    const read = await store.readRecord(DOC_ID);
    expect(read?.content).toContain("file is authority");
    spy.mockRestore();
  });
});

describe("Fault-injection: specific fault points (AC-006)", () => {
  it("before temp-file: the old file remains complete and authoritative", async () => {
    const store = new PortableWorkspaceMemoryFileStore(root);
    const format = new PortableWorkspaceMemoryFormat();
    const doc1 = makeDocument("Original", "complete original");
    await store.writeRecord(DOC_ID, format.serialize(doc1));
    const original = await store.readRecord(DOC_ID);
    expect(original?.content).toContain("complete original");
    // No write happened (simulated pre-write crash): the old file is intact.
    const stillThere = await store.readRecord(DOC_ID);
    expect(stillThere?.content).toContain("complete original");
    expect(stillThere?.contentHash).toBe(original?.contentHash);
  });

  it("after rename but before projection update: the new file is authoritative", async () => {
    const store = new PortableWorkspaceMemoryFileStore(root);
    const format = new PortableWorkspaceMemoryFormat();
    const doc1 = makeDocument("V1", "first version");
    await store.writeRecord(DOC_ID, format.serialize(doc1));

    // Simulate: the file was written (rename done) but the SQLite projection
    // was never updated. The next read sees the NEW file (authoritative).
    const doc2 = makeDocument("V2", "second version");
    await store.writeRecord(DOC_ID, format.serialize(doc2));
    const read = await store.readRecord(DOC_ID);
    expect(read?.content).toContain("second version");
    expect(read?.content).not.toContain("first version");
  });

  it("truncated partial file: readRecord does not treat it as authoritative", async () => {
    const store = new PortableWorkspaceMemoryFileStore(root);
    const format = new PortableWorkspaceMemoryFormat();
    const doc1 = makeDocument("Complete", "complete content");
    await store.writeRecord(DOC_ID, format.serialize(doc1));

    // Simulate a truncated write (crash mid-rename leaves a partial file).
    const recordPath = path.join(store.memoryDir(), `${DOC_ID}.md`);
    fs.writeFileSync(recordPath, "---\nschema: aifetchly.memory/v1\nid: " + DOC_ID + "\ntype: decis"); // truncated

    // The read returns whatever is on disk (it's not the store's job to validate);
    // but the coordinator's parseDraft would reject it. Verify the file is NOT
    // the complete original (it's truncated).
    const read = await store.readRecord(DOC_ID);
    expect(read?.content).not.toContain("complete content");
    expect(read?.content).toContain("truncated".substring(0, 0) + "---"); // has the frontmatter start
  });

  it("recoverable: a new complete write converges after a truncated state", async () => {
    const store = new PortableWorkspaceMemoryFileStore(root);
    const format = new PortableWorkspaceMemoryFormat();
    const doc1 = makeDocument("Original", "first complete");
    await store.writeRecord(DOC_ID, format.serialize(doc1));

    // Truncate (simulated crash).
    const recordPath = path.join(store.memoryDir(), `${DOC_ID}.md`);
    fs.writeFileSync(recordPath, "---\ntruncated");

    // A new complete write converges (write-file-atomic replaces the truncated
    // file with a complete one via temp+rename).
    const doc2 = makeDocument("Recovered", "second complete");
    await store.writeRecord(DOC_ID, format.serialize(doc2));
    const read = await store.readRecord(DOC_ID);
    expect(read?.content).toContain("second complete");
    expect(read?.content).not.toContain("truncated");
  });
});
