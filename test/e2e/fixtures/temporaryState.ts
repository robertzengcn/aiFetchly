/**
 * Per-test temporary-root lifecycle (design §8.1).
 *
 * Each Electron instance gets a unique root under
 *   ${os.tmpdir()}/aifetchly-e2e/<run-id>/worker-<index>/<test-id>-<suffix>/
 * containing user-data/, database/, workspace/, downloads/, logs/, state.json,
 * and network-violations.jsonl. The bootstrap requires the path to live under
 * the `aifetchly-e2e` segment, so containment validation always passes.
 *
 * On success the fixture removes the root; on failure it is retained so the
 * artifact collector can copy diagnostics into Playwright's output dir. Recursive
 * deletion is gated behind containment validation so a sanitized/odd path can
 * never trigger an unsafe rm -rf.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { E2E_RUN_ROOT_SEGMENT, type E2ETestRoot } from "./types";

/** Manifest written by the fixture, read + validated by the bootstrap seeder. */
export interface E2EStateManifestInput {
  readonly authState: "authenticated" | "unauthenticated";
  readonly aiState: "hosted-disabled" | "local-enabled";
  readonly fakeAiBaseUrl: string;
  readonly workspacePath: string;
}

/** Write the validated state.json the E2EStateSeeder consumes. */
export function writeStateManifest(
  root: E2ETestRoot,
  manifest: E2EStateManifestInput
): void {
  const payload = {
    schemaVersion: 1,
    authState: manifest.authState,
    aiState: manifest.aiState,
    locale: "en",
    fakeAiBaseUrl: manifest.fakeAiBaseUrl,
    workspacePath: manifest.workspacePath,
  };
  fs.writeFileSync(root.stateFilePath, JSON.stringify(payload), "utf8");
}

export interface CreateTemporaryRootOptions {
  /** Stable test identifier (title path). Sanitized into a path segment. */
  readonly testId: string;
  /** Playwright worker index (0-based). */
  readonly workerIndex: number;
}

/** Replace any non-[a-zA-Z0-9-] run so the id is safe as a path segment. */
export function sanitizeTestId(id: string): string {
  return (
    id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "test"
  );
}

function assertContainedUnderRunRoot(target: string): void {
  const resolved = path.resolve(target);
  const runRootIndex = resolved.split(path.sep).indexOf(E2E_RUN_ROOT_SEGMENT);
  if (runRootIndex === -1) {
    throw new Error(
      `Refusing to delete path outside the ${E2E_RUN_ROOT_SEGMENT} run tree: ${resolved}`
    );
  }
}

export function createTemporaryRoot(
  options: CreateTemporaryRootOptions
): E2ETestRoot {
  const runId =
    process.env.AIFETCHLY_E2E_RUN_ID ?? crypto.randomBytes(4).toString("hex");
  process.env.AIFETCHLY_E2E_RUN_ID = runId;

  const suffix = crypto.randomBytes(3).toString("hex");
  const rootPath = path.join(
    os.tmpdir(),
    E2E_RUN_ROOT_SEGMENT,
    runId,
    `worker-${options.workerIndex}`,
    `${sanitizeTestId(options.testId)}-${suffix}`
  );

  const userDataPath = path.join(rootPath, "user-data");
  const databasePath = path.join(rootPath, "database");
  const workspacePath = path.join(rootPath, "workspace");
  const downloadsPath = path.join(rootPath, "downloads");
  const logsPath = path.join(rootPath, "logs");
  const stateFilePath = path.join(rootPath, "state.json");
  const networkViolationsPath = path.join(rootPath, "network-violations.jsonl");

  for (const dir of [
    rootPath,
    userDataPath,
    databasePath,
    workspacePath,
    downloadsPath,
    logsPath,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return {
    rootPath,
    userDataPath,
    databasePath,
    workspacePath,
    downloadsPath,
    logsPath,
    stateFilePath,
    networkViolationsPath,
    remove(): void {
      assertContainedUnderRunRoot(rootPath);
      try {
        fs.rmSync(rootPath, { recursive: true, force: true });
      } catch {
        /* best-effort; never fail a passing test on cleanup */
      }
    },
  };
}
