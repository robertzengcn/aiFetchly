import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DataSource } from "typeorm";
import { ChatTitleLifecycle0005178848000000 } from "@/migrations/1788480000000-0005-chat-title-lifecycle";

/**
 * Titles audit R01: prove the registered CLI migration upgrades a REAL
 * pre-feature database — legacy names, user-set names, and empty titles are
 * preserved with safe lifecycle defaults, the pass is idempotent, and a
 * database without the table is a no-op. Desktop installs the columns via
 * synchronize (entity defaults equal these migration defaults).
 */
const tmpDir = path.join(os.tmpdir(), "aifetchly-chat-title-upgrade");

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  }
});

/** A pre-feature database: the OLD column set, no lifecycle columns. */
async function createPreFeatureDb(dbPath: string): Promise<DataSource> {
  const ds = new DataSource({
    type: "better-sqlite3",
    database: dbPath,
    synchronize: false,
    migrations: [],
    entities: [],
  });
  await ds.initialize();
  await ds.query(`
    CREATE TABLE ai_chat_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversationId varchar(100) NOT NULL,
      workspaceKey varchar(255),
      title varchar(200),
      titleIsUserSet boolean NOT NULL DEFAULT 0,
      preview varchar(300) NOT NULL DEFAULT '',
      messageCount int NOT NULL DEFAULT 0,
      lastMessageAt datetime,
      lastResultAt datetime,
      lastReadAt datetime,
      archivedAt datetime,
      createdAt datetime DEFAULT CURRENT_TIMESTAMP,
      updatedAt datetime DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await ds.query(
    `INSERT INTO ai_chat_conversations (conversationId, title, titleIsUserSet) VALUES
      ('v2-legacy', 'Legacy excerpt name', 0),
      ('v2-userset', 'My manual name', 1),
      ('v2-empty', NULL, 0)`
  );
  return ds;
}

describe("chat-titles pre-feature schema upgrade (R01)", () => {
  it("the migration preserves titles/ownership and installs safe defaults", async () => {
    const dbPath = path.join(tmpDir, "scraper.db");
    const ds = await createPreFeatureDb(dbPath);
    try {
      const migration = new ChatTitleLifecycle0005178848000000();
      await migration.up(ds.createQueryRunner());

      const rows = (await ds.query(
        `SELECT conversationId, title, titleIsUserSet, titleSource,
                titleRevision, titleEpoch, titleGenerationStatus,
                titleAttemptCount, titleRequestId, titleFailureCode
         FROM ai_chat_conversations ORDER BY conversationId`
      )) as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(3);
      const byId = new Map(rows.map((r) => [r.conversationId, r]));
      // Legacy excerpt: preserved, classified legacy/suppressed (no paid
      // naming on upgrade).
      expect(byId.get("v2-legacy")).toMatchObject({
        title: "Legacy excerpt name",
        titleIsUserSet: 0,
        titleSource: "legacy",
        titleRevision: 0,
        titleGenerationStatus: "suppressed",
        titleAttemptCount: 0,
        titleRequestId: null,
        titleFailureCode: null,
      });
      // User-set: preserved and still authoritative.
      expect(byId.get("v2-userset")).toMatchObject({
        title: "My manual name",
        titleIsUserSet: 1,
        titleSource: "legacy", // repaired to "user" by the startup pass
        titleGenerationStatus: "suppressed",
      });
      // Empty title: untouched, suppressed.
      expect(byId.get("v2-empty")).toMatchObject({
        title: null,
        titleSource: "legacy",
        titleGenerationStatus: "suppressed",
      });
    } finally {
      await ds.destroy();
    }
  });

  it("re-running the migration against an upgraded database is a no-op", async () => {
    const dbPath = path.join(tmpDir, "scraper.db");
    const ds = await createPreFeatureDb(dbPath);
    try {
      const migration = new ChatTitleLifecycle0005178848000000();
      await migration.up(ds.createQueryRunner());
      const before = (await ds.query(
        `SELECT conversationId, title, titleRevision FROM ai_chat_conversations ORDER BY conversationId`
      )) as Array<Record<string, unknown>>;
      await migration.up(ds.createQueryRunner()); // idempotent pass
      const after = (await ds.query(
        `SELECT conversationId, title, titleRevision FROM ai_chat_conversations ORDER BY conversationId`
      )) as Array<Record<string, unknown>>;
      expect(after).toEqual(before);
    } finally {
      await ds.destroy();
    }
  });

  it("R01: the DESKTOP synchronize path upgrades the same pre-feature database", async () => {
    const { SqliteDb } = await import("@/config/SqliteDb");
    const dbPath = path.join(tmpDir, "scraper.db");
    const pre = await createPreFeatureDb(dbPath);
    await pre.destroy();

    // Open with the REAL desktop configuration (DB_ENTITIES +
    // synchronize:true) — exactly what a packaged app runs on an old DB.
    process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
    (SqliteDb as unknown as { instance: unknown }).instance = null;
    (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
    (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const { AIChatConversationModel } = await import(
      "@/model/AIChatConversation.model"
    );
    const model = new AIChatConversationModel(tmpDir);
    const legacy = await model.getByConversationId("v2-legacy");
    const userset = await model.getByConversationId("v2-userset");
    const empty = await model.getByConversationId("v2-empty");

    // Titles and ownership preserved; safe lifecycle defaults installed —
    // identical to the CLI migration's outcome (equal defaults).
    expect(legacy).toMatchObject({
      title: "Legacy excerpt name",
      titleIsUserSet: false,
      titleSource: "legacy",
      titleGenerationStatus: "suppressed",
      titleAttemptCount: 0,
    });
    expect(userset).toMatchObject({
      title: "My manual name",
      titleIsUserSet: true,
      titleGenerationStatus: "suppressed",
    });
    expect(empty).toMatchObject({
      title: null,
      titleSource: "legacy",
      titleGenerationStatus: "suppressed",
    });

    // Startup repair promotes user-set rows to explicit user provenance.
    const repaired = await model.repairLegacyUserTitles();
    expect(repaired).toBe(1);
    const after = await model.getByConversationId("v2-userset");
    expect(after?.titleSource).toBe("user");

    // Zero model requests on reopen is structural: no dispatch path runs
    // during schema initialization (the title service is notification-driven).
    await SqliteDb.ensureInitialized();
  });

  it("a database without the conversation table is a guarded no-op", async () => {
    const dbPath = path.join(tmpDir, "scraper.db");
    const ds = new DataSource({
      type: "better-sqlite3",
      database: dbPath,
      synchronize: false,
      migrations: [],
      entities: [],
    });
    await ds.initialize();
    try {
      const migration = new ChatTitleLifecycle0005178848000000();
      await expect(migration.up(ds.createQueryRunner())).resolves.toBeUndefined();
    } finally {
      await ds.destroy();
    }
  });
});
