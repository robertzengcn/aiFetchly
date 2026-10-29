/**
 * Agent-task seeding for the default-surface exact-cancel E2E (FR-INT-004,
 * T5/D7). Two agent_tasks rows are INSERTed through the sqlite3 CLI from the
 * test process (same route as generated-image seeding: the app's
 * better-sqlite3 is rebuilt for Electron's ABI, so the test process uses the
 * CLI instead). The cancel channel handler treats non-live non-terminal rows
 * exactly like the IPC surface does — this certifies the exact-cancel path
 * without a live specialist run.
 */

import type { E2ETestRoot } from "../fixtures/types";
import { DB_FILE_NAME } from "./generatedImageSeed";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execFileAsync = promisify(execFile);

export interface SeededAgentTaskSpec {
  readonly agentTaskId: string;
  readonly agentId: string;
  readonly status: "running" | "completed";
  readonly parentConversationId?: string;
}

const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** Insert one row per spec; taskPacket rides a temp file via readfile(). */
export async function seedAgentTasks(
  testRoot: E2ETestRoot,
  specs: readonly SeededAgentTaskSpec[]
): Promise<void> {
  if (specs.length === 0) return;
  const dbPath = path.join(testRoot.databasePath, DB_FILE_NAME);
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const packetFiles: string[] = [];
  const parts: string[] = [];
  for (const spec of specs) {
    const packetFile = path.join(
      testRoot.rootPath,
      `seed-packet-${spec.agentTaskId.replace(/[^a-zA-Z0-9-]/g, "_")}.json`
    );
    fs.writeFileSync(
      packetFile,
      JSON.stringify({ goal: "e2e exact-cancel journey", steps: [] }),
      "utf8"
    );
    const startedLiteral =
      spec.status === "running" ? sqlLiteral(now) : "CURRENT_TIMESTAMP";
    const finishedLiteral =
      spec.status === "completed" ? "CURRENT_TIMESTAMP" : "NULL";
    parts.push(
      `INSERT INTO agent_tasks (agentTaskId, agentConversationId, agentId, agentVersion, status, prompt, taskPacket, toolCallsCount, workflowRunId, parentConversationId, startedAt, finishedAt, createdAt, updatedAt) VALUES (${sqlLiteral(
        spec.agentTaskId
      )}, ${sqlLiteral(`conv-agent-${Date.now()}`)}, ${sqlLiteral(
        spec.agentId
      )}, 1, ${sqlLiteral(spec.status)}, ${sqlLiteral(
        "e2e seeded agent task prompt"
      )}, CAST(readfile(${sqlLiteral(packetFile)}) AS TEXT), 0, NULL      , ${
        spec.parentConversationId
          ? sqlLiteral(spec.parentConversationId)
          : "NULL"
      },       ${startedLiteral}, ${finishedLiteral}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`
    );
    packetFiles.push(packetFile);
  }
  parts.push(
    `SELECT COUNT(*) FROM agent_tasks WHERE agentTaskId IN (${specs
      .map((s) => sqlLiteral(s.agentTaskId))
      .join(", ")});`
  );
  const { stdout } = await execFileAsync("sqlite3", [
    dbPath,
    "-cmd",
    ".timeout 10000",
    parts.join(" "),
  ]);
  for (const f of packetFiles) fs.rmSync(f, { force: true });
  const inserted = parseInt(stdout.trim().split(/\s+/).pop() ?? "0", 10);
  if (inserted !== specs.length) {
    throw new Error(
      `Expected to insert ${specs.length} agent task rows, inserted ${inserted}`
    );
  }
}

export interface AgentTaskRowStatus {
  readonly status: string;
  readonly finishedAt: string | null;
}

/** Read task statuses via the CLI (no ABI coupling with the app bundle). */
export async function readAgentTaskStatuses(
  testRoot: E2ETestRoot,
  agentTaskIds: readonly string[]
): Promise<Map<string, AgentTaskRowStatus>> {
  const dbPath = path.join(testRoot.databasePath, DB_FILE_NAME);
  const select = agentTaskIds.map((id) => sqlLiteral(id)).join(", ");
  const { stdout } = await execFileAsync("sqlite3", [
    "-json",
    dbPath,
    "-cmd",
    ".timeout 10000",
    `SELECT agentTaskId AS agentTaskId, status AS status, finishedAt AS finishedAt FROM agent_tasks WHERE agentTaskId IN (${select});`,
  ]);
  const rows = JSON.parse(stdout || "[]") as Array<{
    agentTaskId: string;
    status: string;
    finishedAt: string | null;
  }>;
  return new Map(rows.map((r) => [r.agentTaskId, r]));
}
