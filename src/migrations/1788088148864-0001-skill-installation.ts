import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Feature migration (TODO 2 / design §14.3): the natural-language skill
 * installation tables.
 *
 * Hand-trimmed from `migration:generate` output — the generator also
 * emitted spurious full-table rebuilds for unrelated tables
 * (ai_chat_messages, tasks) caused by its SQLite CHECK-constraint
 * representation diff, not real schema changes. Only the five NEW tables
 * and their indexes belong here; every statement is idempotent so an
 * existing dev database (created via synchronize) is unaffected.
 */
export class SkillInstallation00011788088148864
  implements MigrationInterface
{
  name = "SkillInstallation00011788088148864";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "prompt_skill_invocations" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "conversationId" varchar(100) NOT NULL, "agentScope" varchar(100) NOT NULL DEFAULT (''), "runtimeId" varchar(300) NOT NULL, "contentHash" varchar(64) NOT NULL, "contextRevision" integer NOT NULL DEFAULT (1), "normalizedInstructions" text NOT NULL, "tokenEstimate" integer NOT NULL DEFAULT (0), "invocationArgumentsJson" text NOT NULL DEFAULT (''), "invocationSource" varchar(20) NOT NULL, "active" boolean NOT NULL DEFAULT (1), "invokedAt" datetime NOT NULL, "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime DEFAULT (CURRENT_TIMESTAMP))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_prompt_skill_inv_active" ON "prompt_skill_invocations" ("conversationId", "agentScope", "active") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_prompt_skill_inv_conv_agent" ON "prompt_skill_invocations" ("conversationId", "agentScope") `);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "skill_installations" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "installationId" varchar(64) NOT NULL, "name" varchar(300) NOT NULL, "kind" varchar(20) NOT NULL, "scope" varchar(20) NOT NULL DEFAULT ('user'), "workspaceId" integer NOT NULL DEFAULT (0), "sourceUri" varchar(1000) NOT NULL, "sourceRevision" varchar(128) NOT NULL, "sourceSubdirectory" varchar(500) NOT NULL DEFAULT (''), "activationMode" varchar(30) NOT NULL, "activationPath" varchar(1000) NOT NULL, "contentHash" varchar(64) NOT NULL, "status" varchar(30) NOT NULL DEFAULT ('requested'), "enabled" boolean NOT NULL DEFAULT (1), "metadataJson" text NOT NULL DEFAULT ('{}'), "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "UQ_89bc9c494402007b44264f9eb08" UNIQUE ("installationId"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_skill_inst_scope" ON "skill_installations" ("scope", "workspaceId") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_skill_inst_status" ON "skill_installations" ("status") `);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "skill_installation_sessions" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar(64) NOT NULL, "installationId" varchar(64), "conversationId" varchar(100) NOT NULL, "state" varchar(30) NOT NULL, "stateRevision" integer NOT NULL DEFAULT (0), "planRevision" varchar(64) NOT NULL, "planJson" text, "failureDetail" text, "failureCode" varchar(64), "retryCount" integer NOT NULL DEFAULT (0), "approved" boolean NOT NULL DEFAULT (0), "approvalToken" varchar(64), "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime DEFAULT (CURRENT_TIMESTAMP))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_skill_inst_sess_state" ON "skill_installation_sessions" ("state") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_skill_inst_sess_conv" ON "skill_installation_sessions" ("conversationId") `);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "skill_installation_events" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar(64) NOT NULL, "seq" integer NOT NULL, "eventType" varchar(60) NOT NULL, "fromState" varchar(30) NOT NULL, "toState" varchar(30) NOT NULL, "detail" text, "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime DEFAULT (CURRENT_TIMESTAMP))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_skill_inst_evt_session" ON "skill_installation_events" ("sessionId", "seq") `);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "skill_credential_bindings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "installationId" varchar(64) NOT NULL, "environmentVariable" varchar(100) NOT NULL, "bindingRef" varchar(200) NOT NULL, "status" varchar(20) NOT NULL DEFAULT ('configured'), "storedAt" datetime NOT NULL, "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime DEFAULT (CURRENT_TIMESTAMP))`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_prompt_skill_inv_identity" ON "prompt_skill_invocations" ("conversationId", "agentScope", "runtimeId", "contentHash")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_skill_inst_identity" ON "skill_installations" ("sourceUri", "sourceRevision", "sourceSubdirectory", "scope", "workspaceId", "activationMode")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_skill_inst_sess_id" ON "skill_installation_sessions" ("sessionId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_skill_cred_binding" ON "skill_credential_bindings" ("installationId", "environmentVariable")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "skill_credential_bindings"`);
    await queryRunner.query(`DROP TABLE "skill_installation_events"`);
    await queryRunner.query(`DROP TABLE "skill_installation_sessions"`);
    await queryRunner.query(`DROP TABLE "skill_installations"`);
    await queryRunner.query(`DROP TABLE "prompt_skill_invocations"`);
  }
}
