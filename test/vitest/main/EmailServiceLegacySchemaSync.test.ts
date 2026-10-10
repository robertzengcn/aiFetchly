import { describe, expect, it, beforeEach } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import {
  snapshotLegacyServiceTags,
  replayLegacyServiceTags,
  dropLegacyServiceTagColumn,
} from "@/modules/migrations/emailServiceTagMigration";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";

const tmpDir = path.join(os.tmpdir(), "aifetchly-legacy-schema-sync");

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
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("Legacy schema synchronization (§6.5)", () => {
  it("backfills legacy tagId assignments into the junction table and drops the column", async () => {
    const dbPath = path.join(tmpDir, "scraper.db");

    // 1. Create a legacy database with the OLD single-tag shape: a tagId FK
    //    column on email_service plus the existing email_service_tag table.
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE email_service (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(255) NOT NULL,
        "from" VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        host VARCHAR(255) NOT NULL,
        port VARCHAR(10) NOT NULL,
        ssl INTEGER DEFAULT 1,
        status INTEGER DEFAULT 1,
        tagId INTEGER,
        FOREIGN KEY (tagId) REFERENCES email_service_tag (id)
      );
      CREATE TABLE email_service_tag (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(64) NOT NULL,
        normalizedName VARCHAR(64) NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    legacy
      .prepare(`INSERT INTO email_service_tag (name, normalizedName) VALUES (?, ?)`)
      .run("Sales", "sales");
    const tagId = Number(
      (legacy.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id
    );
    const insertService = legacy.prepare(
      `INSERT INTO email_service (name, "from", password, host, port, ssl, status, tagId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertService.run("Tagged", "tagged@example.com", "enc:legacy-password", "smtp.legacy.com", "465", 1, 1, tagId);
    const taggedServiceId = Number(
      (legacy.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id
    );
    insertService.run("Untagged", "untagged@example.com", "enc:legacy-password", "smtp.legacy.com", "465", 1, 1, null);
    legacy.close();

    // 2. Snapshot the legacy assignments BEFORE TypeORM initialize (exactly
    //    the background.ts startup order — synchronize drops the column).
    const rawDb = new Database(dbPath, { readonly: true });
    const snapshot = snapshotLegacyServiceTags(rawDb);
    rawDb.close();
    expect(snapshot).toEqual([{ id: taggedServiceId, tagId }]);

    // 3. Initialize the CURRENT SqliteDb data source (synchronize creates the
    //    junction table and drops the legacy tagId column), then replay the
    //    snapshot into the junction table and drop the column.
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const db = SqliteDb.getInstance(tmpDir).connection;
    const backfilled = await replayLegacyServiceTags(db, snapshot);
    // The drop step runs after the replay; its return is true only when it
    // removed the column itself (synchronize may have already done so). The
    // invariant asserted below is the column is gone either way.
    await dropLegacyServiceTagColumn(db);

    // 4. The backfill happened; the legacy tagId column is gone from the final
    //    schema (synchronize or the drop step removed it — the invariant is
    //    the column is gone either way).
    expect(backfilled).toBe(1);
    const reopened = new Database(dbPath, { readonly: true });
    const colNames = (reopened.prepare(`PRAGMA table_info(email_service)`).all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    expect(colNames).not.toContain("tagId");
    const relations = reopened
      .prepare(`SELECT emailServiceId, tagId FROM email_service_tag_relation`)
      .all() as Array<{ emailServiceId: number; tagId: number }>;
    reopened.close();

    // 5. Only the tagged service was backfilled; the untagged one is skipped.
    expect(relations).toEqual([{ emailServiceId: taggedServiceId, tagId }]);
    // 6. Re-running the migration is a no-op (idempotent).
    const rerunBackfilled = await replayLegacyServiceTags(db, snapshot);
    const rerunDropped = await dropLegacyServiceTagColumn(db);
    expect(rerunBackfilled).toBe(0);
    expect(rerunDropped).toBe(false);
  });

  it("adds nullable identity columns to a pre-feature database without losing data", async () => {
    const dbPath = path.join(tmpDir, "scraper.db");

    // 1. Create a pre-feature database with the OLD email_service shape
    //    (no smtpUsername / replyTo columns).
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE email_service (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(255) NOT NULL,
        "from" VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        host VARCHAR(255) NOT NULL,
        port VARCHAR(10) NOT NULL,
        ssl INTEGER DEFAULT 1,
        status INTEGER DEFAULT 1,
        receiveProtocol VARCHAR(10) DEFAULT 'imap',
        receiveFolder VARCHAR(255) DEFAULT 'INBOX',
        receiveEnabled INTEGER DEFAULT 0
      );
    `);
    const insert = legacy.prepare(
      `INSERT INTO email_service (name, "from", password, host, port, ssl, status, receiveProtocol, receiveEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      "Legacy SMTP",
      "legacy@example.com",
      "enc:legacy-password",
      "smtp.legacy.com",
      "465",
      1,
      1,
      "imap",
      0
    );
    const legacyId = Number(
      (
        legacy.prepare(`SELECT last_insert_rowid() AS id`).get() as {
          id: number;
        }
      ).id
    );
    legacy.close();

    // 2. Initialize the CURRENT SqliteDb data source (synchronize: true adds
    //    the nullable smtpUsername + replyTo columns).
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    // 3. Assert the new columns exist with NULL defaults.
    const reopened = new Database(dbPath, { readonly: true });
    const cols = reopened
      .prepare(`PRAGMA table_info(email_service)`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("smtpUsername");
    expect(colNames).toContain("replyTo");

    const row = reopened
      .prepare(
        `SELECT name, "from", password, host, port, ssl, status, smtpUsername, replyTo FROM email_service WHERE id = ?`
      )
      .get(legacyId) as {
      name: string;
      from: string;
      password: string;
      host: string;
      port: string;
      ssl: number;
      status: number;
      smtpUsername: string | null;
      replyTo: string | null;
    };

    // 4. Assert old values and identity are intact.
    expect(row.name).toBe("Legacy SMTP");
    expect(row.from).toBe("legacy@example.com");
    expect(row.password).toBe("enc:legacy-password");
    expect(row.host).toBe("smtp.legacy.com");
    expect(row.port).toBe("465");
    expect(row.ssl).toBe(1);
    expect(row.status).toBe(1);
    // 5. New columns are NULL for legacy rows (AD-002 — not eagerly backfilled).
    expect(row.smtpUsername).toBeNull();
    expect(row.replyTo).toBeNull();
    reopened.close();
  });
});
