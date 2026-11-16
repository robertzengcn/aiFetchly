/**
 * Structural guard against the packaged-worker env regression class.
 *
 * Production failure (2026-11-12..14, "AI extraction error: {}" x182): the
 * contact-extraction worker bundle read `process.env.VITE_LOGIN_URL` at
 * runtime, but the packaged app never has that env var — the main bundle gets
 * it INLINED at build time by the `define` in vite.main.config.mjs, and the
 * worker's own vite config had no define. The worker silently fell back to
 * http://localhost:3000 and every AI extraction failed with ECONNREFUSED.
 *
 * The invariant this test locks in:
 *
 *   A worker bundle must never rely on reading a `VITE_*` env var at runtime,
 *   because the packaged app does not set those vars — they exist only as
 *   build-time-inlined literals. Any `process.env.VITE_*` read under
 *   src/childprocess must therefore be (a) inlined via `define` in the worker
 *   config(s) that bundle the file, (b) forwarded by the spawn site when the
 *   value must come from the main process, and (c) recorded in the allowlist
 *   below with a justification.
 *
 * If this test fails because you added a new `process.env.VITE_*` read in
 * worker code: add the same `define` entry the main config uses for that var
 * to your worker's vite config (see vite.contactExtractionWorker.config.mjs),
 * forward it from the spawn site when the worker inherits nothing (see
 * buildWorkerLoginUrlEnv in src/utils/packagedWorkerPath.ts), and add an
 * allowlist entry here with the justification. Unlisted reads fail CLOSED —
 * unknown placement is treated as a bug, not skipped.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const WORKER_SRC_ROOT = path.join(PROJECT_ROOT, "src", "childprocess");

/**
 * Allowlist of `VITE_*` vars that worker code reads via process.env at
 * runtime. The full define key (with its `process.env.` prefix) is assembled
 * from parts because the vitest run applies vite.main.config.mjs's `define`
 * to test files too — a verbatim occurrence would be textually replaced and
 * the assertions would check the wrong string.
 */
const WORKER_RUNTIME_VITE_ALLOWLIST: Record<
  string,
  { defineIn: string[]; reason: string }
> = {
  VITE_LOGIN_URL: {
    defineIn: ["vite.contactExtractionWorker.config.mjs"],
    reason:
      "ContactExtractionAiClient.getApiBaseUrl() reads it at runtime; " +
      "inlined in the worker config and forwarded at spawn by " +
      "contactExtraction-ipc.ts via buildWorkerLoginUrlEnv (packaged main " +
      "process never has the env var — vite.main.config.mjs inlines it).",
  },
};

/** vite configs that build packaged worker bundles (non-e2e, non-main). */
function collectWorkerConfigFiles(): string[] {
  const excluded = new Set([
    "vite.main.config.mjs",
    "vite.preload.config.mjs",
    "vite.render.config.mjs",
    "vite.utilityCode.config.mjs",
    "vite.utilityCode.ci.config.mjs",
  ]);
  return fs
    .readdirSync(PROJECT_ROOT)
    .filter(
      (name) =>
        /^vite\..+\.config\.mjs$/.test(name) &&
        !name.startsWith("vite.e2e.") &&
        !excluded.has(name)
    )
    .sort();
}

/** Strip comments so doc mentions of `process.env.VITE_*` are not flagged. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

interface ViteRuntimeRead {
  variable: string;
  file: string;
}

/** Recursively list .ts/.js files under dir, relative to dir, POSIX slashes. */
function listWorkerSourceFiles(dir: string, base = ""): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...listWorkerSourceFiles(path.join(dir, entry.name), relative));
    } else if (/\.(ts|js|mjs)$/.test(entry.name)) {
      found.push(relative);
    }
  }
  return found;
}

/** Every `process.env.VITE_*` read under src/childprocess (comments stripped). */
function scanWorkerViteRuntimeReads(): ViteRuntimeRead[] {
  const reads: ViteRuntimeRead[] = [];
  const scanPattern = /process\.env\.(VITE_[A-Z0-9_]+)/g;
  for (const relative of listWorkerSourceFiles(WORKER_SRC_ROOT)) {
    const absolute = path.join(WORKER_SRC_ROOT, relative);
    const matches = stripComments(fs.readFileSync(absolute, "utf8")).matchAll(
      scanPattern
    );
    for (const match of matches) {
      reads.push({ variable: match[1], file: relative });
    }
  }
  return reads;
}

