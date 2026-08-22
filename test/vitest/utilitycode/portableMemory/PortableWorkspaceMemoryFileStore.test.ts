import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PortableWorkspaceMemoryFileStore } from "@/service/PortableWorkspaceMemoryFileStore";
import { PortableWorkspaceIdentityService } from "@/service/PortableWorkspaceIdentityService";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "portable-store-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const VALID_ID = "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1";

function makeStore(): PortableWorkspaceMemoryFileStore {
  return new PortableWorkspaceMemoryFileStore(root);
}

describe("PortableWorkspaceMemoryFileStore", () => {
  it("writes and reads a record atomically with hash round-trip", async () => {
    const store = makeStore();
    const written = await store.writeRecord(VALID_ID, "# T\n\nbody");
    expect(written.sizeBytes).toBeGreaterThan(0);
    const read = await store.readRecord(VALID_ID);
    expect(read?.content).toBe("# T\n\nbody");
    expect(read?.contentHash).toBe(written.contentHash);
    expect(
      fs.existsSync(path.join(root, ".aifetchly", "memory", `${VALID_ID}.md`))
    ).toBe(true);
  });

  it("returns null when reading a missing record", async () => {
    const store = makeStore();
    expect(await store.readRecord(VALID_ID)).toBeNull();
    expect(await store.hashRecord(VALID_ID)).toBeNull();
    expect(await store.deleteRecord(VALID_ID)).toBe(false);
  });

  it("rejects invalid memory ids (traversal / separators / null bytes)", () => {
    const store = makeStore();
    expect(() => store.writeRecord("../../evil", "x")).rejects.toThrow(
      /invalid portable memory id/i
    );
    expect(() => store.writeRecord("wmem-not-a-uuid", "x")).rejects.toThrow(
      /invalid portable memory id/i
    );
  });

  it("rejects symlinked record targets", async () => {
    const store = makeStore();
    await store.ensureMemoryDir();
    const outsideDir = path.join(root, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    const target = path.join(root, ".aifetchly", "memory", `${VALID_ID}.md`);
    fs.symlinkSync(path.join(outsideDir, "evil.md"), target);
    await expect(store.writeRecord(VALID_ID, "x")).rejects.toThrow(
      /symbolic link/i
    );
  });

  it("cleans only stale atomic temp files", async () => {
    const store = makeStore();
    await store.ensureMemoryDir();
    const dir = store.memoryDir();
    const oldTmp = path.join(dir, "record.md.12345-678.tmp");
    const newTmp = path.join(dir, "record.md.99999-1.tmp");
    const keep = path.join(dir, "keep.txt");
    fs.writeFileSync(oldTmp, "old");
    fs.writeFileSync(newTmp, "new");
    fs.writeFileSync(keep, "keep");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(oldTmp, old, old);

    const removed = await store.cleanupStaleTempFiles();
    expect(removed).toBe(1);
    expect(fs.existsSync(oldTmp)).toBe(false);
    expect(fs.existsSync(newTmp)).toBe(true);
    expect(fs.existsSync(keep)).toBe(true);
  });

  it("writes and re-reads workspace.json identity", async () => {
    const store = makeStore();
    const identityService = new PortableWorkspaceIdentityService();
    const identity = identityService.createIdentity({ name: "proj" });
    await identityService.writeIdentity(store, identity);
    const inspection = await identityService.inspectOnDisk(store);
    expect(inspection.state).toBe("valid");
    expect(inspection.identity?.workspaceId).toBe(identity.workspaceId);
  });
});

describe("PortableWorkspaceIdentityService", () => {
  const service = new PortableWorkspaceIdentityService();

  it("inspects drafts as missing / valid / invalid", () => {
    expect(service.inspectDraft(undefined).state).toBe("missing");

    const valid = service.inspectDraft({
      relativePath: ".aifetchly/workspace.json",
      raw: {
        schemaVersion: 1,
        workspaceId: `ws-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1`,
        name: "proj",
        createdAt: "2026-08-22T08:00:00.000Z",
      },
      contentHash: "a".repeat(64),
      sizeBytes: 120,
      mtimeMs: 0,
    });
    expect(valid.state).toBe("valid");

    const bad = service.inspectDraft({
      relativePath: ".aifetchly/workspace.json",
      raw: { schemaVersion: 2 },
      contentHash: "a".repeat(64),
      sizeBytes: 30,
      mtimeMs: 0,
    });
    expect(bad.state).toBe("invalid");
    expect(bad.diagnostic?.code).toBe("workspace-identity-invalid");
  });

  it("creates identities with ws-<uuid> ids and regenerates fresh ones", () => {
    const first = service.createIdentity({ name: "proj" });
    expect(first.workspaceId).toMatch(/^ws-[0-9a-f-]{36}$/);
    const second = service.regenerateIdentity({
      name: "proj-fork",
      previous: first,
    });
    expect(second.workspaceId).not.toBe(first.workspaceId);
    expect(second.name).toBe("proj-fork");
  });

  it("rejects empty names", () => {
    expect(() => service.createIdentity({ name: "  " })).toThrow(/name/);
  });
});
