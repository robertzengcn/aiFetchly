import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Feature migration (review RV4 / audit R9 / design §14.1): the persisted
 * skill dependency bindings table — WHAT was detected for an installation
 * (kind, status, detected/required version, resolved path, provider, probe
 * evidence, last verification). Purely additive CREATE TABLE IF NOT EXISTS
 * guarded statements: synchronize-created dev databases already have the
 * table, and packaged builds (which run migrations instead of synchronize)
 * need this to create it — without it the R9 binding persistence and the
 * manager's dependency columns silently no-op in production.
 */
export class SkillDependencyBindings00041788400000000
  implements MigrationInterface
{
  name = "SkillDependencyBindings00041788400000000";

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
    const table = "skill_dependency_bindings";
    if (!(await this.hasTable(queryRunner, table))) {
      await queryRunner.query(
        `CREATE TABLE IF NOT EXISTS "${table}" (` +
          `"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, ` +
          `"installationId" varchar(64) NOT NULL, ` +
          `"dependencyName" varchar(100) NOT NULL, ` +
          `"kind" varchar(40) NOT NULL, ` +
          `"status" varchar(20) NOT NULL DEFAULT ('unknown'), ` +
          `"detectedVersion" varchar(40), ` +
          `"requiredVersion" varchar(40), ` +
          `"resolvedPath" varchar(500), ` +
          `"provider" varchar(200), ` +
          `"probeEvidence" text, ` +
          `"verifiedAt" datetime, ` +
          `"createdAt" datetime DEFAULT (CURRENT_TIMESTAMP), ` +
          `"updatedAt" datetime DEFAULT (CURRENT_TIMESTAMP))`
      );
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_skill_dep_binding" ON "${table}" ("installationId", "dependencyName")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_skill_dep_binding_installation" ON "${table}" ("installationId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_skill_dep_binding_installation"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_skill_dep_binding"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "skill_dependency_bindings"`);
  }
}
