/**
 * CMD-06 (Phase 15 / Plan 02) — WorkspaceWatchManager draft→definition wiring
 * tests (SC4 workspace path) + D-03 workspace-shadows-global registry test.
 *
 * The manager now converts the worker snapshot's raw WorkspaceCommandDraft[]
 * commands into validated SlashCommandDefinition[] IN THE MAIN PROCESS before
 * invoking applyWorkspaceSnapshotCallback, merging validation diagnostics
 * into the snapshot. The Phase-14 trust filter still runs inside
 * applyWorkspaceSnapshot (unchanged) — this test trusts the workspace so the
 * converted commands flow through.
 *
 * D-03 shadow is a registry-level property (SOURCE_RANK workspace < user,
 * lower wins; built-ins rank 0 and cannot be shadowed) — asserted directly
 * against CommandRegistry.replaceSource.
 */
import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigSnapshot,
} from "@/entityTypes/aifetchlyConfigTypes";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import type { WorkspaceWatchCommand } from "@/service/workspaceWatch/WorkspaceWatchProtocol";
import { WorkspaceWatchManager } from "@/service/workspaceWatch/WorkspaceWatchManager";
import type { WorkspaceCommandDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";

// --- Minimal fake worker (only what the manager touches in this flow) --------

interface FakeWorker extends EventEmitter {
  connected: boolean;
  pid: number;
  send: (cmd: WorkspaceWatchCommand) => void;
  kill: (signal?: string) => void;
}
function createFakeWorker(): FakeWorker {
  const w = new EventEmitter() as FakeWorker;
  w.connected = true;
  w.pid = 12345;
  // No-op stubs: the manager only needs the worker to accept send() and be
  // killable in this flow; it never asserts on either here.
  w.send = () => undefined;
  w.kill = () => undefined;
  return w;
}

function createManager(): {
  manager: WorkspaceWatchManager;
  forkStub: ReturnType<typeof vi.fn>;
  applySnapshotCallback: ReturnType<typeof vi.fn>;
} {
  const applySnapshotCallback = vi.fn();
  const configChangedEmitter = vi.fn();
  const trustResolver = vi.fn(() => true); // trusted workspace -> commands flow
  const forkStub = vi.fn();
  const manager = new WorkspaceWatchManager({
    applySnapshotCallback,
    configChangedEmitter,
    trustResolver,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fork: forkStub as any,
  });
  return { manager, forkStub, applySnapshotCallback };
}

function draftReview(): WorkspaceCommandDraft {
  return {
    id: "workspace:ws1:command:review",
    source: "workspace",
    sourceId: "workspace:ws1",
    relativePath: ".aifetchly/commands/review.md",
    frontmatter: {
      name: "review",
      description: "Review changes",
      type: "prompt",
    },
    body: "Review $ARGUMENTS",
    contentHash: "h",
  };
}

function snapshotWith(
  commands: readonly WorkspaceCommandDraft[],
  diagnostics: readonly AIFetchlyConfigDiagnostic[] = []
): AIFetchlyConfigSnapshot {
  return {
    source: "workspace",
    sourceId: "workspace:ws1",
    rootPath: "/tmp/ws1",
    version: 1,
    files: [],
    instructions: [],
    commands,
    agents: [],
    hooks: [],
    skills: [],
    diagnostics,
  };
}

describe("WorkspaceWatchManager command draft→definition wiring (CMD-06 / SC4)", () => {
  it("converts worker drafts to SlashCommandDefinitions BEFORE applyWorkspaceSnapshotCallback", () => {
    const { manager, forkStub, applySnapshotCallback } = createManager();
    const worker = createFakeWorker();
    forkStub.mockReturnValue(worker);
    manager.acquire({
      workspaceId: "ws1",
      workspaceRoot: "/tmp/ws1",
      consumerId: "chat:c1",
      reason: "chat-open",
    });

    worker.emit("message", {
      type: "snapshot",
      workspaceId: "ws1",
      snapshot: snapshotWith([draftReview()]),
    });

    expect(applySnapshotCallback).toHaveBeenCalledTimes(1);
    const passed = applySnapshotCallback.mock
      .calls[0][0] as AIFetchlyConfigSnapshot;
    expect(passed.commands).toHaveLength(1);
    const cmd = passed.commands[0] as SlashCommandDefinition;
    expect(cmd.name).toBe("review");
    expect(cmd.type).toBe("prompt");
    expect(cmd.source).toBe("workspace");
    expect(cmd.id).toBe("workspace:ws1:command:review");
  });

  it("merges validation diagnostics into the snapshot passed downstream", () => {
    const { manager, forkStub, applySnapshotCallback } = createManager();
    const worker = createFakeWorker();
    forkStub.mockReturnValue(worker);
    manager.acquire({
      workspaceId: "ws1",
      workspaceRoot: "/tmp/ws1",
      consumerId: "chat:c1",
      reason: "chat-open",
    });

    // One valid draft + one invalid (uppercase name). The snapshot ALSO carries
    // a pre-existing scanner diagnostic, which must survive the merge.
    const invalid: WorkspaceCommandDraft = {
      id: "workspace:ws1:command:Bad",
      source: "workspace",
      sourceId: "workspace:ws1",
      relativePath: ".aifetchly/commands/Bad.md",
      frontmatter: { name: "Bad", description: "x", type: "prompt" },
      body: "body",
      contentHash: "h2",
    };
    const preexisting = {
      severity: "warning" as const,
      source: "workspace" as const,
      sourceId: "workspace:ws1",
      filePath: ".aifetchly/AGENTS.md",
      code: "scanner-io-error",
      message: "stale",
      recoverable: true,
    };

    worker.emit("message", {
      type: "snapshot",
      workspaceId: "ws1",
      snapshot: snapshotWith([draftReview(), invalid], [preexisting]),
    });

    const passed = applySnapshotCallback.mock
      .calls[0][0] as AIFetchlyConfigSnapshot;
    // Only the one valid draft became a definition.
    expect(passed.commands).toHaveLength(1);
    // The pre-existing diagnostic survived AND the validation diagnostic was merged.
    const codes = passed.diagnostics.map((d) => d.code);
    expect(codes).toContain("scanner-io-error");
    expect(codes).toContain("command-name-invalid");
  });
});

describe("CommandRegistry D-03 precedence (workspace shadows user; built-in wins)", () => {
  function def(
    source: SlashCommandDefinition["source"],
    sourceId: string,
    name: string
  ): SlashCommandDefinition {
    return {
      id: `${sourceId}:command:${name}`,
      name,
      description: `${name} from ${sourceId}`,
      aliases: [],
      type: "prompt",
      source,
      sourceId,
      sourceLabel: source,
      requiresTrust: false,
      enabled: true,
      body: `body ${name}`,
    };
  }

  it("workspace 'review' shadows user 'review' (SOURCE_RANK workspace < user)", () => {
    const registry = new CommandRegistry();
    registry.replaceSource("user", [def("user", "user", "review")]);
    registry.replaceSource("workspace:ws1", [
      def("workspace", "workspace:ws1", "review"),
    ]);

    const winner = registry.getByName("review");
    expect(winner).not.toBeNull();
    expect(winner?.source).toBe("workspace");
    expect(winner?.sourceId).toBe("workspace:ws1");
  });

  it("a built-in 'help' is NOT shadowed by user or workspace 'help'", () => {
    const registry = new CommandRegistry();
    registry.register({
      id: "built-in:command:help",
      name: "help",
      description: "Built-in help",
      aliases: [],
      type: "local",
      source: "built-in",
      sourceId: "built-in",
      sourceLabel: "Built-in",
      requiresTrust: false,
      enabled: true,
    });
    registry.replaceSource("user", [def("user", "user", "help")]);
    registry.replaceSource("workspace:ws1", [
      def("workspace", "workspace:ws1", "help"),
    ]);

    const winner = registry.getByName("help");
    expect(winner?.source).toBe("built-in");
  });
});
