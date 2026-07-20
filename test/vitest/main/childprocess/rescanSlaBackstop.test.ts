/**
 * SC5 perf-backstop — regression guard on a LARGER workspace fixture.
 *
 * Complements (does NOT replace) `rescanSla.test.ts` from Plan 14-01. The
 * 14-01 test enforces the user-visible SC5 SLA: <500ms for a TYPICAL
 * workspace (≤10 files / ≤512KB). That test runs every commit.
 *
 * This backstop catches PERF DRIFT on a larger workspace via the CI / verify-
 * work path. Fixture: 50 files / ~2MB total, sized to the CFG-04 caps:
 *   - .aifetchly/AGENTS.md         256 KB  (agentsMdBytes cap)
 *   - .aifetchly/settings.json      32 KB  (settingsJsonBytes cap)
 *   - 48x .aifetchly/commands/cN   ~36 KB  (under commandMdBytes=64KB cap)
 *   Total: 50 files / ~2 MB
 *
 * Ceiling: <2000ms (2 seconds). This is the BACKSTOP regression ceiling, NOT
 * the user-visible SLA (which is 500ms, enforced by rescanSla.test.ts on the
 * typical-shape fixture). The 2s headroom accommodates CI runner variance on
 * a fixture ~4x the typical size; what we are watching for is a multi-x
 * regression (e.g., O(n^2) hashing, accidental double-reads) rather than the
 * per-commit SLA.
 *
 * Logs `[SC5-backstop] rescan elapsed: ...` so the metric is observable in
 * CI output (matches the `[SC5] rescan elapsed: ...` log shape from the
 * primary SLA test).
 */
import { describe, expect, it } from "vitest";
import { WorkspaceConfigScanner } from "@/service/workspaceWatch/WorkspaceConfigScanner";
import { tmpdirSync, writeFiles } from "./_fixtures/workspaceTmpdir";

describe("SC5 perf-backstop (50 files / ~2MB regression guard)", () => {
  it("a large .aifetchly (50 files / ~2MB) scans under 2000ms (regression ceiling)", async () => {
    const root = tmpdirSync();
    // Build a worst-case-shape workspace. All files are valid input — sized
    // just under the CFG-04 caps so the scanner parses + hashes each one
    // fully (the actual cost path we are guarding against drift on).
    writeFiles(root, [
      { path: ".aifetchly/AGENTS.md", size: 256 * 1024 },
      // settings.json MUST be valid JSON or the scanner drops it as a
      // malformed-JSON diagnostic (defeating the 50-file sanity check below).
      // Use `content` with a padded valid-JSON object sized just under the
      // 32KB CFG-04 cap, instead of `size` filler (which is non-JSON).
      {
        path: ".aifetchly/settings.json",
        content: '{"k":"' + "a".repeat(32 * 1024 - 100) + '"}',
      },
      ...Array.from({ length: 48 }, (_, i) => ({
        path: `.aifetchly/commands/cmd${i}.md`,
        size: 36 * 1024,
      })),
    ]);

    const scanner = new WorkspaceConfigScanner();
    // Warm the scanner once to amortise module-init / JIT cost — same
    // rationale as rescanSla.test.ts (the SLA targets steady-state rescans,
    // not the first scan after cold start).
    await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });

    const t0 = performance.now();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: true,
    });
    const elapsed = performance.now() - t0;

    // eslint-disable-next-line no-console
    console.log(
      `[SC5-backstop] rescan elapsed: ${elapsed.toFixed(1)}ms (files=${
        snap.files.length
      })`
    );

    // Regression ceiling — distinct from the 500ms user-visible SLA. The
    // backstop watches for multi-x drift on a larger fixture; it does NOT
    // replace rescanSla.test.ts.
    expect(
      elapsed,
      `[SC5-backstop] rescan took ${elapsed.toFixed(1)}ms on 50 files / ~2MB ` +
        `(regression ceiling 2000ms; user-visible 500ms SLA enforced by rescanSla.test.ts)`
    ).toBeLessThan(2000);

    // Fixture sanity: snap.files inventories AGENTS.md + command files only
    // (49 = 1 AGENTS.md + 48 commands). settings.json IS scanned + parsed
    // (it counts toward the perf budget above) but is NOT listed in
    // snap.files by design — its values are applied, not inventoried. 50
    // physical files on disk → 49 tracked in snap.files.
    expect(
      snap.files.length,
      "AGENTS.md + 48 commands in snap.files (settings.json parsed but not listed)"
    ).toBe(49);
  });
});