describe("worker bundle VITE_* env inline guard", () => {
  it("scanner is not vacuous: the known runtime read is still detected", () => {
    // If path resolution or the scan pattern breaks, the assertions below
    // would pass vacuously against an empty scan. Pin the known baseline.
    const reads = scanWorkerViteRuntimeReads();
    expect(reads).toContainEqual({
      variable: "VITE_LOGIN_URL",
      file: "contact-extraction/ContactExtractionAiClient.ts",
    });
  });

  it("every runtime VITE_* read in worker code is allowlisted with a reason", () => {
    const unlisted: string[] = [];
    for (const read of scanWorkerViteRuntimeReads()) {
      if (!WORKER_RUNTIME_VITE_ALLOWLIST[read.variable]) {
        unlisted.push(`${read.file} reads ${read.variable}`);
      }
    }
    // Fail closed: any new process.env.VITE_* read under src/childprocess
    // must be inlined by its worker vite config and recorded above.
    expect(unlisted).toEqual([]);
  });

  it("each allowlisted var is define-inlined in its worker vite config", () => {
    for (const [variable, entry] of Object.entries(
      WORKER_RUNTIME_VITE_ALLOWLIST
    )) {
      // Assembled from parts — see the allowlist comment about define
      // replacement inside test sources.
      const defineKey = `["']process\\.env\\.${variable}["']\\s*:`;
      const defineKeyRegex = new RegExp(defineKey);
      for (const config of entry.defineIn) {
        const configPath = path.join(PROJECT_ROOT, config);
        expect(fs.existsSync(configPath)).toBe(true);
        expect(
          defineKeyRegex.test(fs.readFileSync(configPath, "utf8")),
          `${config} must define 'process.env.${variable}' — without the ` +
            `define the packaged worker reads it at runtime, inherits ` +
            `nothing, and silently falls back to localhost (the 2026-11 ` +
            `"AI extraction error: {}" outage). ${entry.reason}`
        ).toBe(true);
      }
    }
  });

  it("vite.main.config.mjs still inlines VITE_LOGIN_URL for the main process", () => {
    // resolveViteLoginBase() (and the spawn-site forwarding built on it)
    // reads the value through this define. Removing it reintroduces the
    // outage from the worker side AND breaks the main process's own URL.
    const mainConfig = fs.readFileSync(
      path.join(PROJECT_ROOT, "vite.main.config.mjs"),
      "utf8"
    );
    const defineKeyRegex = new RegExp(
      `["']process\\.env\\.VITE_LOGIN_URL["']\\s*:`
    );
    expect(defineKeyRegex.test(mainConfig)).toBe(true);
  });

  it("contact extraction spawn site still forwards the resolved login URL", () => {
    // The worker is spawned with nothing but what the main process passes;
    // buildWorkerLoginUrlEnv bridges the inlined-main-value to the
    // runtime-reading worker. Removing the call (or leaving the fragment
    // out of the spawn env) reintroduces the fallback. Assert the CALL SITE
    // and the env spread — an unused import satisfies neither.
    const ipcSource = fs.readFileSync(
      path.join(
        PROJECT_ROOT,
        "src/main-process/communication/contactExtraction-ipc.ts"
      ),
      "utf8"
    );
    expect(
      ipcSource.includes("buildWorkerLoginUrlEnv("),
      "contactExtraction-ipc.ts must call buildWorkerLoginUrlEnv(...) — " +
        "the packaged worker inherits no VITE_* env vars, so without this " +
        "forwarding every AI extraction falls back to localhost:3000 " +
        '(the 2026-11 "AI extraction error: {}" outage)'
    ).toBe(true);
    expect(ipcSource).toContain("...workerLoginUrlEnv");
    expect(ipcSource).toContain("resolveViteLoginBase");
  });
});
