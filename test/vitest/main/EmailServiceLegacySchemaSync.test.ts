import { describe, expect, it, beforeEach } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
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
