import type { MigrationInterface } from "typeorm";
import { PortableWorkspaceMemory1700000000000 } from "@/migrations/1700000000000-portable-workspace-memory";
import { Baseline00001788088086796 } from "../migrations/1788088086796-0000-baseline";
import { SkillInstallation00011788088148864 } from "../migrations/1788088148864-0001-skill-installation";
import { SkillInstallationSessionIdempotency00021788192000000 } from "../migrations/1788192000000-0002-skill-install-session-idempotency";
import { SkillInstallationSessionRequestIdentity00031788326400000 } from "../migrations/1788326400000-0003-skill-install-session-request-identity";
import { SkillDependencyBindings00041788400000000 } from "../migrations/1788400000000-0004-skill-dependency-bindings";

/**
 * Registered schema migrations — UNION of both branches. NOTE (2026-10-09
 * merge): dev's SqliteDb runs `synchronize: true` unconditionally, so this
 * chain is currently DORMANT. Our packaged-build migrations gate was
 * deliberately superseded: the 0000 baseline predates dev's newest entities
 * and cannot seed a packaged database alone. Regenerate the baseline from
 * the merged entity set before re-arming the gate.
 */
export const DB_MIGRATIONS: Array<new () => MigrationInterface> = [
  // Baseline FIRST: the portable-workspace migration ALTERs dev-side
  // tables the baseline creates (its guards are no-ops once they exist).
  Baseline00001788088086796,
  PortableWorkspaceMemory1700000000000,
  SkillInstallation00011788088148864,
  SkillInstallationSessionIdempotency00021788192000000,
  SkillInstallationSessionRequestIdentity00031788326400000,
  SkillDependencyBindings00041788400000000,
];
