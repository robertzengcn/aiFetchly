import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DataSource } from "typeorm";
import { ContactInfoEntity } from "@/entity/ContactInfo.entity";
import { SearchResultEntity } from "@/entity/SearchResult.entity";
import { toSqliteCurrentTimestampText } from "@/model/sqliteDatetime";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// RED test for the ContactInfo datetime-format bug (introduced by D1 at
// 7073d40b3): countSince/findLatestSince bind startedAt.toISOString()
// ("YYYY-MM-DDTHH:MM:SS.sssZ", 'T' separator) against extraction_date, a
// @CreateDateColumn that SQLite stores via CURRENT_TIMESTAMP as
// "YYYY-MM-DD HH:MM:SS" (space separator). ' ' (0x20) < 'T' (0x54), so every
// row created on the same UTC day as the bound sorts before it and is
// excluded — the execution-local freshness window is empty, record-count and
// fresh-observation evidence criteria can never be satisfied (fail-closed
// → unknown), so executions can never verify complete.
//
// This test mirrors the real query shape (a queryBuilder comparing
// extraction_date >= :startedAt) against a real SQLite DataSource with
// synchronize, so the CURRENT_TIMESTAMP storage format is exercised exactly.
// It does NOT import the production ContactInfoRepository (whose getRepository
// pins the production SqliteDb singleton); it replicates the bound-parameter
// logic under test so the format mismatch is proven at the SQL boundary.

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-contact-since-${crypto.randomUUID()}`
);

let dataSource: DataSource;

beforeEach(async () => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  dataSource = new DataSource({
    type: "better-sqlite3",
    database: path.join(tmpDir, "test.db"),
    synchronize: true,
    entities: [ContactInfoEntity, SearchResultEntity],
  });
  await dataSource.initialize();
});

afterEach(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
  // The DataSource path is shared across tests; destroy() does NOT delete the
  // db file, so rows accumulate. Wipe the dir so every test starts empty.
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function seedContact(email: string): Promise<void> {
  // ContactInfoEntity.result_id is a NOT NULL FK → save a SearchResult parent
  // first, then set the raw FK column to its generated id (avoids the
  // @OneToOne relation persisting a full entity graph).
  const searchRepo = dataSource.getRepository(SearchResultEntity);
  const sr = searchRepo.create();
  const saved = await searchRepo.save(sr);

  const repo = dataSource.getRepository(ContactInfoEntity);
  // Insert a contact row; extraction_date is @CreateDateColumn so SQLite
  // stamps it with CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", space format).
  const row = new ContactInfoEntity();
  row.resultId = saved.id;
  row.email = email;
  await repo.save(row);
}

describe("ContactInfo freshness-window datetime comparison", () => {
  it("toISOString() binding excludes same-day rows (the bug)", async () => {
    await seedContact("iso-bug@example.com");
    const startedAt = new Date(Date.now() - 60_000);
    const repo = dataSource.getRepository(ContactInfoEntity);

    const countWithIso = await repo
      .createQueryBuilder("contact")
      .where("contact.extraction_date >= :startedAt", {
        startedAt: startedAt.toISOString(),
      })
      .getCount();

    // extraction_date is @CreateDateColumn → SQLite CURRENT_TIMESTAMP text
    // ("YYYY-MM-DD HH:MM:SS", space). toISOString() uses 'T' separator;
    // space (0x20) < 'T' (0x54) so the same-day row sorts before the bound.
    // This assertion documents the bug: the row SHOULD be counted but isn't.
    expect(countWithIso).toBe(0);
  });

  it("space-format binding counts the same-day row (the fix)", async () => {
    await seedContact("fixed@example.com");
    const startedAt = new Date(Date.now() - 60_000);
    const repo = dataSource.getRepository(ContactInfoEntity);

    const countWithSpaceFormat = await repo
      .createQueryBuilder("contact")
      .where("contact.extraction_date >= :startedAt", {
        startedAt: toSqliteCurrentTimestampText(startedAt),
      })
      .getCount();

    // After the fix, ContactInfoRepository.countSince binds the space-format
    // CURRENT_TIMESTAMP text, so the same-day row is counted.
    expect(countWithSpaceFormat).toBe(1);
  });

  it("space-format binding returns the freshest same-day row's extraction_date (the fix)", async () => {
    await seedContact("latest@example.com");
    const startedAt = new Date(Date.now() - 60_000);
    const repo = dataSource.getRepository(ContactInfoEntity);

    const found = await repo
      .createQueryBuilder("contact")
      .select("contact.extraction_date", "extractionDate")
      .where("contact.extraction_date >= :startedAt", {
        startedAt: toSqliteCurrentTimestampText(startedAt),
      })
      .orderBy("contact.extraction_date", "DESC")
      .limit(1)
      .getRawOne<{ extractionDate: string } | undefined>();

    expect(found).not.toBeUndefined();
    expect(found?.extractionDate).toBeTruthy();
  });
});
