import { BaseModule } from "@/modules/baseModule";
import { BrowserTaskModel } from "@/model/BrowserTask.model";
import { BrowserTaskEntity } from "@/entity/BrowserTask.entity";
import { log } from "@/modules/Logger";

/**
 * Durable browser-task cursor module (T19; PRD D-FR-07/10, C-FR-14).
 *
 * Persists a bounded metadata cursor for each accelerated browser task:
 * admission (with the frozen route + provider revision), the mutation
 * journal (intent before dispatch, outcome after), and the terminal phase.
 * On app restart, unfinished tasks are marked interrupted — no mutation is
 * ever automatically replayed.
 */
export class BrowserTaskModule extends BaseModule {
  private model: BrowserTaskModel | null = null;

  private async getModel(): Promise<BrowserTaskModel> {
    if (!this.model) {
      await this.ensureConnection();
      this.model = new BrowserTaskModel(this.dbpath);
    }
    return this.model;
  }

  /** Called at task admission (before any mutation). */
  public async recordAdmission(input: {
    readonly taskId: string;
    readonly sessionId: string;
    readonly conversationId: string;
    readonly agentTaskId?: string | null;
    readonly providerMode: string;
    readonly providerConfigKey: string | null;
    /** D-FR-07: the tool call that started this task (traceability). */
    readonly toolCallId?: string | null;
    /** D-FR-07: the managed-async job driving the task, when any. */
    readonly jobId?: string | null;
  }): Promise<void> {
    const model = await this.getModel();
    const entity = new BrowserTaskEntity();
    entity.taskId = input.taskId;
    entity.sessionId = input.sessionId;
    entity.conversationId = input.conversationId;
    entity.agentTaskId = input.agentTaskId ?? null;
    entity.toolCallId = input.toolCallId ?? null;
    entity.jobId = input.jobId ?? null;
    entity.providerMode = input.providerMode;
    entity.providerConfigKey = input.providerConfigKey;
    entity.phase = "admitting";
    entity.leafSteps = 0;
    entity.decisionRequests = 0;
    entity.recoveryCalls = 0;
    entity.activeTimeMs = 0;
    await model.upsertByTaskId(entity);
  }

  /** Cursor update (phase/counters). */
  public async recordCursor(input: {
    readonly taskId: string;
    readonly phase: string;
    readonly leafSteps?: number;
    readonly decisionRequests?: number;
    readonly recoveryCalls?: number;
    readonly activeTimeMs?: number;
    readonly userInterventionCount?: number;
    /** N01/D-AC-08: provider-reported token usage for the decisions. */
    readonly decisionTokens?: number;
    /** R01/D-FR-24: the optional provider verifier's call count. */
    readonly verifierCalls?: number;
  }): Promise<void> {
    const model = await this.getModel();
    // F07/B01: MERGE with the existing cursor — counters a caller omits
    // keep their persisted values instead of being reset to zero. A
    // missing row means admission never landed for THIS id; a cursor
    // cannot be inserted without the admission's required identity
    // columns, so the caller's best-effort catch sees a clear failure.
    const existing = await model.findByTaskId(input.taskId);
    if (!existing) {
      throw new Error("task_cursor_missing_for_update");
    }
    const entity = existing;
    entity.taskId = input.taskId;
    entity.phase = input.phase;
    if (input.leafSteps !== undefined) {
      entity.leafSteps = input.leafSteps;
    }
    if (input.decisionRequests !== undefined) {
      entity.decisionRequests = input.decisionRequests;
    }
    if (input.recoveryCalls !== undefined) {
      entity.recoveryCalls = input.recoveryCalls;
    }
    if (input.activeTimeMs !== undefined) {
      entity.activeTimeMs = input.activeTimeMs;
    }
    if (input.decisionTokens !== undefined) {
      entity.decisionTokens = input.decisionTokens;
    }
    if (input.userInterventionCount !== undefined) {
      entity.userInterventionCount = input.userInterventionCount;
    }
    await model.upsertByTaskId(entity);
  }

  /** F07: read the durable cursor (tests + recovery diagnostics). */
  public async getCursor(taskId: string): Promise<BrowserTaskEntity | null> {
    const model = await this.getModel();
    return await model.findByTaskId(taskId);
  }

  /**
   * Mutation journal (design §6.2): write the intent BEFORE dispatch; write
   * the outcome AFTER. A pending intent with no outcome is interrupted with
   * unknown effect on recovery — never replayed.
   *
   * B01: the journal merges into the row created by `recordAdmission` —
   * the entity requires sessionId/conversationId/providerMode, so a
   * blind insert of an intent-only row is impossible. A missing row
   * means admission never landed for THIS execution id; the caller
   * (intent) MUST fail the mutation rather than dispatch unjournaled.
   */
  public async recordActionIntent(input: {
    readonly taskId: string;
    readonly actionType: string;
  }): Promise<void> {
    const model = await this.getModel();
    const existing = await model.findByTaskId(input.taskId);
    if (!existing) {
      throw new Error("task_cursor_missing_for_intent");
    }
    existing.pendingActionIntent = input.actionType.slice(0, 16);
    existing.pendingActionOutcome = null;
    await model.upsertByTaskId(existing);
  }

