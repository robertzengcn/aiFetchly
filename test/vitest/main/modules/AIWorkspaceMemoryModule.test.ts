import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { AIWorkspaceMemoryModule } from "@/modules/AIWorkspaceMemoryModule";
import type { WorkspaceMemoryScope } from "@/modules/AIWorkspaceMemoryModule";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-ws-mem-module");
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

const SCOPE_A: WorkspaceMemoryScope = {
  workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceRoot: "/projects/alpha",
};
const SCOPE_B: WorkspaceMemoryScope = {
  workspaceKey: "ws_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  workspaceRoot: "/projects/beta",
};

describe("AIWorkspaceMemoryModule", () => {
  it("creates a memory with a wmem- id and the workspace scope", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.createMemory(SCOPE_A, {
      type: "decision",
      title: "Use SQLite",
      content: "Store workspace memory in SQLite, not repo files.",
    });
    expect(view.memoryId).toMatch(/^wmem-/);
    expect(view.workspaceKey).toBe(SCOPE_A.workspaceKey);
    expect(view.workspaceRoot).toBe("/projects/alpha");
    expect(view.type).toBe("decision");
    expect(view.status).toBe("active");
    expect(view.sourceKind).toBe("manual");
  });

  it("rejects an invalid type", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.createMemory(SCOPE_A, {
        type: "garbage" as never,
        title: "x",
        content: "y",
      })
    ).rejects.toThrow(/type/);
  });

  it("rejects empty title or content", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.createMemory(SCOPE_A, { type: "project", title: "   ", content: "x" })
    ).rejects.toThrow(/title/);
    await expect(
      mod.createMemory(SCOPE_A, { type: "project", title: "x", content: "" })
    ).rejects.toThrow(/content/);
  });

  it("rejects secret-like content (api key)", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.createMemory(SCOPE_A, {
        type: "convention",
        title: "deploy key",
        content: "api_key=sk-1234567890abcdef1234567890abcdef",
      })
    ).rejects.toThrow(/secret|credential/i);
  });

  it("rejects WM-VALID-06 secret-like content without creating a memory", async () => {
    const createSpy = vi.spyOn(AIWorkspaceMemoryModel.prototype, "create");
    const mod = new AIWorkspaceMemoryModule();

    await expect(
      mod.createMemory(SCOPE_A, {
        type: "reference",
        title: "API Config",
        content: "The API key is sk-proj-abcdefghijklmnop1234567890abcdef",
      })
    ).rejects.toThrow(/secret|credential/i);

    expect(createSpy).not.toHaveBeenCalled();
  });

  it("clamps confidence into 0..100", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory(SCOPE_A, {
      type: "workflow",
      title: "x",
      content: "y",
      confidence: 250,
    });
    expect(v.confidence).toBe(100);
  });

  it("lists active memories scoped to the workspace and archives by id", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    const a = await mod.createMemory(SCOPE_A, {
      type: "workflow",
      title: "yarn testmain",
      content: "Run main process tests with yarn testmain.",
    });
    await mod.createMemory(SCOPE_A, {
      type: "convention",
      title: "Model/Module layering",
      content: "DB access lives in Model; business logic in Module.",
    });
    const active = await mod.listMemories(SCOPE_A, {});
    expect(active.length).toBe(2);
    await mod.archiveMemory(SCOPE_A, a.memoryId);
    const after = await mod.listMemories(SCOPE_A, {});
    expect(after.length).toBe(1);
  });

  it("updates memory fields within the same workspace", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory(SCOPE_A, {
      type: "decision",
      title: "t",
      content: "c",
    });
    const u = await mod.updateMemory(SCOPE_A, {
      memoryId: v.memoryId,
      content: "c2",
    });
    expect(u.content).toBe("c2");
  });

  it("marks memories used by memoryId", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory(SCOPE_A, {
      type: "reference",
      title: "t",
      content: "c",
    });
    const at = new Date("2026-01-01T00:00:00Z");
    await mod.markMemoriesUsed(SCOPE_A, [v.memoryId], at);
    const fetched = await mod.getMemory(SCOPE_A, v.memoryId);
    expect(fetched?.lastUsedAt).toBe(at.toISOString());
  });

  // ---- Workspace isolation (the core safety guarantee) ----

  it("does NOT list workspace A memories under workspace B", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    await mod.createMemory(SCOPE_A, {
      type: "decision",
      title: "alpha-only",
      content: "belongs to alpha",
    });
    const inB = await mod.listMemories(SCOPE_B, {});
    expect(inB.length).toBe(0);
  });

  it("cannot update a memory from a different workspace", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    const a = await mod.createMemory(SCOPE_A, {
      type: "decision",
      title: "t",
      content: "c",
    });
    await expect(
      mod.updateMemory(SCOPE_B, { memoryId: a.memoryId, content: "hijack" })
    ).rejects.toThrow(/not found/i);
    // original content is intact
    const fetched = await mod.getMemory(SCOPE_A, a.memoryId);
    expect(fetched?.content).toBe("c");
  });

  it("cannot archive or delete a memory from a different workspace", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    const a = await mod.createMemory(SCOPE_A, {
      type: "decision",
      title: "t",
      content: "c",
    });
    await mod.archiveMemory(SCOPE_B, a.memoryId);
    expect(await mod.deleteMemory(SCOPE_B, a.memoryId)).toBe(0);
    // still present and active in A
    const fetched = await mod.getMemory(SCOPE_A, a.memoryId);
    expect(fetched?.status).toBe("active");
  });

  it("listActiveForRetrieval is scoped by workspaceKey", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    await mod.createMemory(SCOPE_A, {
      type: "warning",
      title: "no direct DB in workers",
      content: "Workers must not access the DB directly.",
    });
    await mod.createMemory(SCOPE_B, {
      type: "warning",
      title: "beta rule",
      content: "Beta-only rule.",
    });
    const aRetrieval = await mod.listActiveForRetrieval(SCOPE_A, 50);
    const bRetrieval = await mod.listActiveForRetrieval(SCOPE_B, 50);
    expect(aRetrieval.length).toBe(1);
    expect(bRetrieval.length).toBe(1);
    expect(aRetrieval[0].title).toBe("no direct DB in workers");
    expect(bRetrieval[0].title).toBe("beta rule");
  });

  it("search treats wildcard characters literally within a workspace", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    await mod.createMemory(SCOPE_A, {
      type: "workflow",
      title: "literal 100% rule",
      content: "Use the literal percent marker when testing search.",
    });
    await mod.createMemory(SCOPE_A, {
      type: "workflow",
      title: "ordinary rule",
      content: "This item should not match a percent wildcard query.",
    });

    const results = await mod.listMemories(SCOPE_A, {
      query: "100%",
      limit: 10,
    });

    expect(results.map((m) => m.title)).toEqual(["literal 100% rule"]);
  });

  it("filters by status and source kind without crossing workspace scope", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    await mod.createMemory(SCOPE_A, {
      type: "decision",
      title: "manual active",
      content: "Manual memory.",
      sourceKind: "manual",
    });
    const auto = await mod.createMemory(SCOPE_A, {
      type: "decision",
      title: "auto archived",
      content: "Auto-dream memory.",
      sourceKind: "auto_dream",
    });
    await mod.createMemory(SCOPE_B, {
      type: "decision",
      title: "beta auto",
      content: "Beta auto-dream memory.",
      sourceKind: "auto_dream",
    });
    await mod.archiveMemory(SCOPE_A, auto.memoryId);

    const archivedAuto = await mod.listMemories(SCOPE_A, {
      status: "archived",
      sourceKind: "auto_dream",
    });

    expect(archivedAuto).toHaveLength(1);
    expect(archivedAuto[0].title).toBe("auto archived");
    expect(archivedAuto[0].workspaceKey).toBe(SCOPE_A.workspaceKey);
  });

  it("limits source message attribution to 100 message ids", async () => {
    const mod = new AIWorkspaceMemoryModule();
    await SqliteDb.ensureInitialized();
    const sourceMessageIds = Array.from({ length: 105 }, (_unused, i) => {
      return `msg-${i}`;
    });

    const memory = await mod.createMemory(SCOPE_A, {
      type: "reference",
      title: "source capped",
      content: "Source attribution should stay compact.",
      sourceMessageIds,
    });

    expect(memory.sourceMessageIds).toHaveLength(100);
    expect(memory.sourceMessageIds?.[0]).toBe("msg-0");
    expect(memory.sourceMessageIds?.[99]).toBe("msg-99");
  });

  it("prevents workspace memory models from being instantiated in worker processes", () => {
    const previous = process.env.WORKER_TYPE;
    process.env.WORKER_TYPE = "contact-extraction";
    try {
      expect(() => new AIWorkspaceMemoryModel(tmpDir)).toThrow(
        /Direct database access from worker process is not allowed/
      );
    } finally {
      if (previous === undefined) {
        delete process.env.WORKER_TYPE;
      } else {
        process.env.WORKER_TYPE = previous;
      }
    }
  });
});
