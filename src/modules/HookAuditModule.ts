import { BaseModule } from "./baseModule";
import {
  HookAuditModel,
  HookAuditQuery,
  HookAuditQueryResult,
} from "@/model/HookAudit.model";
import { HookModel } from "@/model/Hook.model";
import type {
  HookAuditStatus,
  HookEventName,
  HookSource,
  HookCommandType,
} from "@/entityTypes/hookTypes";

export interface RecordEntryInput {
  hookRunId: string;
  hookId: string;
  eventName: HookEventName;
  source: HookSource;
  type: HookCommandType;
  matchQuery?: string;
  status: HookAuditStatus;
  durationMs?: number;
  reason?: string;
}

/**
 * Records hook audit entries to SQLite and updates the matching
 * HookConfig row's lastRunAt/lastRunStatus fields.
 *
 * Called by HookAuditService.PersistentHookAuditLogger — never by
 * renderer code directly.
 *
 * Extends BaseModule (the worker guard is enforced inside the
 * underlying HookAuditModel/HookModel constructors, which throw
 * when process.env.WORKER_TYPE is set).
 */
export class HookAuditModule extends BaseModule {
  private readonly auditModel: HookAuditModel;
  private readonly hookModel: HookModel;

  constructor() {
    super();
    this.auditModel = new HookAuditModel(this.dbpath);
    this.hookModel = new HookModel(this.dbpath);
  }

  async recordEntry(input: RecordEntryInput): Promise<void> {
    await this.auditModel.insert({
      hookRunId: input.hookRunId,
      hookId: input.hookId,
      eventName: input.eventName,
      source: input.source,
      type: input.type,
      matchQuery: input.matchQuery ?? null,
      status: input.status,
      durationMs: input.durationMs ?? null,
      reason: input.reason ?? null,
      timestamp: new Date(),
    });

    // Refresh lastRun on the matching hook config row, if it exists.
    // Builtins and session hooks have no DB row — the model update
    // is a no-op in that case (UPDATE matches zero rows), but we
    // swallow any error defensively.
    try {
      await this.hookModel.updateRunStatus(
        input.hookId,
        input.status,
        new Date()
      );
    } catch {
      // No config row for this hook (builtin/session) — ignore.
    }
  }

  async query(q: HookAuditQuery): Promise<HookAuditQueryResult> {
    return this.auditModel.query(q);
  }

  async clearForTests(): Promise<void> {
    await this.auditModel.clear();
  }
}
