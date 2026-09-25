import type { AIChatQueryEngine } from "@/service/AIChatQueryEngine";

/**
 * Pending-permission metadata the engine publishes when it parks a turn.
 * Lets the IPC layer route grant/deny without holding a reference to the
 * engine's private pendingPermissions map.
 */
export interface ScheduledPendingPermission {
  readonly toolId: string;
}

/** Entry registered while a scheduled occurrence is executing. */
export interface ScheduledEngineEntry {
  readonly engine: AIChatQueryEngine;
  readonly runId: number;
  readonly scheduleId: number;
  /** Clears the 1h permission backstop timer when the user responds. Optional
   * because not every registration will have started a backstop. */
  readonly clearPermissionBackstop?: () => void;
}

/**
 * In-memory registry of active scheduled-loop engines, keyed by
 * conversationId. Mirrors `ScheduledLoopRunRegistry` (which keys by runId for
 * abort) — this keys by conversationId so the grant/deny IPC, which only has
 * conversationId + toolId, can locate the scheduled engine that owns the
 * paused turn.
 *
 * This is an execution aid only — never recovery state. It lives in memory and
 * disappears at process restart; durable run state is recovered from the
 * database (technical-design §15.4, §17.4).
 */
export class ScheduledLoopEngineRegistry {
  private static instance: ScheduledLoopEngineRegistry | null = null;
  private readonly engines = new Map<string, ScheduledEngineEntry>();
  private readonly pending = new Map<string, ScheduledPendingPermission>();

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): ScheduledLoopEngineRegistry {
    if (!ScheduledLoopEngineRegistry.instance) {
      ScheduledLoopEngineRegistry.instance = new ScheduledLoopEngineRegistry();
    }
    return ScheduledLoopEngineRegistry.instance;
  }

  /** Register a scheduled engine for an active occurrence. */
  register(entry: ScheduledEngineEntry & { conversationId: string }): void {
    this.engines.set(entry.conversationId, entry);
  }

  /** Unregister when the occurrence terminates. Idempotent. */
  unregister(conversationId: string): void {
    this.engines.delete(conversationId);
    this.pending.delete(conversationId);
  }

  /** Look up the live scheduled engine for a conversation, if any. */
  getByConversation(conversationId: string): ScheduledEngineEntry | undefined {
    return this.engines.get(conversationId);
  }

  /** Publish that a scheduled engine has a paused permission-gated tool. */
  setPendingPermission(conversationId: string, meta: ScheduledPendingPermission): void {
    this.pending.set(conversationId, meta);
  }

  /** True when a scheduled engine has a pending permission matching toolId. */
  hasPendingPermission(conversationId: string, toolId: string): boolean {
    const meta = this.pending.get(conversationId);
    return !!meta && meta.toolId === toolId;
  }

  /** Clear pending-permission metadata (after grant/deny/backstop). */
  clearPendingPermission(conversationId: string): void {
    this.pending.delete(conversationId);
  }

  /** Test-only: reset all state. */
  clear(): void {
    this.engines.clear();
    this.pending.clear();
  }
}
