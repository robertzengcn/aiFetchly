// src/model/AgentToolCall.model.ts
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AgentToolCallEntity } from "@/entity/AgentToolCall.entity";
import type { AgentToolCallRecord } from "@/entityTypes/agentTypes";

/** Keys whose values may contain secrets/cookies to strip before persistence. */
const SENSITIVE_ARG_KEYS = new Set([
  "password",
  "token",
  "secret",
  "cookie",
  "authorization",
  "apikey",
  "api_key",
]);

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_ARG_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else if (typeof v === "string" && v.length > 500) {
      out[k] = v.slice(0, 500) + "…[truncated]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export class AgentToolCallModel extends BaseDb {
  public repository: Repository<AgentToolCallEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(AgentToolCallEntity);
  }

  async save(record: AgentToolCallRecord): Promise<void> {
    await this.repository.save({
      agentTaskId: record.agentTaskId,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      argumentsSummary: sanitizeArgs(record.argumentsSummary),
      status: record.status,
      resultSummary: record.resultSummary ?? null,
      errorMessage: record.errorMessage ?? null,
      durationMs: record.durationMs ?? null,
    } as Partial<AgentToolCallEntity>);
  }

  async listByTask(agentTaskId: string): Promise<AgentToolCallRecord[]> {
    const rows = await this.repository.find({
      where: { agentTaskId },
      order: { id: "ASC" },
    });
    return rows.map((r) => ({
      agentTaskId: r.agentTaskId,
      toolCallId: r.toolCallId,
      toolName: r.toolName,
      argumentsSummary: r.argumentsSummary,
      status: r.status as AgentToolCallRecord["status"],
      resultSummary: r.resultSummary ?? undefined,
      errorMessage: r.errorMessage ?? undefined,
      durationMs: r.durationMs ?? undefined,
    }));
  }
}
