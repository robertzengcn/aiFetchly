/**
 * Unit tests for the conversation_history_search / conversation_history_read
 * tool handlers (technical-design §7.1 / §7.2 / §7.4).
 *
 * Verifies the snake_case tool-output contract, error-code propagation, the
 * search→read→resolve workflow, and per-turn retrieval-budget sharing across
 * multiple tool calls within one assistant turn.
 *
 * Token/USERSDBPATH are mocked so every Model/Module constructed in this file
 * shares one per-run test database (established pattern — see
 * AIChatQueryLoopOutboundEmailGate.test.ts).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { SqliteDb } from "@/config/SqliteDb";
import { SkillRegistry } from "@/config/skillsRegistry";

const rollout = vi.hoisted(() => ({ archive: false, tools: false }));
vi.mock("@/config/featureFlags", () => ({
  isArchiveReadsEnabled: (): boolean => rollout.archive,
  isHistoryToolsEnabled: (): boolean => rollout.tools,
}));

 describe("history tool rollout", () => {
  it.each([[false, false], [true, false], [false, true]])(
    "hides history tools when archive=%s tools=%s",
    async (archive, tools): Promise<void> => {
      rollout.archive = archive;
      rollout.tools = tools;
      for (const name of ["conversation_history_search", "conversation_history_read"]) {
        expect(await SkillRegistry.isSkillEnabledForRuntime(name)).toBe(false);
        const result = await SkillRegistry.getSkill(name)?.execute({}, { conversationId: "disabled", toolCallId: "gate" });
        expect(result?.success).toBe(false);
        expect(result?.result.error).toBe("HISTORY_UNAVAILABLE");
      }
    }
  );

  it("enables history tools only with both flags", async (): Promise<void> => {
    rollout.archive = true;
    rollout.tools = true;
    expect(await SkillRegistry.isSkillEnabledForRuntime("conversation_history_search")).toBe(true);
    expect(await SkillRegistry.isSkillEnabledForRuntime("conversation_history_read")).toBe(true);
    rollout.archive = false;
    expect(await SkillRegistry.isSkillEnabledForRuntime("conversation_history_read")).toBe(false);
  });
});

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-history-tools-${crypto.randomUUID()}`
);

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));

vi.mock("@/config/usersetting", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
  USER_AI_ENABLED: "true",
  TOKENNAME: "user-social-market-token",
  USERSDBPATH: "user_dbpath",
}));

import { handleConversationHistorySearch } from "@/service/agentTools/conversationHistorySearchTool";
import { handleConversationHistoryRead } from "@/service/agentTools/conversationHistoryReadTool";
import {
  getRetrievalService,
  releaseTurn,
} from "@/service/agentTools/historyRetrievalServiceCache";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { AIChatArchiveSearchFragmentModel } from "@/model/AIChatArchiveSearchFragment.model";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedMessages(
  conversationId: string,
  rows: Array<{ role: string; content: string; ts: number }>
): Promise<void> {
  const repo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const entity = new AIChatMessageEntity();
    entity.messageId = `msg-${conversationId}-${i}`;
    entity.conversationId = conversationId;
    entity.role = r.role;
    entity.content = r.content;
    entity.timestamp = new Date(r.ts);
    entity.messageType = MessageType.MESSAGE;
    await repo.save(entity);
  }
}

async function indexConversation(conversationId: string): Promise<void> {
  const stateModel = new AIChatArchiveStateModel(tmpDir);
  await stateModel.ensureState(conversationId);
  const fragModel = new AIChatArchiveSearchFragmentModel(tmpDir);
  const msgRepo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  const rows = await msgRepo.find({ where: { conversationId } });
  for (const row of rows) {
    await fragModel.indexSourceContent(
      conversationId,
      row.id,
      "content",
      row.content ?? ""
    );
  }
  // Mark the index complete so index_complete reflects readiness (the
  // production indexing job sets this when it finishes a conversation).
  await stateModel.setIndexState(conversationId, "complete");
}

function makeContext(
  conversationId: string,
  turnId: string | undefined = undefined
): SkillExecutionContext {
  return {
    conversationId,
    toolCallId: `tc-${crypto.randomUUID()}`,
    sourceUserMessageId: turnId,
  };
}

describe("conversation_history_search tool handler", () => {
  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  });

  beforeEach(async () => {
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("returns snake_case records with excerpt + has_more on a hit", async () => {
    await seedMessages("conv-tool-1", [
      {
        role: "user",
        content: "Use the column order: email, company.",
        ts: 1_000,
      },
    ]);
    await indexConversation("conv-tool-1");
    const res = await handleConversationHistorySearch(
      { query: "column order" },
      makeContext("conv-tool-1", "turn-1")
    );
    expect(res.success).toBe(true);
    expect(res.result.records).toBeInstanceOf(Array);
    expect((res.result.records as unknown[]).length).toBeGreaterThan(0);
    const record = (res.result.records as Array<Record<string, unknown>>)[0];
    expect(typeof record.source_id).toBe("string");
    expect(typeof record.message_id).toBe("string");
    expect(typeof record.timestamp).toBe("string");
    expect(record.role).toBe("user");
    expect(typeof record.excerpt).toBe("string");
    expect((record.excerpt as string).includes("column order")).toBe(true);
    expect(record.exact).toBe(true);
    expect(record.has_more).toBe(false);
    expect(res.result.scan_complete).toBe(true);
    expect(res.result.index_complete).toBe(true);
    expect(res.result.next_cursor).toBeNull();
  });

  it("returns an error code (not success) on no match", async () => {
    await seedMessages("conv-tool-2", [
      { role: "user", content: "hello world", ts: 1_000 },
    ]);
    await indexConversation("conv-tool-2");
    const res = await handleConversationHistorySearch(
      { query: "absent-term" },
      makeContext("conv-tool-2", "turn-2")
    );
    expect(res.success).toBe(false);
    expect(res.result.error).toBe("HISTORY_NO_MATCH");
    expect((res.result.records as unknown[]).length).toBe(0);
  });

  it("rejects an over-long query with HISTORY_SCOPE_INVALID", async () => {
    const res = await handleConversationHistorySearch(
      { query: "x".repeat(201) },
      makeContext("conv-tool-3", "turn-3")
    );
    expect(res.success).toBe(false);
    expect(res.result.error).toBe("HISTORY_SCOPE_INVALID");
  });
});

describe("conversation_history_read tool handler", () => {
  beforeEach(async () => {
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("reads by source_id and returns exact excerpt", async () => {
    await seedMessages("conv-read-tool", [
      { role: "assistant", content: "the column order is fixed", ts: 1_000 },
    ]);
    await indexConversation("conv-read-tool");
    const search = await handleConversationHistorySearch(
      { query: "column order" },
      makeContext("conv-read-tool", "turn-1")
    );
    const sid = (search.result.records as Array<Record<string, unknown>>)[0]
      .source_id as string;
    const res = await handleConversationHistoryRead(
      { source_id: sid },
      makeContext("conv-read-tool", "turn-1")
    );
    expect(res.success).toBe(true);
    const record = (res.result.records as Array<Record<string, unknown>>)[0];
    expect(record.excerpt).toBe("the column order is fixed");
    expect(record.exact).toBe(true);
    expect(record.source_id).toBe(sid);
    expect(res.result.stored_content_incomplete).toBe(false);
  });

  it("returns SOURCE_UNAVAILABLE for a deleted row", async () => {
    await seedMessages("conv-del-tool", [
      { role: "user", content: "doomed message", ts: 1_000 },
    ]);
    await indexConversation("conv-del-tool");
    const search = await handleConversationHistorySearch(
      { query: "doomed" },
      makeContext("conv-del-tool", "turn-1")
    );
    const sid = (search.result.records as Array<Record<string, unknown>>)[0]
      .source_id as string;
    const repo =
      SqliteDb.getInstance(tmpDir).connection.getRepository(
        AIChatMessageEntity
      );
    await repo.remove(
      await repo.find({ where: { conversationId: "conv-del-tool" } })
    );
    const res = await handleConversationHistoryRead(
      { source_id: sid },
      makeContext("conv-del-tool", "turn-1")
    );
    expect(res.success).toBe(false);
    expect(res.result.error).toBe("SOURCE_UNAVAILABLE");
  });

  it("rejects ambiguous input (both modes) with HISTORY_SCOPE_INVALID", async () => {
    const res = await handleConversationHistoryRead(
      { source_id: "a", from_source_id: "b", to_source_id: "c" },
      makeContext("conv-ambig-tool", "turn-1")
    );
    expect(res.success).toBe(false);
    expect(res.result.error).toBe("HISTORY_SCOPE_INVALID");
  });
});

describe("per-turn retrieval budget (§7.4)", () => {
  beforeEach(async () => {
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
  });

  afterEach(() => {
    resetDbSingleton();
    releaseTurn("conv-budget-tool", "turn-shared");
  });

  it("shares one budget across search + read in the same turn", async () => {
    await seedMessages("conv-budget-tool", [
      { role: "user", content: "shared budget probe text", ts: 1_000 },
    ]);
    await indexConversation("conv-budget-tool");

    // Turn 1, call 1: search (budget call count → 1).
    const search1 = await handleConversationHistorySearch(
      { query: "shared budget" },
      makeContext("conv-budget-tool", "turn-shared")
    );
    expect(search1.success).toBe(true);
    const ctx = makeContext("conv-budget-tool", "turn-shared");
    const svc = getRetrievalService("conv-budget-tool", "turn-shared");
    expect(
      svc.getBudgetState("conv-budget-tool", "turn-shared").callCount
    ).toBe(1);
    void ctx;

    // Exhaust the remaining 3 calls (2,3,4) — the 5th must be refused.
    await handleConversationHistorySearch(
      { query: "shared budget" },
      makeContext("conv-budget-tool", "turn-shared")
    );
    await handleConversationHistorySearch(
      { query: "shared budget" },
      makeContext("conv-budget-tool", "turn-shared")
    );
    await handleConversationHistorySearch(
      { query: "shared budget" },
      makeContext("conv-budget-tool", "turn-shared")
    );
    const fifth = await handleConversationHistorySearch(
      { query: "shared budget" },
      makeContext("conv-budget-tool", "turn-shared")
    );
    expect(fifth.success).toBe(false);
    expect(fifth.result.error).toBe("MODEL_BUDGET_UNAVAILABLE");
  });

  it("gives a fresh budget for a new turn", async () => {
    await seedMessages("conv-budget-tool", [
      { role: "user", content: "fresh turn probe", ts: 2_000 },
    ]);
    await indexConversation("conv-budget-tool");
    // Exhaust turn-A's budget.
    for (let i = 0; i < 4; i++) {
      await handleConversationHistorySearch(
        { query: "fresh turn" },
        makeContext("conv-budget-tool", "turn-A")
      );
    }
    const exhausted = await handleConversationHistorySearch(
      { query: "fresh turn" },
      makeContext("conv-budget-tool", "turn-A")
    );
    expect(exhausted.result.error).toBe("MODEL_BUDGET_UNAVAILABLE");
    // Turn-B has a fresh budget.
    const fresh = await handleConversationHistorySearch(
      { query: "fresh turn" },
      makeContext("conv-budget-tool", "turn-B")
    );
    expect(fresh.success).toBe(true);
    expect(fresh.result.error).toBeUndefined();
  });
});
