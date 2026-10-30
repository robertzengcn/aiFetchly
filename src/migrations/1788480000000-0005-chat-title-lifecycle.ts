import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Additive title-lifecycle columns for `ai_chat_conversations`
 * (docs/prd/ai-chat-automatic-titles-technical-design.md §4).
 *
 * Defaults deliberately classify pre-existing rows as legacy/suppressed so
 * upgrades never trigger paid AI naming work. Dev's SqliteDb uses
 * `synchronize: true` (chain dormant) — this migration covers the CLI-managed
 * path only. `down` is a deliberate additive-only no-op (0002/0004 convention).
 */
export class ChatTitleLifecycle0005178848000000 implements MigrationInterface {
  name = "ChatTitleLifecycle0005178848000000";

  private async hasColumn(
    queryRunner: QueryRunner,
    table: string,
    column: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = '${column}'`
    );
    return Number(rows?.[0]?.n ?? 0) > 0;
  }

  private async hasTable(
    queryRunner: QueryRunner,
    table: string
  ): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '${table}'`
    );
    return Number(rows?.[0]?.n ?? 0) > 0;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = "ai_chat_conversations";
    // The 0000 baseline predates this table (dev's SqliteDb creates it via
    // synchronize) — ALTERing a missing table would fail the whole chain.
    if (!(await this.hasTable(queryRunner, table))) {
      return;
    }
    const columns: Array<{ name: string; ddl: string }> = [
      { name: "titleSource", ddl: `varchar(16) NOT NULL DEFAULT 'legacy'` },
      { name: "titleRevision", ddl: `int NOT NULL DEFAULT 0` },
      { name: "titleEpoch", ddl: `int NOT NULL DEFAULT 0` },
      {
        name: "titleGenerationStatus",
        ddl: `varchar(16) NOT NULL DEFAULT 'suppressed'`,
      },
      { name: "titleAttemptCount", ddl: `int NOT NULL DEFAULT 0` },
      { name: "titleRequestId", ddl: `varchar(64)` },
      { name: "titleFailureCode", ddl: `varchar(32)` },
    ];
    for (const column of columns) {
      if (!(await this.hasColumn(queryRunner, table, column.name))) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ADD COLUMN "${column.name}" ${column.ddl}`
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Additive-only no-op (0002/0004 convention): dropping columns would
    // destroy user-visible titles.
    void queryRunner;
  }
}
