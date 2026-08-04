import { describe, expect, it, beforeEach } from "vitest";
import {
  ConversationToolStateModule,
  normalizeToolStateNames,
  entityToView,
} from "@/modules/ConversationToolStateModule";
import { ConversationToolStateEntity } from "@/entity/ConversationToolState.entity";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-conv-tool-state");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("normalizeToolStateNames (pure)", () => {
  it("filters non-strings and empties, dedupes, sorts", () => {
    const out = normalizeToolStateNames([
      "mcp_1_b",
      "mcp_1_a",
      "mcp_1_b",
      "",
      "   ",
      42,
      null,
      undefined,
      { x: 1 },
      "file_read",
    ]);
    expect(out).toEqual(["file_read", "mcp_1_a", "mcp_1_b"]);
  });

  it("drops names not in the known set when provided", () => {
    const out = normalizeToolStateNames(
      ["mcp_1_a", "mcp_1_stale", "file_read"],
      new Set(["mcp_1_a", "file_read"])
    );
    expect(out).toEqual(["file_read", "mcp_1_a"]);
  });

  it("returns empty for garbage input", () => {
    expect(normalizeToolStateNames([])).toEqual([]);
    expect(normalizeToolStateNames([null, undefined, ""])).toEqual([]);
  });
});

describe("entityToView (pure)", () => {
  it("parses json arrays and preserves catalogHash", () => {
    const e = new ConversationToolStateEntity();
    e.conversationId = "conv-1";
    e.discoveredToolNamesJson = JSON.stringify(["mcp_1_a"]);
    e.announcedDeferredToolNamesJson = JSON.stringify(["mcp_1_b"]);
    e.catalogHash = "abc123";
    const view = entityToView(e);
    expect(view.conversationId).toBe("conv-1");
    expect(view.discoveredToolNames).toEqual(["mcp_1_a"]);
    expect(view.announcedDeferredToolNames).toEqual(["mcp_1_b"]);
    expect(view.catalogHash).toBe("abc123");
  });

  it("returns empty arrays for missing/garbage json", () => {
    const e = new ConversationToolStateEntity();
    e.conversationId = "conv-1";
    e.discoveredToolNamesJson = "not-json";
    e.announcedDeferredToolNamesJson = "";
    const view = entityToView(e);
    expect(view.discoveredToolNames).toEqual([]);
    expect(view.announcedDeferredToolNames).toEqual([]);
  });
});

describe("ConversationToolStateModule (DB round-trip)", () => {
  it("saves and loads discovered state by conversation id", async () => {
    const mod = new ConversationToolStateModule(tmpDir);
    await SqliteDb.ensureInitialized();

    const saved = await mod.saveView({
      conversationId: "conv-1",
      discoveredToolNames: ["mcp_1_b", "mcp_1_a", "mcp_1_b"],
      announcedDeferredToolNames: [],
      catalogHash: "h1",
    });
    expect(saved.discoveredToolNames).toEqual(["mcp_1_a", "mcp_1_b"]);

    const loaded = await mod.loadView("conv-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.discoveredToolNames).toEqual(["mcp_1_a", "mcp_1_b"]);
    expect(loaded?.catalogHash).toBe("h1");
  });

  it("upserts (updates) an existing conversation row", async () => {
    const mod = new ConversationToolStateModule(tmpDir);
    await SqliteDb.ensureInitialized();
    await mod.saveView({
      conversationId: "conv-2",
      discoveredToolNames: ["mcp_1_a"],
      announcedDeferredToolNames: [],
    });
    await mod.saveView({
      conversationId: "conv-2",
      discoveredToolNames: ["mcp_1_a", "mcp_1_c"],
      announcedDeferredToolNames: [],
    });
    const loaded = await mod.loadView("conv-2");
    expect(loaded?.discoveredToolNames).toEqual(["mcp_1_a", "mcp_1_c"]);
  });

  it("drops stale names against the known set on save", async () => {
    const mod = new ConversationToolStateModule(tmpDir);
    await SqliteDb.ensureInitialized();
    await mod.saveView({
      conversationId: "conv-3",
      discoveredToolNames: ["mcp_1_a", "mcp_1_stale", "file_read"],
      announcedDeferredToolNames: [],
      knownToolNames: new Set(["mcp_1_a", "file_read"]),
    });
    const loaded = await mod.loadView("conv-3");
    expect(loaded?.discoveredToolNames).toEqual(["file_read", "mcp_1_a"]);
  });

  it("returns null for an unknown conversation", async () => {
    const mod = new ConversationToolStateModule(tmpDir);
    await SqliteDb.ensureInitialized();
    const loaded = await mod.loadView("does-not-exist");
    expect(loaded).toBeNull();
  });

  it("deletes a conversation row", async () => {
    const mod = new ConversationToolStateModule(tmpDir);
    await SqliteDb.ensureInitialized();
    await mod.saveView({
      conversationId: "conv-4",
      discoveredToolNames: ["mcp_1_a"],
      announcedDeferredToolNames: [],
    });
    const removed = await mod.deleteByConversationId("conv-4");
    expect(removed).toBe(1);
    expect(await mod.loadView("conv-4")).toBeNull();
  });
});
