/**
 * Unit tests for AIChatArchiveAppendCoupler (technical-design §5.1 line 149 +
 * §15.6 tail replay): live-append coupling between the V2 message save path
 * and the archive index.
 *
 * Covers:
 *   - Flag-gated: no-op when the archive-reads flag is off (fail-closed).
 *   - ensureState: mints the archive state row on first append.
 *   - markStale: a previously-complete index is marked stale on new append.
 *   - catch-up: the fire-and-forget runToCompletion indexes the appended tail.
 *   - never throws: a storage hiccup returns a no-op, not a rejection.
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
  `aifetchly-archive-coupler-${crypto.randomUUID()}`
);

// Shared flag store; reset between tests so flag state never leaks across
// cases (the mock factory closure captures this object once).
const flagStore: Record<string, string> = {};

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      if (name === "user_dbpath") return tmpDir;
      return flagStore[name] ?? "";
    }
    setValue(name: string, value: string) {
      flagStore[name] = value;
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

import { AIChatArchiveAppendCoupler } from "@/service/AIChatArchiveAppendCoupler";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { AI_CHAT_RECOVERABLE_FLAGS } from "@/service/AIChatRecoverableDefaults";

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedMessage(
  conversationId: string,
  role: string,
  content: string,
  ts: number
): Promise<void> {
  const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
    AIChatMessageEntity
  );
  const entity = new AIChatMessageEntity();
  entity.messageId = `msg-${conversationId}-${ts}`;
  entity.conversationId = conversationId;
  entity.role = role;
  entity.content = content;
  entity.timestamp = new Date(ts);
  await repo.save(entity);
}

/**
 * The coupler's runToCompletion is fire-and-forget (void'd), so a test cannot
 * await it directly. Poll the state row until the index reaches "complete";
 * the catch-up for a handful of rows completes within milliseconds.
 */
async function waitForIndexComplete(
  stateModel: AIChatArchiveStateModel,
  conversationId: string,
  timeoutMs = 2000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await stateModel.getState(conversationId);
    if (state?.indexState === "complete") return;
    await new Promise((r) => setTimeout(r, 10));
  }
  const state = await stateModel.getState(conversationId);
  throw new Error(
    `index did not reach complete within ${timeoutMs}ms (last: ${
      state?.indexState ?? "null"
    })`
  );
}

beforeAll(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
});

beforeEach(() => {
  for (const key of Object.keys(flagStore)) delete flagStore[key];
  resetDbSingleton();
  SqliteDb.getInstance(tmpDir);
});

afterEach(() => {
  resetDbSingleton();
});

describe("AIChatArchiveAppendCoupler — flag gating", () => {
  it("returns a no-op when the archive-reads flag is off", async () => {
    await SqliteDb.ensureInitialized();
    const conv = "v2-coupler-gated";
    await seedMessage(conv, "user", "hello", 1_000);

    const result = await new AIChatArchiveAppendCoupler().coupleAppend(conv);

    expect(result.coupled).toBe(false);
    expect(result.indexState).toBe("absent");
    // No state row was minted (ensureState was never called).
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    expect(await stateModel.getState(conv)).toBeNull();
  });
});

describe("AIChatArchiveAppendCoupler — live append coupling", () => {
  it("mints the archive state + indexes the appended tail", async () => {
    await SqliteDb.ensureInitialized();
    flagStore[AI_CHAT_RECOVERABLE_FLAGS.archiveReads] = "true";

    const conv = "v2-coupler-append";
    await seedMessage(conv, "user", "the exact wording to find", 1_000);
    await seedMessage(conv, "assistant", "a reply", 2_000);

    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const result = await new AIChatArchiveAppendCoupler().coupleAppend(conv);

    expect(result.coupled).toBe(true);
    // ensureState is awaited before the fire-and-forget catch-up, so the row
    // exists immediately. The returned indexState is the pre-catch-up value
    // ("absent" on first mint).
    expect(result.indexState).toBe("absent");
    expect(await stateModel.getState(conv)).not.toBeNull();

    // The fire-and-forget catch-up reaches complete.
    await waitForIndexComplete(stateModel, conv);
    const state = await stateModel.getState(conv);
    expect(state?.indexState).toBe("complete");
    // One complete turn (user@1000 + assistant@2000) → high-water at 2000.
    expect(state?.highWaterTimestampMs).toBe(2_000);
  });

  it("marks a previously-complete index stale on a new append", async () => {
    await SqliteDb.ensureInitialized();
    flagStore[AI_CHAT_RECOVERABLE_FLAGS.archiveReads] = "true";

    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const conv = "v2-coupler-stale";
    await seedMessage(conv, "user", "first turn", 1_000);
    await seedMessage(conv, "assistant", "first reply", 2_000);

    // First couple: index → complete.
    await new AIChatArchiveAppendCoupler().coupleAppend(conv);
    await waitForIndexComplete(stateModel, conv);
    expect((await stateModel.getState(conv))?.indexState).toBe("complete");

    // Append a new tail.
    await seedMessage(conv, "user", "second turn", 3_000);
    await seedMessage(conv, "assistant", "second reply", 4_000);
    const result = await new AIChatArchiveAppendCoupler().coupleAppend(conv);

    expect(result.coupled).toBe(true);
    // The returned indexState is the pre-markStale value ("complete").
    expect(result.indexState).toBe("complete");

    // The coupler marked the complete index stale, then caught up → complete.
    await waitForIndexComplete(stateModel, conv);
    const finalState = await stateModel.getState(conv);
    expect(finalState?.indexState).toBe("complete");
    // Two complete turns → high-water at end of second (4000).
    expect(finalState?.highWaterTimestampMs).toBe(4_000);
  });
});

describe("AIChatArchiveAppendCoupler — failure isolation", () => {
  it("never throws when ensureState fails (storage hiccup)", async () => {
    await SqliteDb.ensureInitialized();
    flagStore[AI_CHAT_RECOVERABLE_FLAGS.archiveReads] = "true";

    const spy = vi
      .spyOn(AIChatArchiveStateModel.prototype, "ensureState")
      .mockRejectedValue(new Error("simulated storage failure"));

    const conv = "v2-coupler-fail";
    const result = await new AIChatArchiveAppendCoupler().coupleAppend(conv);

    expect(result.coupled).toBe(false);
    expect(result.indexState).toBe("absent");

    spy.mockRestore();
  });
});
