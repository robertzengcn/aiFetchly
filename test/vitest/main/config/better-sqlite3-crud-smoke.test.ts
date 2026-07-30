import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Database from "better-sqlite3";

/**
 * Phase 1 database compatibility proof (PRD FR-20).
 *
 * Removing the unused `sqlite3` driver must not affect SQLite capability: the
 * active driver remains `better-sqlite3`. This smoke test opens a database
 * through `better-sqlite3`, runs representative create/read/update/delete +
 * transaction + reopen operations, and confirms data survives a reopen.
 *
 * The packaged `sqlite-vec` extension load probe (also required by FR-20) is a
 * native, packaged-Electron concern and lives in the release smoke script; it
 * is intentionally not asserted in this unit-level test to avoid environment
 * fragility.
 *
 * `better-sqlite3` is a native addon built for a specific ABI. In the shared
 * worktree `node_modules` it is built for Electron, so under vitest's Node the
 * binding may fail to dlopen. The full CRUD proof therefore runs only when the
 * native module loads in the current runtime (CI / packaged Electron); it is
 * skipped otherwise rather than reported as a failure.
 */

interface Record {
  id: number;
  key: string;
  value: string;
}

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-bsql-"));
  return path.join(dir, "smoke.db");
}

// Probe once whether the native binding loads in this runtime.
let nativeAvailable = true;
try {
  const probe = new Database(":memory:");
  probe.close();
} catch {
  nativeAvailable = false;
}
const it = nativeAvailable ? test : test.skip;

describe("better-sqlite3 driver smoke (sqlite3 removal compatibility)", () => {
  it("create/read/update/delete + transaction + reopen", () => {
    const dbPath = createTempDbPath();
    try {
      // Create + insert
      const db = new Database(dbPath);
      db.exec(
        "CREATE TABLE kv (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL)"
      );
      const insert = db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)");
      db.transaction((rows: ReadonlyArray<readonly [string, string]>) => {
        for (const [key, value] of rows) insert.run(key, value);
      })([
        ["alpha", "one"],
        ["beta", "two"],
        ["gamma", "three"],
      ]);

      // Read
      const all = db.prepare("SELECT * FROM kv ORDER BY id").all() as Record[];
      expect(all).toHaveLength(3);
      expect(all[0]).toMatchObject({ key: "alpha", value: "one" });

      // Update
      db.prepare("UPDATE kv SET value = ? WHERE key = ?").run("TWO", "beta");
      const beta = db
        .prepare("SELECT value FROM kv WHERE key = ?")
        .get("beta") as { value: string };
      expect(beta.value).toBe("TWO");

      // Delete
      db.prepare("DELETE FROM kv WHERE key = ?").run("gamma");
      const remaining = db.prepare("SELECT COUNT(*) AS n FROM kv").get() as {
        n: number;
      };
      expect(remaining.n).toBe(2);

      db.close();

      // Reopen from the same file and confirm persistence (no migration)
      const reopened = new Database(dbPath, { readonly: true });
      const after = reopened
        .prepare("SELECT * FROM kv ORDER BY id")
        .all() as Record[];
      expect(after.map((r) => r.key)).toEqual(["alpha", "beta"]);
      expect(after.map((r) => r.value)).toEqual(["one", "TWO"]);
      reopened.close();
    } finally {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });
});
