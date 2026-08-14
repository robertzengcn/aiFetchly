/**
 * Fail-closed environment contract for the Electron E2E bootstrap.
 *
 * The bootstrap (E2EMain.ts) loads and validates this BEFORE importing
 * background.ts, so an invalid or unsafe configuration terminates the app
 * before any production code runs (design §6.3, §9).
 *
 * This module is intentionally free of `electron` imports (only Node builtins)
 * so it can be unit-tested in Vitest without the Electron mock.
 *
 * Validation rules (design §6.3):
 *   - AIFETCHLY_E2E must equal "1" exactly.
 *   - AIFETCHLY_E2E_ROOT must be absolute, must live under an `aifetchly-e2e`
 *     run root, and must not be the home dir, the project dir, or a filesystem
 *     root.
 *   - Every derived filesystem path must be contained by AIFETCHLY_E2E_ROOT.
 *   - AI and renderer URLs, when supplied, must use http and a loopback host.
 *   - Allowed origins, when supplied, must each be http loopback origins.
 *   - The state manifest (state.json), when it exists, must contain only known
 *     keys; unknown keys are rejected.
 *
 * Invalid configuration throws synchronously — E2EMain lets that propagate so
 * the process exits before the production window/IPC graph initializes.
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";

/** The shared run-root segment that every E2E temp root must live under. */
export const E2E_RUN_ROOT_SEGMENT = "aifetchly-e2e";

/** Loopback hostnames permitted for AI/renderer URLs and allowed origins. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface E2EEnvironment {
  readonly rootPath: string;
  readonly userDataPath: string;
  readonly databasePath: string;
  readonly workspacePath: string;
  readonly downloadsPath: string;
  readonly logsPath: string;
  readonly fakeAiBaseUrl: string | null;
  readonly allowedOrigins: readonly string[];
  readonly stateFilePath: string | null;
}

/**
 * Redacted view of the parsed `state.json`, written by the Playwright fixture
 * (design §8.2). Only the keys enumerated here are accepted; anything else is a
 * rejection so a stale or hostile manifest can never silently drive the app.
 */
export interface E2EStateManifest {
  readonly schemaVersion: 1;
  readonly authState: "authenticated" | "unauthenticated";
  readonly aiState: "hosted-disabled" | "local-enabled";
  readonly locale: "en";
  readonly fakeAiBaseUrl: string;
  readonly workspacePath: string;
  readonly dialogResponses?: Readonly<
    Record<string, E2EDialogResponse>
  >;
}

export interface E2EDialogResponse {
  readonly action: "canceled" | "confirmed";
  readonly paths?: readonly string[];
}

const ALLOWED_MANIFEST_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "authState",
  "aiState",
  "locale",
  "fakeAiBaseUrl",
  "workspacePath",
  "dialogResponses",
]);

export class E2EEnvironmentError extends Error {
  constructor(message: string) {
    super(`[E2E environment] ${message}`);
    this.name = "E2EEnvironmentError";
  }
}

function isAbsolute(p: string): boolean {
  return path.isAbsolute(p);
}

/**
 * True iff `child` is contained by `parent` after resolving symlinks/`.`/`..`.
 * Neither path is required to exist on disk.
 */
export function isContainedBy(parent: string, child: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (resolvedChild === resolvedParent) return true;
  const relative = path.relative(resolvedParent, resolvedChild);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertContained(root: string, p: string, label: string): void {
  if (!isAbsolute(p)) {
    throw new E2EEnvironmentError(`${label} must be an absolute path: ${p}`);
  }
  if (!isContainedBy(root, p)) {
    throw new E2EEnvironmentError(
      `${label} must be contained by the E2E root: ${p}`
    );
  }
}

function isLoopbackUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  return LOOPBACK_HOSTS.has(parsed.hostname);
}

function assertRootSafe(root: string): void {
  if (!isAbsolute(root)) {
    throw new E2EEnvironmentError(`root must be absolute: ${root}`);
  }
  const resolved = path.resolve(root);

  const home = os.homedir();
  if (resolved === path.resolve(home)) {
    throw new E2EEnvironmentError("root must not be the user home directory");
  }
  if (resolved === path.resolve(process.cwd())) {
    throw new E2EEnvironmentError(
      "root must not be the project working directory"
    );
  }
  const parent = path.dirname(resolved);
  if (parent === resolved || path.dirname(parent) === parent) {
    throw new E2EEnvironmentError(
      "root must not be a filesystem root directory"
    );
  }
  // The root must live under the shared aifetchly-e2e run tree so a misconfigured
  // path can never target an arbitrary directory.
  const segments = resolved.split(path.sep);
  if (!segments.includes(E2E_RUN_ROOT_SEGMENT)) {
    throw new E2EEnvironmentError(
      `root must live under the "${E2E_RUN_ROOT_SEGMENT}" run tree: ${resolved}`
    );
  }
}

