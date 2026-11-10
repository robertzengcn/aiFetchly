import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Preload invoke-allowlist parity guard (review 2026-10-17).
 *
 * The renderer API layer calls channels through `windowInvoke(CHANNEL, …)`,
 * but preload.ts maintains its OWN literal `validChannels` list — a channel
 * added to channellist.ts with a handler and a client but forgotten in
 * preload silently returns undefined, `windowInvoke` throws "unknow
 * error", and callers that `.catch(() => undefined)` no-op in production.
 * This has shipped repeatedly (AGENT_TASK_CANCEL being the latest), so this
 * test source-scans both sides and refuses any drift: every channel
 * constant the api layer invokes MUST be allowlisted in preload.
 *
 * Pattern follows the ownedSpawnWiringGuard precedent (source-scan guards
 * make cross-file wiring un-regressible).
 */

const REPO_ROOT = path.resolve(process.cwd());
const API_DIR = path.join(REPO_ROOT, "src", "views", "api");
const PRELOAD_PATH = path.join(REPO_ROOT, "src", "preload.ts");

function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

/** CHANNEL constants referenced as windowInvoke(<CONST>, …) in src/views/api. */
function collectInvokedChannels(): Map<string, string[]> {
  const invoked = new Map<string, string[]>();
  const files = fs
    .readdirSync(API_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort();
  for (const file of files) {
    const source = readIfExists(path.join(API_DIR, file));
    if (!source) continue;
    const re = /windowInvoke\(\s*([A-Z][A-Z0-9_]*)\s*[,:)]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const channel = match[1];
      invoked.set(channel, [...(invoked.get(channel) ?? []), file]);
    }
  }
  return invoked;
}

describe("preload invoke allowlist parity", () => {
  it("every channel the renderer api invokes is allowlisted in preload", () => {
    const preload = readIfExists(PRELOAD_PATH);
    expect(preload, "src/preload.ts must be readable").not.toBeNull();

    const invoked = collectInvokedChannels();
    expect(
      invoked.size,
      "expected the api layer to invoke channels"
    ).toBeGreaterThan(50);

    const missing: Array<{ channel: string; files: string[] }> = [];
    for (const [channel, files] of [...invoked].sort(([a], [b]) =>
      a < b ? -1 : 1
    )) {
      // The validChannels array entries appear as bare identifiers; the
      // import block carries the same names. Both literal blocks satisfy an
      // occurrence count of at least two (import + list).
      const occurrences = preload!.split(new RegExp(`\\b${channel}\\b`))
        .length - 1;
      if (occurrences < 2) {
        missing.push({ channel, files });
      }
    }

    expect(
      missing,
      `channels invoked by src/views/api but missing from the preload invoke allowlist (import + validChannels): ${JSON.stringify(
        missing
      )}`
    ).toEqual([]);
  });

  it("the agent-task cancel channel specifically is allowlisted (regression: shipped dead once)", () => {
    const preload = readIfExists(PRELOAD_PATH)!;
    expect(preload).toMatch(/\bAGENT_TASK_CANCEL\b/);
  });
});
