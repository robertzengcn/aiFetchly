import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { ensurePortableMemoryDefault } from "@/service/PortableWorkspaceMemoryBootstrap";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-portable-default-bootstrap");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db") || f === ".aifetchly") {
      try {
        fs.rmSync(path.join(tmpDir, f), { recursive: true, force: true });
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

const KEY = "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("ensurePortableMemoryDefault", () => {
  it("writes workspace identity and memory dir for a new workspace", async () => {
    await ensurePortableMemoryDefault({
      workspaceKey: KEY,
      workspaceRoot: tmpDir,
      displayName: "Alpha",
    });
    expect(
      fs.existsSync(path.join(tmpDir, ".aifetchly", "workspace.json"))
    ).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".aifetchly", "memory"))).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, ".aifetchly", "memory", "README.md"))
    ).toBe(true);
    const identity = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".aifetchly", "workspace.json"), "utf8")
    ) as { schemaVersion: number; workspaceId: string };
    expect(identity.schemaVersion).toBe(1);
    expect(identity.workspaceId.startsWith("ws-")).toBe(true);
  });

  it("does not write files when the user disabled portable memory", async () => {
    const mod = new WorkspaceMemoryScopeModule();
    const ctx = await mod.resolveLegacyScope({
      workspaceKey: KEY,
      workspaceRoot: tmpDir,
      displayName: "Alpha",
    });
    await mod.updatePolicy({ scopeId: ctx.scopeId, portableEnabled: false });
    await ensurePortableMemoryDefault({
      workspaceKey: KEY,
      workspaceRoot: tmpDir,
      displayName: "Alpha",
    });
    expect(fs.existsSync(path.join(tmpDir, ".aifetchly"))).toBe(false);
  });
});
