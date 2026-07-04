/**
 * CTX-01 / CTX-03 / DX-02 — context cache + context loader + runtime registry
 * sync + config manager singleton.
 *
 * Four describe blocks mirror the four production classes:
 *   - AIFetchlyContextStore        : in-memory instruction cache (defensive copies)
 *   - AIFetchlyContextLoader       : assembler-facing façade (never throws, formats labels)
 *   - AIFetchlyRuntimeRegistrySync : snapshot -> registry + cache wiring
 *   - AIFetchlyConfigManager       : singleton orchestrator (initialize/reload/getStatus)
 *
 * The manager tests use a real tmpdir (mirrors AIFetchlyConfigLoader.test.ts pattern)
 * because the manager wires the real Plan-01 loader; isolation comes from injecting
 * a fresh AIFetchlyContextStore per test, not from mocking the loader.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AIFetchlyInstructionBlock } from "@/entityTypes/aifetchlyConfigTypes";
import { AIFetchlyContextStore } from "@/service/aifetchlyConfig/AIFetchlyContextStore";
import {
  AIFetchlyContextLoader,
  type AIFetchlyContextInput,
} from "@/service/aifetchlyConfig/AIFetchlyContextLoader";
import { AIFetchlyRuntimeRegistrySync } from "@/service/aifetchlyConfig/AIFetchlyRuntimeRegistrySync";
import {
  AIFetchlyConfigManager,
  getAIFetchlyConfigManager,
} from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import { AIFetchlyConfigLoader } from "@/service/aifetchlyConfig/AIFetchlyConfigLoader";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";

// --- shared test helpers ----------------------------------------------------

function makeBlock(overrides: Partial<AIFetchlyInstructionBlock> = {}): AIFetchlyInstructionBlock {
  return {
    id: "user:instructions:AGENTS.md",
    source: "user",
    sourceId: "user",
    label: "",
    relativePath: "AGENTS.md",
    content: "# User instructions\n- be concise",
    contentHash: "deadbeef",
    trusted: true,
    ...overrides,
  };
}

const ctxInput: AIFetchlyContextInput = {
  conversationId: "conv-test",
  mode: "chat",
};

// --- AIFetchlyContextStore (CTX-03 cache) -----------------------------------

describe("AIFetchlyContextStore (CTX-03)", () => {
  it("returns an empty list before any replaceInstructions", () => {
    const store = new AIFetchlyContextStore();
    expect(store.getGlobalInstructions()).toEqual([]);
  });

  it("stores blocks under the 'user' sourceId and returns them via getGlobalInstructions", () => {
    const store = new AIFetchlyContextStore();
    const block = makeBlock({ content: "first" });
    store.replaceInstructions("user", [block]);
    expect(store.getGlobalInstructions()).toEqual([block]);
  });

  it("replaceInstructions replaces, not appends (second call wipes the first)", () => {
    const store = new AIFetchlyContextStore();
    store.replaceInstructions("user", [makeBlock({ content: "first" })]);
    store.replaceInstructions("user", [makeBlock({ content: "second" })]);
    const out = store.getGlobalInstructions();
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toBe("second");
  });

  it("removeSource('user') clears the global instructions", () => {
    const store = new AIFetchlyContextStore();
    store.replaceInstructions("user", [makeBlock()]);
    store.removeSource("user");
    expect(store.getGlobalInstructions()).toEqual([]);
  });

  it("returns defensive copies — mutating the returned array does not mutate the store", () => {
    const store = new AIFetchlyContextStore();
    store.replaceInstructions("user", [makeBlock({ content: "x" })]);
    const out = store.getGlobalInstructions();
    out.pop();
    expect(store.getGlobalInstructions()).toHaveLength(1);
  });

  it("returns defensive copies — mutating a returned block does not mutate the store", () => {
    const store = new AIFetchlyContextStore();
    store.replaceInstructions("user", [makeBlock({ content: "original" })]);
    const out = store.getGlobalInstructions();
    (out[0] as { content: string }).content = "mutated";
    expect(store.getGlobalInstructions()[0]!.content).toBe("original");
  });

  it("getWorkspaceInstructions returns [] in phase 13 (workspace population is phase 14)", () => {
    const store = new AIFetchlyContextStore();
    expect(store.getWorkspaceInstructions("ws-1")).toEqual([]);
  });

  it("getWorkspaceInstructions returns blocks stored under workspace:<id>", () => {
    const store = new AIFetchlyContextStore();
    const wsBlock = makeBlock({
      id: "workspace:ws-1:instructions:AGENTS.md",
      source: "workspace",
      sourceId: "workspace:ws-1",
    });
    store.replaceInstructions("workspace:ws-1", [wsBlock]);
    expect(store.getWorkspaceInstructions("ws-1")).toEqual([wsBlock]);
  });
});

// --- AIFetchlyContextLoader (CTX-03 never-throw + CTX-01 label) -------------

describe("AIFetchlyContextLoader (CTX-01 label, CTX-03 never-throw)", () => {
  it("getInstructionBlocks returns [] when the store is empty (cache miss, CTX-03)", async () => {
    const loader = new AIFetchlyContextLoader(new AIFetchlyContextStore());
    expect(await loader.getInstructionBlocks(ctxInput)).toEqual([]);
  });

  it("getInstructionBlocks returns the store's global blocks when populated", async () => {
    const store = new AIFetchlyContextStore();
    store.replaceInstructions("user", [makeBlock({ content: "global rules" })]);
    const loader = new AIFetchlyContextLoader(store);
    const out = await loader.getInstructionBlocks(ctxInput);
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toBe("global rules");
  });

  it("getInstructionBlocks NEVER throws — store error degrades to [] (CTX-03)", async () => {
    const throwingStore = {
      getGlobalInstructions(): AIFetchlyInstructionBlock[] {
        throw new Error("store boom");
      },
      getWorkspaceInstructions(): AIFetchlyInstructionBlock[] {
        return [];
      },
    } as unknown as AIFetchlyContextStore;
    const loader = new AIFetchlyContextLoader(throwingStore);
    await expect(loader.getInstructionBlocks(ctxInput)).resolves.toEqual([]);
  });

  it("formatInstructionBlock labels global blocks with the exact CTX-01 wording", () => {
    const block = makeBlock({ content: "be concise" });
    const labeled = AIFetchlyContextLoader.formatInstructionBlock(block);
    expect(labeled).toBe(
      "User global AiFetchly instructions from ~/.aifetchly/AGENTS.md:\n\nbe concise"
    );
  });

  it("formatInstructionBlock labels workspace blocks with the trusted-workspace wording", () => {
    const block = makeBlock({
      source: "workspace",
      sourceId: "workspace:ws-1",
      content: "workspace rules",
    });
    const labeled = AIFetchlyContextLoader.formatInstructionBlock(block);
    expect(labeled).toContain("Trusted workspace AiFetchly instructions");
    expect(labeled).toContain("workspace rules");
  });

  it("formatInstructionBlock does NOT claim priority over the app system prompt (anti-prompt-injection)", () => {
    const block = makeBlock({ content: "x" });
    const labeled = AIFetchlyContextLoader.formatInstructionBlock(block).toLowerCase();
    // Forbidden wording — design §12.2 last paragraph.
    expect(labeled).not.toContain("higher priority");
    expect(labeled).not.toContain("override system");
    expect(labeled).not.toContain("above all");
    expect(labeled).not.toContain("more important than");
  });

  it("formatInstructionBlock returns a string (content type-narrowed for the OpenAI message)", () => {
    const block = makeBlock({ content: "hello" });
    expect(typeof AIFetchlyContextLoader.formatInstructionBlock(block)).toBe("string");
  });
});

// --- AIFetchlyRuntimeRegistrySync (snapshot -> registry + cache) ------------

describe("AIFetchlyRuntimeRegistrySync", () => {
  it("applySnapshot wires instructions into the store", () => {
    const registry = new CommandRegistry();
    const store = new AIFetchlyContextStore();
    const sync = new AIFetchlyRuntimeRegistrySync(registry, store);

    const block = makeBlock({ content: "global" });
    const snapshot = {
      source: "user" as const,
      sourceId: "user",
      rootPath: "/tmp/x",
      version: 1,
      files: [],
      instructions: [block],
      commands: [],
      agents: [],
      hooks: [],
      skills: [],
      diagnostics: [],
    };
    const result = sync.applySnapshot(snapshot);
    expect(store.getGlobalInstructions()).toEqual([block]);
    expect(result.instructionsChanged).toBe(true);
    expect(result.commandsChanged).toBe(false);
    expect(result.diagnosticCount).toBe(0);
  });

  it("applySnapshot reports diagnostics count from the snapshot", () => {
    const registry = new CommandRegistry();
    const store = new AIFetchlyContextStore();
    const sync = new AIFetchlyRuntimeRegistrySync(registry, store);
    const result = sync.applySnapshot({
      source: "user",
      sourceId: "user",
      rootPath: "/tmp/x",
      version: 1,
      files: [],
      instructions: [],
      commands: [],
      agents: [],
      hooks: [],
      skills: [],
      diagnostics: [
        {
          severity: "warning",
          source: "user",
          sourceId: "user",
          filePath: "settings.json",
          code: "settings-json-invalid",
          message: "bad",
          recoverable: true,
        },
      ],
    });
    expect(result.diagnosticCount).toBe(1);
    expect(result.instructionsChanged).toBe(false);
  });

  it("removeSource clears both registry and store for that sourceId", () => {
    const registry = new CommandRegistry();
    const store = new AIFetchlyContextStore();
    const sync = new AIFetchlyRuntimeRegistrySync(registry, store);

    store.replaceInstructions("user", [makeBlock()]);
    sync.removeSource("user");
    expect(store.getGlobalInstructions()).toEqual([]);
    expect(registry.list()).toEqual([]);
  });

  it("applySnapshot does not crash when commands array is empty (phase 13 invariant)", () => {
    const registry = new CommandRegistry();
    const store = new AIFetchlyContextStore();
    const sync = new AIFetchlyRuntimeRegistrySync(registry, store);
    expect(() =>
      sync.applySnapshot({
        source: "user",
        sourceId: "user",
        rootPath: "/tmp/x",
        version: 1,
        files: [],
        instructions: [],
        commands: [],
        agents: [],
        hooks: [],
        skills: [],
        diagnostics: [],
      })
    ).not.toThrow();
  });
});

// --- AIFetchlyConfigManager (singleton orchestrator) ------------------------

describe("AIFetchlyConfigManager (DX-02 placeholder, CTX-03 cache miss)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-mgr-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function newManager(): AIFetchlyConfigManager {
    // Inject a fresh store per test so state never leaks between tests.
    return new AIFetchlyConfigManager({
      rootPath: tmpRoot,
      store: new AIFetchlyContextStore(),
      registry: new CommandRegistry(),
    });
  }

  it("getInstructionBlocks returns [] BEFORE initialize() (cache miss, CTX-03)", async () => {
    const mgr = newManager();
    const loader = new AIFetchlyContextLoader(mgr.getContextStore());
    expect(await loader.getInstructionBlocks(ctxInput)).toEqual([]);
  });

  it("initialize() loads AGENTS.md into the cache", async () => {
    fs.writeFileSync(path.join(tmpRoot, "AGENTS.md"), "# Global rules\n- be terse");
    const mgr = newManager();
    await mgr.initialize();
    const blocks = await new AIFetchlyContextLoader(mgr.getContextStore()).getInstructionBlocks(
      ctxInput
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toContain("be terse");
    // And the label is the exact CTX-01 wording.
    const labeled = AIFetchlyContextLoader.formatInstructionBlock(blocks[0]!);
    expect(labeled.startsWith("User global AiFetchly instructions")).toBe(true);
  });

  it("initialize() is idempotent — calling twice does not crash or duplicate", async () => {
    fs.writeFileSync(path.join(tmpRoot, "AGENTS.md"), "rules");
    const mgr = newManager();
    await mgr.initialize();
    await expect(mgr.initialize()).resolves.toBeUndefined();
    const blocks = await new AIFetchlyContextLoader(mgr.getContextStore()).getInstructionBlocks(
      ctxInput
    );
    expect(blocks).toHaveLength(1);
  });

  it("reload() reflects new content after the file changes", async () => {
    fs.writeFileSync(path.join(tmpRoot, "AGENTS.md"), "version-1");
    const mgr = newManager();
    await mgr.initialize();
    fs.writeFileSync(path.join(tmpRoot, "AGENTS.md"), "version-2");
    await mgr.reload();
    const blocks = await new AIFetchlyContextLoader(mgr.getContextStore()).getInstructionBlocks(
      ctxInput
    );
    expect(blocks[0]!.content).toBe("version-2");
  });

  it("getStatus() returns watcherState 'not-started' (DX-02 phase-14 placeholder)", async () => {
    const mgr = newManager();
    await mgr.initialize();
    const status = mgr.getStatus();
    expect(status.watcherState).toBe("not-started");
    expect(typeof status.commandCount).toBe("number");
    expect(typeof status.diagnosticCount).toBe("number");
    expect(status.lastReloadAt).toBeGreaterThan(0);
  });

  it("getStatus() reports commandCount=0 and diagnosticCount=0 on a clean folder", async () => {
    const mgr = newManager();
    await mgr.initialize();
    const status = mgr.getStatus();
    expect(status.commandCount).toBe(0);
    expect(status.diagnosticCount).toBe(0);
  });

  it("getStatus() surfaces diagnostics from the snapshot (e.g. oversized file)", async () => {
    // Write an oversized AGENTS.md so the loader emits a file-too-large diagnostic.
    fs.writeFileSync(
      path.join(tmpRoot, "AGENTS.md"),
      Buffer.alloc(256 * 1024 + 1, 0x61) // 1 byte over the 256 KiB limit
    );
    const mgr = newManager();
    await mgr.initialize();
    const status = mgr.getStatus();
    expect(status.diagnosticCount).toBeGreaterThanOrEqual(1);
  });

  it("manager.getInstructionBlocks delegates to the context loader", async () => {
    fs.writeFileSync(path.join(tmpRoot, "AGENTS.md"), "delegated");
    const mgr = newManager();
    await mgr.initialize();
    const blocks = await mgr.getInstructionBlocks(ctxInput);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toBe("delegated");
  });

  it("manager exposes its CommandRegistry for Plan 03b built-in registration", () => {
    const mgr = newManager();
    const reg = mgr.getCommandRegistry();
    expect(reg).toBeInstanceOf(CommandRegistry);
    expect(reg.list()).toEqual([]);
  });

  it("onConfigChanged fires when reload() applies a new snapshot", async () => {
    fs.writeFileSync(path.join(tmpRoot, "AGENTS.md"), "v1");
    const mgr = newManager();
    let fired = 0;
    mgr.onConfigChanged(() => {
      fired += 1;
    });
    await mgr.initialize();
    fs.writeFileSync(path.join(tmpRoot, "AGENTS.md"), "v2");
    await mgr.reload();
    expect(fired).toBeGreaterThanOrEqual(1);
  });

  it("initialize() is fire-and-forget safe — never throws synchronously", () => {
    const mgr = new AIFetchlyConfigManager({
      // Point at a path that will fail (a file, not a directory).
      rootPath: path.join(tmpRoot, "not-a-dir"),
      store: new AIFetchlyContextStore(),
      registry: new CommandRegistry(),
    });
    // No await — must not throw synchronously.
    expect(() => {
      void mgr.initialize();
    }).not.toThrow();
  });

  it("getAIFetchlyConfigManager() returns the same singleton across calls", () => {
    const a = getAIFetchlyConfigManager();
    const b = getAIFetchlyConfigManager();
    expect(a).toBe(b);
  });
});

// Ensure the module-level singleton does not bleed state into other tests by
// confirming it constructs without arguments (smoke test only — we never call
// initialize() on it here because that would read the real ~/.aifetchly).
describe("AIFetchlyConfigLoader (Plan 01 interop)", () => {
  it("a real Plan-01 loader snapshot flows through the sync into the cache", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-interop-"));
    try {
      fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# hi");
      const loader = new AIFetchlyConfigLoader(tmp);
      const snapshot = await loader.scanGlobalRoot();
      expect(snapshot.instructions).toHaveLength(1);

      const store = new AIFetchlyContextStore();
      const registry = new CommandRegistry();
      const sync = new AIFetchlyRuntimeRegistrySync(registry, store);
      sync.applySnapshot(snapshot);

      const out = store.getGlobalInstructions();
      expect(out).toHaveLength(1);
      expect(out[0]!.content).toBe("# hi");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
