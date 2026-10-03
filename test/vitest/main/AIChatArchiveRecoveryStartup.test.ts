/**
 * Unit tests for AIChatArchiveRecoveryStartup (technical-design §15.5 + §18):
 * idempotent, non-blocking startup recovery for the archive index.
 *
 * Covers:
 *   - Flag-gated: a no-op result when the archive-reads flag is off.
 *   - Idempotent: a complete index yields zero rows on a second sweep.
 *   - Resume: an incomplete index (indexing/stale) is completed on sweep.
 *   - Tail replay: new messages appended after a prior sweep are indexed.
 *   - Per-conversation failure isolation: one bad conversation does not abort
 *     the sweep for the rest.
 *
 * Token/USERSDBPATH are mocked so every Model/Module constructed in this file
 * shares one per-run test database (established pattern).
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

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-archive-recovery-${crypto.randomUUID()}`
);

// The archive-reads flag defaults OFF (fail-closed). Tests that need it ON
// flip this mock value to "true" via mockReturnValue.
vi.mock("@/modules/token", () => {
  const store: Record<string, string> = {};
  return {
    Token: class {
      getValue(name: string) {
        if (name === "user_dbpath") return tmpDir;
        return store[name] ?? "";
      }
      setValue(name: string, value: string) {
        store[name] = value;
      }
    },
  };
});

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

import { AIChatArchiveRecoveryStartup } from "@/service/AIChatArchiveRecoveryStartup";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatArchiveIndexer } from "@/service/AIChatArchiveIndexer";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { isArchiveReadsEnabled } from "@/config/featureFlags";

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedMessages(
  conversationId: string,
  rows: { role: string; content: string; ts: number }[]
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
    await repo.save(entity);
  }
}

beforeAll(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
});

beforeEach(() => {
  resetDbSingleton();
  SqliteDb.getInstance(tmpDir);
});

afterEach(() => {
  resetDbSingleton();
});

describe("AIChatArchiveRecoveryStartup — flag gating", () => {
  it("returns a no-op when the archive-reads flag is off", async () => {
    await SqliteDb.ensureInitialized();
    // Flag defaults OFF via the mock (getValue returns "" for flag keys).
    expect(isArchiveReadsEnabled()).toBe(false);

    const startup = new AIChatArchiveRecoveryStartup();
    const result = await startup.runRecoverySweep();

    expect(result.flagEnabled).toBe(false);
    expect(result.conversationsScanned).toBe(0);
    expect(result.rowsProjected).toBe(0);
  });
});

describe("AIChatArchiveRecoveryStartup — idempotent resume", () => {
  it("completes an incomplete index and is a no-op on the second sweep", async () => {
    await SqliteDb.ensureInitialized();
    // Enable the flag for this test.
    const { Token } = (await import("@/modules/token")) as {
      Token: new () => { setValue: (n: string, v: string) => void };
    };
    new Token().setValue("ai_chat_archive_reads_flag", "true");
    expect(isArchiveReadsEnabled()).toBe(true);

    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const conv = "v2-recovery-idem";
    await stateModel.ensureState(conv);
    await seedMessages(conv, [
      { role: "user", content: "a", ts: 1_000 },
      { role: "assistant", content: "b", ts: 2_000 },
    ]);

    // Pre-seed a partial index so the state is "indexing" (incomplete).
    const indexer = new AIChatArchiveIndexer();
    await indexer.runBatch(conv, { batchRows: 1 });

    const startup = new AIChatArchiveRecoveryStartup();
    const first = await startup.runRecoverySweep();
    expect(first.conversationsScanned).toBe(1);
    expect(first.rowsProjected).toBeGreaterThan(0);
    expect(first.conversationsCompleted).toBe(1);

    const state = await stateModel.getState(conv);
    expect(state?.indexState).toBe("complete");

    // Second sweep: the index is complete, listIncomplete returns nothing.
    const second = await startup.runRecoverySweep();
    expect(second.conversationsScanned).toBe(0);
    expect(second.rowsProjected).toBe(0);
  });

  it("replays the appended tail after a prior sweep", async () => {
    await SqliteDb.ensureInitialized();
    const { Token } = (await import("@/modules/token")) as {
      Token: new () => { setValue: (n: string, v: string) => void };
    };
    new Token().setValue("ai_chat_archive_reads_flag", "true");

    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const conv = "v2-recovery-tail";
    await stateModel.ensureState(conv);
    await seedMessages(conv, [
      { role: "user", content: "m1", ts: 1_000 },
      { role: "assistant", content: "m2", ts: 2_000 },
    ]);

    const startup = new AIChatArchiveRecoveryStartup();
    await startup.runRecoverySweep();
    expect((await stateModel.getState(conv))?.indexState).toBe("complete");

    // Append a new tail (ordinary append while the index was complete).
    await seedMessages(conv, [
      { role: "user", content: "m3", ts: 3_000 },
      { role: "assistant", content: "m4", ts: 4_000 },
    ]);

    // The complete index now has rows above the cursor: the next sweep must
    // detect them as a stale/incomplete tail and replay.
    // (The indexer marks a complete index stale-on-append via markStale in
    // production; here we simulate that by setting indexState to "stale".)
    await new AIChatArchiveIndexer().markStale(conv);

    const result = await startup.runRecoverySweep();
    expect(result.rowsProjected).toBeGreaterThan(0);
    expect(result.conversationsCompleted).toBe(1);

    const state = await stateModel.getState(conv);
    expect(state?.indexState).toBe("complete");
    expect(state?.highWaterTimestampMs).toBe(4_000);
  });
});

describe("AIChatArchiveRecoveryStartup — failure isolation", () => {
  it("continues the sweep when one conversation's backfill throws", async () => {
    await SqliteDb.ensureInitialized();
    const { Token } = (await import("@/modules/token")) as {
      Token: new () => { setValue: (n: string, v: string) => void };
    };
    new Token().setValue("ai_chat_archive_reads_flag", "true");

    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const convGood = "v2-recovery-good";
    const convBad = "v2-recovery-bad";
    await stateModel.ensureState(convGood);
    await stateModel.ensureState(convBad);
    await seedMessages(convGood, [
      { role: "user", content: "g1", ts: 1_000 },
      { role: "assistant", content: "g2", ts: 2_000 },
    ]);
    await seedMessages(convBad, [{ role: "user", content: "b1", ts: 1_000 }]);

    // Stub the indexer's runToCompletion to throw only for convBad. Capture
    // the original implementation so convGood still goes through the real
    // backfill (avoids infinite recursion).
    const startup = new AIChatArchiveRecoveryStartup();
    const realIndexer = (
      startup as unknown as { indexer: AIChatArchiveIndexer }
    ).indexer;
    const realRun = realIndexer.runToCompletion.bind(realIndexer);
    const spy = vi
      .spyOn(realIndexer, "runToCompletion")
      .mockImplementation((conversationId: string) => {
        if (conversationId === convBad) {
          return Promise.reject(new Error("simulated backfill failure"));
        }
        return realRun(conversationId);
      });

    const result = await startup.runRecoverySweep();
    // convGood was indexed; convBad threw but did not abort the sweep.
    expect(result.conversationsScanned).toBe(2);
    expect(result.rowsProjected).toBeGreaterThan(0);
    expect(result.conversationsCompleted).toBe(1);

    const goodState = await stateModel.getState(convGood);
    expect(goodState?.indexState).toBe("complete");

    spy.mockRestore();
  });
});