/**
 * Validate and load the E2E environment from a process-env-like map. Accepts
 * `NodeJS.ProcessEnv` directly. Throws E2EEnvironmentError on any violation.
 */
export function loadE2EEnvironment(
  env: NodeJS.ProcessEnv
): E2EEnvironment {
  if (env.AIFETCHLY_E2E !== "1") {
    throw new E2EEnvironmentError(
      'AIFETCHLY_E2E must equal "1" exactly to enable the test bootstrap'
    );
  }

  const rootPath = env.AIFETCHLY_E2E_ROOT;
  if (!rootPath) {
    throw new E2EEnvironmentError("AIFETCHLY_E2E_ROOT is required");
  }
  assertRootSafe(rootPath);

  const userDataPath = path.join(rootPath, "user-data");
  const databasePath = path.join(rootPath, "database");
  const workspacePath = path.join(rootPath, "workspace");
  const downloadsPath = path.join(rootPath, "downloads");
  const logsPath = path.join(rootPath, "logs");
  for (const [label, p] of [
    ["userDataPath", userDataPath],
    ["databasePath", databasePath],
    ["workspacePath", workspacePath],
    ["downloadsPath", downloadsPath],
    ["logsPath", logsPath],
  ] as const) {
    assertContained(rootPath, p, label);
  }

  // Optional validated inputs.
  let stateFilePath: string | null = null;
  const rawStateFile = env.AIFETCHLY_E2E_STATE_FILE;
  if (rawStateFile) {
    assertContained(rootPath, rawStateFile, "AIFETCHLY_E2E_STATE_FILE");
    stateFilePath = path.resolve(rawStateFile);
  }

  let fakeAiBaseUrl: string | null = null;
  const rawAiBaseUrl = env.AIFETCHLY_E2E_AI_BASE_URL;
  if (rawAiBaseUrl) {
    if (!isLoopbackUrl(rawAiBaseUrl)) {
      throw new E2EEnvironmentError(
        "AIFETCHLY_E2E_AI_BASE_URL must be an http loopback URL"
      );
    }
    fakeAiBaseUrl = rawAiBaseUrl;
  }

  const allowedOrigins: string[] = [];
  const rawOrigins = env.AIFETCHLY_E2E_ALLOWED_ORIGINS;
  if (rawOrigins) {
    for (const raw of rawOrigins.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!isLoopbackUrl(raw)) {
        throw new E2EEnvironmentError(
          `AIFETCHLY_E2E_ALLOWED_ORIGINS entry must be an http loopback origin: ${raw}`
        );
      }
      allowedOrigins.push(raw);
    }
  }

  // Validate the state manifest on disk if present (design §6.3: unknown keys
  // are rejected). The seeder (Step 2+) consumes the parsed manifest.
  if (stateFilePath && fs.existsSync(stateFilePath)) {
    parseStateManifest(stateFilePath);
  }

  return {
    rootPath: path.resolve(rootPath),
    userDataPath,
    databasePath,
    workspacePath,
    downloadsPath,
    logsPath,
    fakeAiBaseUrl,
    allowedOrigins,
    stateFilePath,
  };
}

/**
 * Read and validate state.json. Returns the parsed manifest. Throws on unknown
 * keys, wrong schema version, or invalid enum values. Exported for the seeder
 * and for unit tests.
 */
export function parseStateManifest(stateFilePath: string): E2EStateManifest {
  let raw: string;
  try {
    raw = fs.readFileSync(stateFilePath, "utf8");
  } catch (err) {
    throw new E2EEnvironmentError(
      `failed to read state manifest: ${(err as Error).message}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new E2EEnvironmentError(
      `state manifest is not valid JSON: ${(err as Error).message}`
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new E2EEnvironmentError("state manifest must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_MANIFEST_KEYS.has(key)) {
      throw new E2EEnvironmentError(
        `state manifest contains unknown key "${key}"`
      );
    }
  }
  if (obj.schemaVersion !== 1) {
    throw new E2EEnvironmentError(
      `state manifest schemaVersion must be 1 (got ${String(obj.schemaVersion)})`
    );
  }
  if (obj.authState !== "authenticated" && obj.authState !== "unauthenticated") {
    throw new E2EEnvironmentError("state manifest authState is invalid");
  }
  if (obj.aiState !== "hosted-disabled" && obj.aiState !== "local-enabled") {
    throw new E2EEnvironmentError("state manifest aiState is invalid");
  }
  if (obj.locale !== "en") {
    throw new E2EEnvironmentError(
      `state manifest locale must be "en" (got ${String(obj.locale)})`
    );
  }
  if (typeof obj.fakeAiBaseUrl !== "string" || !isLoopbackUrl(obj.fakeAiBaseUrl)) {
    throw new E2EEnvironmentError(
      "state manifest fakeAiBaseUrl must be an http loopback URL"
    );
  }
  if (typeof obj.workspacePath !== "string") {
    throw new E2EEnvironmentError("state manifest workspacePath must be a string");
  }
  return obj as unknown as E2EStateManifest;
}
