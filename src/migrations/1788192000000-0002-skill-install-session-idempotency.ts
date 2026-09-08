import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Feature migration (PRD-gap T5 / FR-02/FR-20/NFR-01): session idempotency
 * columns — canonical source identity persisted at creation, the mutation
 * lease (owner + absolute expiry), and the normalized same-cause failure
 * streak.
 *
 * Purely additive (ALTER TABLE ADD COLUMN + one index); SQLite has no
 * ADD COLUMN IF NOT EXISTS, so each column is guarded by a pragma
 * table_info existence check — a dev database created via synchronize
 * (which already has the columns) is unaffected.
 */
export class SkillInstallationSessionIdempotency00021788192000000
  implements MigrationInterface
{
  name = "SkillInstallationSessionIdempotency00021788192000000";

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
    if (!(await this.hasColumn(queryRunner, "skill_installation_sessions", "canonicalUri"))) {
      await queryRunner.query(
        `ALTER TABLE "skill_installation_sessions" ADD COLUMN "canonicalUri" varchar(500)`
      );
    }
    if (!(await this.hasColumn(queryRunner, "skill_installation_sessions", "leaseOwner"))) {
      await queryRunner.query(
        `ALTER TABLE "skill_installation_sessions" ADD COLUMN "leaseOwner" varchar(64)`
      );
    }
    if (!(await this.hasColumn(queryRunner, "skill_installation_sessions", "leaseExpiresAt"))) {
      await queryRunner.query(
        `ALTER TABLE "skill_installation_sessions" ADD COLUMN "leaseExpiresAt" bigint`
      );
    }
    if (!(await this.hasColumn(queryRunner, "skill_installation_sessions", "lastFailureCause"))) {
      await queryRunner.query(
        `ALTER TABLE "skill_installation_sessions" ADD COLUMN "lastFailureCause" varchar(64)`
      );
    }
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_skill_inst_sess_canonical" ON "skill_installation_sessions" ("canonicalUri")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_skill_inst_sess_canonical"`
    );
    // SQLite cannot DROP COLUMN before 3.35; leaving the additive columns in
    // place on down is the documented trade-off for this guard migration.
  }
}
