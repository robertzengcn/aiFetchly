/**
 * Test-layer types for the Playwright Electron E2E suite.
 *
 * Deliberately decoupled from `src/` so the Playwright test compiler (esbuild,
 * no vite `@/` alias) never pulls main-process code — and therefore never the
 * `electron` package — into the test bundle. Runtime constants that must match
 * the bootstrap (src/main-process/e2e/E2EEnvironment.ts) are duplicated as
 * literals here and kept in sync.
 */

/** E2E bootstrap env-var names (mirror src/main-process/e2e/E2EEnvironment.ts). */
export const E2E_ENV = {
  ENABLED: "AIFETCHLY_E2E",
  ROOT: "AIFETCHLY_E2E_ROOT",
  STATE_FILE: "AIFETCHLY_E2E_STATE_FILE",
  AI_BASE_URL: "AIFETCHLY_E2E_AI_BASE_URL",
  ALLOWED_ORIGINS: "AIFETCHLY_E2E_ALLOWED_ORIGINS",
  USER_DATA_PATH: "ELECTRON_USER_DATA_PATH",
  IS_TEST: "IS_TEST",
  NODE_ENV: "NODE_ENV",
  // Skill-installation isolation overrides (natural-language-skill-installation):
  // redirect ~/.aifetchly + staging into the per-run temp root and enable the
  // installer so E2E never touches real user config or installed skills.
  SKILL_INSTALL_ENABLED: "AIFETCHLY_SKILL_INSTALL_ENABLED",
  CONFIG_HOME: "AIFETCHLY_CONFIG_HOME",
  SKILL_STAGING_ROOT: "AIFETCHLY_SKILL_STAGING_ROOT",
  SKILL_CREDENTIAL_STORE: "AIFETCHLY_SKILL_CREDENTIAL_STORE",
} as const;

/** Shared run-root segment the bootstrap requires (mirror E2EEnvironment.ts). */
export const E2E_RUN_ROOT_SEGMENT = "aifetchly-e2e";

/** A unique, containment-validated temporary root for one Electron instance. */
export interface E2ETestRoot {
  readonly rootPath: string;
  readonly userDataPath: string;
  readonly databasePath: string;
  readonly workspacePath: string;
  readonly downloadsPath: string;
  readonly logsPath: string;
  readonly stateFilePath: string;
  readonly networkViolationsPath: string;
  /** Recursively remove the root only after containment validation passes. */
  remove(): void;
}

/** Origin allowed for renderer network traffic (the Vite dev server). */
export const RENDERER_ORIGIN = "http://127.0.0.1:5173";