  public async recordActionOutcome(input: {
    readonly taskId: string;
    readonly outcome: "confirmed" | "no_effect" | "unknown";
  }): Promise<void> {
    const model = await this.getModel();
    const existing = await model.findByTaskId(input.taskId);
    if (!existing) {
      // Best-effort at the call sites; a missing row keeps the pending
      // intent unresolved → interrupted-with-unknown on recovery (safe).
      throw new Error("task_cursor_missing_for_outcome");
    }
    existing.pendingActionOutcome = input.outcome;
    await model.upsertByTaskId(existing);
  }

  /**
   * C06/D-FR-10/C-FR-14: a BOUNDED mid-run checkpoint (extracted rows +
   * evidence so far) merges into the admitted row's interruptedPartial —
   * a crash before the terminal write leaves the journal showing what
   * landed (restart marks the row interrupted; nothing is replayed).
   * Best-effort: a missing admitted row (pre-admission crash) has
   * nothing to checkpoint.
   */
  public async recordCheckpoint(input: {
    readonly taskId: string;
    readonly partial: {
      readonly extracted?: readonly unknown[];
      readonly evidence?: readonly string[];
    };
  }): Promise<void> {
    const model = await this.getModel();
    const existing = await model.findByTaskId(input.taskId);
    if (!existing) {
      return;
    }
    const bounded = {
      extracted: (input.partial.extracted ?? [])
        .slice(0, 50)
        .map((item) =>
          typeof item === "string"
            ? item.slice(0, 2000)
            : item !== null && typeof item === "object"
              ? (() => {
                  try {
                    const s = JSON.stringify(item);
                    return s.length > 2000
                      ? { truncated: true, bytes: s.length }
                      : item;
                  } catch {
                    return { truncated: true, bytes: 0 };
                  }
                })()
              : null,
        ),
      evidence: (input.partial.evidence ?? [])
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.slice(0, 300))
        .slice(0, 20),
    };
    const serialized = JSON.stringify(bounded);
    if (serialized.length <= 256 * 1024) {
      existing.interruptedPartial = serialized;
      await model.upsertByTaskId(existing);
    }
  }

  /** Terminal phase. */
  public async recordTerminal(input: {
    readonly taskId: string;
    readonly phase:
      | "completed"
      | "failed"
      | "cancelled"
      | "interrupted"
      // W02/D-FR-09: a partial ending persists as partial.
      | "partial";
    readonly reason: string;
    /** R12/D-FR-10: the bounded partial evidence bundle (extracted + evidence). */
    readonly partial?: {
      readonly extracted?: readonly unknown[];
      readonly evidence?: readonly string[];
    };
  }): Promise<void> {
    const model = await this.getModel();
    const entity = new BrowserTaskEntity();
    entity.taskId = input.taskId;
    entity.phase = input.phase;
    entity.terminalReason = input.reason.slice(0, 128);
    if (input.partial) {
      // R12: the partial bundle is BOUNDED — 50 extracted rows and 20
      // evidence strings, each string capped, total JSON under 256 KB.
      const bounded = {
        extracted: (input.partial.extracted ?? [])
          .slice(0, 50)
          .map((item) =>
            typeof item === "string"
              ? item.slice(0, 2000)
              : item !== null && typeof item === "object"
                ? (() => {
                    try {
                      const s = JSON.stringify(item);
                      return s.length > 2000
                        ? { truncated: true, bytes: s.length }
                        : item;
                    } catch {
                      return { truncated: true, bytes: 0 };
                    }
                  })()
                : null,
          ),
        evidence: (input.partial.evidence ?? [])
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.slice(0, 300))
          .slice(0, 20),
      };
      const serialized = JSON.stringify(bounded);
      if (serialized.length <= 256 * 1024) {
        entity.interruptedPartial = serialized;
      }
    }
    await model.upsertByTaskId(entity);
  }

  /**
   * T19/C-FR-14: called once at app startup — every non-terminal task is
   * marked interrupted (no automatic resume, no mutation replay).
   */
  public async markUnfinishedInterrupted(): Promise<number> {
    const model = await this.getModel();
    const unfinished = await model.findNonTerminal();
    const ids = unfinished
      .filter((task) => task.pendingActionOutcome === null || task.phase !== "completed")
      .map((task) => task.id);
    const count = await model.markInterrupted(
      ids,
      "app_restarted_task_interrupted"
    );
    if (count > 0) {
      log.info(
        `[BrowserTaskModule] marked ${count} unfinished browser task(s) interrupted on startup`
      );
    }
    return count;
  }
}

let defaultModule: BrowserTaskModule | null = null;

export function getDefaultBrowserTaskModule(): BrowserTaskModule {
  if (!defaultModule) {
    defaultModule = new BrowserTaskModule();
  }
  return defaultModule;
}
