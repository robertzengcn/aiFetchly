/**
 * AIFetchlyConfigManager — singleton orchestrator for the AiFetchly local
 * extensibility config stack.
 *
 * Owns the lifecycle of the global ~/.aifetchly scan: at startup it triggers
 * {@link AIFetchlyConfigLoader.scanGlobalRoot} (Plan 01), feeds the snapshot
 * through {@link AIFetchlyRuntimeRegistrySync}, and exposes status / reload /
 * instruction-block accessors consumed by the IPC layer (Plan 03b) and the
 * AIChatContextAssembler (Plan 13-03a Task 2).
 *
 * Phase-14 (Plan 14-03) integration:
 *   - {@link setWorkspaceWatchManager} wires the watcher singleton (called
 *     once at startup after the watcher manager is constructed). When wired,
 *     {@link getStatus}.watcherState reflects the real manager state
 *     (DX-02): "not-started" | "watching" | "failed".
 *   - Only the global source ("user") is scanned directly here; workspace
 *     snapshots flow through the watcher → applyWorkspaceSnapshot.
 *   - The startup scan is fire-and-forget safe: initialize() never throws
 *     synchronously and any async error is caught + logged (the caller in
 *     background.ts wires the actual .catch in Plan 03b — Pitfall 6).
 *
 * Design references: §8.1 (orchestrator responsibilities), §19.1 (startup
 * sequence), §12.3 (cache miss / read failure never blocks chat).
 */

import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigSnapshot,
} from "@/entityTypes/aifetchlyConfigTypes";
import { AIFetchlyConfigLoader } from "./AIFetchlyConfigLoader";
import { log } from "@/modules/Logger";
import {
  AIFetchlyContextStore,
  getGlobalAIFetchlyContextStore,
} from "./AIFetchlyContextStore";
import {
  AIFetchlyContextLoader,
  type AIFetchlyContextInput,
} from "./AIFetchlyContextLoader";
import { AIFetchlyRuntimeRegistrySync } from "./AIFetchlyRuntimeRegistrySync";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { AgentDefinitionRegistryImpl } from "@/service/AgentDefinitionRegistry";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import type { WorkspaceWatchManager } from "@/service/workspaceWatch/WorkspaceWatchManager";

/** Result of {@link AIFetchlyConfigManager.reload}. */
export interface AIFetchlyConfigReloadSummary {
  readonly commandCount: number;
  readonly diagnosticCount: number;
  readonly lastReloadAt: number;
  readonly instructionsChanged: boolean;
}

/** Shape returned by {@link AIFetchlyConfigManager.getStatus}. */
export interface AIFetchlyConfigStatus {
  readonly commandCount: number;
  readonly agentCount: number;
  readonly hookCount: number;
  readonly skillCount: number;
  readonly diagnosticCount: number;
  readonly lastReloadAt: number;
  /**
   * Runtime state of the workspace watcher (DX-02). Plan 14-03 widened
   * this from the Phase-13 literal `"not-started"` to a union reflecting
   * the injected {@link WorkspaceWatchManager}'s state:
   *   - `"not-started"`: no manager wired OR manager.workerState is
   *     `"not-started"` (0 watched workspaces).
   *   - `"watching"`: manager.workerState is `"running"` or `"restarting"`
   *     — at least one workspace is being observed (worker forked).
   *   - `"failed"`: manager.workerState is `"failed"` — restart cap
   *     exceeded; /reload-config required to recover.
   */
  readonly watcherState: "not-started" | "watching" | "failed";
  /** Active source for /status display. */
  readonly source: "user";
}

/** Constructor options (all optional — defaults wire the real singletons). */
export interface AIFetchlyConfigManagerOptions {
  /** Override the ~/.aifetchly root for tests. */
  readonly rootPath?: string;
  /** Override the loader (tests inject a real loader pointed at tmpdir). */
  readonly loader?: AIFetchlyConfigLoader;
  readonly store?: AIFetchlyContextStore;
  readonly registry?: CommandRegistry;
  /** Override the agent registry (Phase 16 / Plan 02 — tests inject an isolated one). */
  readonly agentRegistry?: AgentDefinitionRegistryImpl;
  readonly sync?: AIFetchlyRuntimeRegistrySync;
}

