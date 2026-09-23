import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Feature migration (requirements-audit 2026-09-22 finding 1 / FR-02 /
 * FR-29 / NFR-01): persist the full installation REQUEST identity at session
 * creation — requested revision, subdirectory, and activation mode — so
 * idempotent reuse and the transactional claim can compare them instead of
 * matching on the canonical URI alone (different ref/mode requests used to
 * receive a foreign session).
 *
 * Purely additive ALTER TABLE ADD COLUMN, each guarded by a pragma
 * table_info existence check (synchronize-created dev databases already
 * have the columns).
 */
export class SkillInstallationSessionRequestIdentity00031788326400000
  implements MigrationInterface
{
  name = "SkillInstallationSessionRequestIdentity00031788326400000";

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

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = "skill_installation_sessions";
    if (!(await this.hasColumn(queryRunner, table, "requestedRevision"))) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "requestedRevision" varchar(200)`
      );
    }
    if (!(await this.hasColumn(queryRunner, table, "requestedSubdirectory"))) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "requestedSubdirectory" varchar(300)`
      );
    }
    if (!(await this.hasColumn(queryRunner, table, "requestedMode"))) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "requestedMode" varchar(20)`
      );
    }
  }

  public async down(): Promise<void> {
    // Additive-only migration; SQLite column drops are destructive and the
    // columns carry no data not recoverable from the plan JSON.
  }
}
