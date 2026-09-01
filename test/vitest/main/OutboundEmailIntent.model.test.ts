import { describe, expect, it, beforeEach } from "vitest";
import { OutboundEmailIntentModel } from "@/model/OutboundEmailIntent.model";
import { OutboundEmailIntentEntity } from "@/entity/OutboundEmailIntent.entity";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-intent-model");

function buildEntity(overrides: Partial<OutboundEmailIntentEntity> = {}): OutboundEmailIntentEntity {
  const e = new OutboundEmailIntentEntity();
  e.conversationId = "conv-1";
  e.sourceUserMessageId = "msg-1";
  e.mode = "send_now";
  e.reasonCode = "explicit_send_instruction";
  e.confidence = 1;
  e.evidenceJson = JSON.stringify([
    { start: 0, end: 4, normalizedPhrase: "send", category: "send" },
  ]);
  e.sourceTextHash = "a".repeat(64);
  e.resolverVersion = "outbound-resolver-v1";
  e.previousAssistantMessageId = null;
  return Object.assign(e, overrides);
}

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("OutboundEmailIntentModel", () => {
  it("creates and reads back an intent decision", async () => {
    const model = new OutboundEmailIntentModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const created = await model.create(buildEntity());
    expect(typeof created.id).toBe("number");
    expect(created.conversationId).toBe("conv-1");
    expect(created.mode).toBe("send_now");
    expect(created.confidence).toBe(1);

    const found = await model.read(created.id);
    expect(found).not.toBeNull();
    expect(found?.sourceUserMessageId).toBe("msg-1");
    expect(found?.reasonCode).toBe("explicit_send_instruction");
  });

  it("finds a decision by conversation + source message", async () => {
    const model = new OutboundEmailIntentModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await model.create(buildEntity({ sourceUserMessageId: "msg-42" }));
    const found = await model.findBySource("conv-1", "msg-42");
    expect(found).not.toBeNull();
    expect(found?.sourceUserMessageId).toBe("msg-42");
    expect(found?.mode).toBe("send_now");

    const missing = await model.findBySource("conv-1", "nope");
    expect(missing).toBeNull();
  });

  it("enforces unique (conversationId, sourceUserMessageId)", async () => {
    const model = new OutboundEmailIntentModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await model.create(buildEntity({ sourceUserMessageId: "dup" }));
    await expect(
      model.create(buildEntity({ sourceUserMessageId: "dup" }))
    ).rejects.toThrow();
  });

  it("rejects invalid confidence via the write schema", async () => {
    const model = new OutboundEmailIntentModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await expect(
      model.create(buildEntity({ sourceUserMessageId: "bad", confidence: 1.5 }))
    ).rejects.toThrow();
  });
});