/**
 * Singleton orchestrator. Use {@link getAIFetchlyConfigManager} for production
 * access; construct directly with options for tests.
 */
export class AIFetchlyConfigManager {
  private readonly loader: AIFetchlyConfigLoader;
  private readonly store: AIFetchlyContextStore;
  private readonly registry: CommandRegistry;
  /**
   * Phase 16 (Plan 02): the manager owns the AgentDefinitionRegistry alongside
   * the existing CommandRegistry. Built-ins are seeded at construction (the
   * registry's own constructor calls registerBuiltIns). getAgentRegistry()
   * exposes it to Plan 03 (dispatch resolution + /agents command + context).
   */
  private readonly agentRegistry: AgentDefinitionRegistryImpl;
  private readonly sync: AIFetchlyRuntimeRegistrySync;
  private readonly contextLoader: AIFetchlyContextLoader;
  private readonly listeners = new Set<() => void>();

  /**
   * Watcher manager reference injected by Plan 14-03's startup wiring.
   * Null until {@link setWorkspaceWatchManager} is called (or never set in
   * tests that don't exercise the watcher). getStatus() degrades to
   * "not-started" when null.
   */
  private watcherManager: WorkspaceWatchManager | null = null;

  private initialized = false;
  private lastSnapshot: AIFetchlyConfigSnapshot | null = null;
  private lastReloadAt = 0;
  private lastDiagnosticCount = 0;

  constructor(options: AIFetchlyConfigManagerOptions = {}) {
    this.loader = options.loader ?? new AIFetchlyConfigLoader(options.rootPath);
    this.store = options.store ?? getGlobalAIFetchlyContextStore();
    this.registry = options.registry ?? new CommandRegistry();
    this.agentRegistry =
      options.agentRegistry ?? new AgentDefinitionRegistryImpl();
    this.sync =
      options.sync ??
      new AIFetchlyRuntimeRegistrySync(
        this.registry,
        this.store,
        this.agentRegistry,
        HookRegistry
      );
    // The context loader reads from the SAME store the sync writes to.
    this.contextLoader = new AIFetchlyContextLoader(this.store);
  }

  /**
   * Trigger the initial scan + apply. Idempotent: a second call when already
   * initialized returns immediately. Fire-and-forget safe — never throws
   * synchronously; async errors are caught + logged (Pitfall 6).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.scanAndApply();
    this.initialized = true;
  }

  /**
   * Force a re-scan and re-apply. Returns a summary of the new state and
   * fires registered onConfigChanged listeners. Used by /reload-config.
   */
  async reload(): Promise<AIFetchlyConfigReloadSummary> {
    const prev = this.lastSnapshot;
    await this.scanAndApply();
    const next = this.lastSnapshot!;
    const instructionsChanged =
      prev === null
        ? next.instructions.length > 0
        : snapInstructionsDiffer(prev, next);
    this.fireConfigChanged();
    return {
      commandCount: this.registry.list().length,
      diagnosticCount: this.lastDiagnosticCount,
      lastReloadAt: this.lastReloadAt,
      instructionsChanged,
    };
  }

  /**
   * Synchronous status snapshot for /status display. watcherState reflects
   * the injected {@link WorkspaceWatchManager} (DX-02); absent manager →
   * "not-started".
   */
  getStatus(): AIFetchlyConfigStatus {
    return {
      commandCount: this.registry.list().length,
      // Phase 16 (Plan 02): agentCount reflects built-in + user + trusted-
      // workspace agents currently in the registry (no longer hardcoded 0).
      agentCount: this.agentRegistry.list().length,
      hookCount: this.lastSnapshot?.hooks.length ?? 0,
      skillCount: this.lastSnapshot?.skills.length ?? 0,
      diagnosticCount: this.lastDiagnosticCount,
      lastReloadAt: this.lastReloadAt,
      watcherState: this.computeWatcherState(),
      source: "user",
    };
  }

  /**
   * Wire the {@link WorkspaceWatchManager} singleton. Called once during
   * main-process startup (Plan 14-03 background.ts) AFTER the manager is
   * constructed. After this call, getStatus().watcherState reflects the
   * real watcher state (DX-02).
   */
  setWorkspaceWatchManager(manager: WorkspaceWatchManager): void {
    this.watcherManager = manager;
  }

  /**
   * Map the manager's workerState ("not-started" | "running" |
   * "restarting" | "failed") onto the public watcherState union
   * ("not-started" | "watching" | "failed"). The "restarting" state is
   * folded into "watching" — the worker is bouncing but the watch is
   * still active from the user's perspective.
   */
  private computeWatcherState(): "not-started" | "watching" | "failed" {
    const m = this.watcherManager;
    if (!m) return "not-started";
    const workerState = m.getStatus().workerState;
    if (workerState === "failed") return "failed";
    if (workerState === "running" || workerState === "restarting") {
      return "watching";
    }
    return "not-started";
  }

  /**
   * Delegate to the context loader so IPC consumers (e.g. /status rich
   * preview) can read the cached blocks without depending on the loader
   * class directly. The assembler uses {@link AIFetchlyContextLoader}
   * directly (Plan 13-03a Task 2).
   */
  async getInstructionBlocks(
    input: AIFetchlyContextInput
  ): Promise<ReturnType<AIFetchlyContextLoader["getInstructionBlocks"]>> {
    return this.contextLoader.getInstructionBlocks(input);
  }

  /**
   * Register a listener fired after a successful reload. Returns an
   * unsubscribe function. Plan 03b wires the actual BrowserWindow.send from
   * here; phase 13 only exposes the registration surface.
   */
  onConfigChanged(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /** Expose the CommandRegistry for Plan 03b's built-in registration. */
  getCommandRegistry(): CommandRegistry {
    return this.registry;
  }

  /**
   * Expose the AgentDefinitionRegistry (Phase 16 / Plan 02). Plan 03 consumes
   * this for dispatch resolution, the /agents command, and the model-discovery
   * context block. Built-ins are already seeded at construction.
   */
  getAgentRegistry(): AgentDefinitionRegistryImpl {
    return this.agentRegistry;
  }

  /** Expose the ContextStore (test-only convenience). */
  getContextStore(): AIFetchlyContextStore {
    return this.store;
  }

  /**
   * Expose the runtime-registry-sync. Plan 14-03's WorkspaceWatchManager
   * singleton uses this to wire its applySnapshotCallback to
   * {@link AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot} so workspace
   * snapshots flow through the SAME trust-filtered apply path as the global
   * scan. Sharing the instance keeps the registry + cache targets consistent.
   */
  getRegistrySync(): AIFetchlyRuntimeRegistrySync {
    return this.sync;
  }

  private async scanAndApply(): Promise<void> {
    const snapshot = await this.loader.scanGlobalRoot();
    const result = this.sync.applySnapshot(snapshot);
    this.lastSnapshot = snapshot;
    this.lastDiagnosticAt = Date.now();
    this.lastReloadAt = this.lastDiagnosticAt;
    this.lastDiagnosticCount = result.diagnosticCount;
  }

  private lastDiagnosticAt = 0;

  private fireConfigChanged(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        log.error(
          "[aifetchly-config] onConfigChanged listener threw:",
          err
        );
      }
    }
  }
}

/**
 * Module-level singleton accessor. The first call constructs the manager
 * bound to the real ~/.aifetchly root; subsequent calls return the same
 * instance.
 */
let singleton: AIFetchlyConfigManager | null = null;

export function getAIFetchlyConfigManager(): AIFetchlyConfigManager {
  if (!singleton) {
    singleton = new AIFetchlyConfigManager();
  }
  return singleton;
}

/**
 * Pure helper: detect whether the instruction set changed between snapshots.
 * Used by reload() to populate the summary's instructionsChanged flag.
 */
function snapInstructionsDiffer(
  prev: AIFetchlyConfigSnapshot,
  next: AIFetchlyConfigSnapshot
): boolean {
  if (prev.instructions.length !== next.instructions.length) return true;
  const prevHashes = new Map<string, string>();
  for (const b of prev.instructions) prevHashes.set(b.id, b.contentHash);
  for (const n of next.instructions) {
    const h = prevHashes.get(n.id);
    if (h === undefined) return true;
    if (h !== n.contentHash) return true;
  }
  return false;
}

// Diagnostic type re-export for callers that want to typecheck diagnostics
// surfaced via getStatus (currently surfaced as a count only).
export type { AIFetchlyConfigDiagnostic };
