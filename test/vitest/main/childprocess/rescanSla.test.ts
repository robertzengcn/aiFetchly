/**
 * rescanSla — SC5 <500ms Rescan SLA verification.
 *
 * SC5 definition (PLAN.md must_haves.truth):
 *   - "SC5 SLA clock window = scan-start → snapshot-applied (EXCLUDES the
 *     500ms debounce and awaitWriteFinish event-coalescing)"
 *   - "typical .aifetchly = ≤10 files / ≤512KB total"
 *
 * This test logs the elapsed scan time on every commit (Nyquist observe-the-
 * signal) and asserts <450ms (50ms regression headroom under the 500ms SLA).
 * The empty-dir case is an observability smoke — logs only, no SLA assert.
 *
 * Fixture shape (per PLAN.md Task 3):
 *   .aifetchly/AGENTS.md       64KB
 *   .aifetchly/settings.json    4KB
 *   .aifetchly/commands/cmd0..7 8KB each (8 files)
 *   Total: 10 files / ~132KB (well under the 512KB ceiling)
 */

import { describe, expect, it } from "vitest";
import { WorkspaceConfigScanner } from "@/service/workspaceWatch/WorkspaceConfigScanner";
import { tmpdirSync, writeFiles } from "./_fixtures/workspaceTmpdir";

describe("SC5 rescan SLA (<500ms typical .aifetchly)", () => {
  it("a typical .aifetchly (10 files / ~132KB) scans under 450ms (50ms regression headroom)", async () => {
    const root = tmpdirSync();
    writeFiles(root, [
      { path: ".aifetchly/AGENTS.md", size: 64 * 1024 },
      { path: ".aifetchly/settings.json", size: 4 * 1024 },
      ...Array.from({ length: 8 }, (_, i) => ({
        path: `.aifetchly/commands/cmd${i}.md`,
        size: 8 * 1024,
      })),
    ]);

    const scanner = new WorkspaceConfigScanner();
    // Warm the scanner once to amortise module-init/JIT cost (the SLA is for
    // steady-state rescans, not the very first scan after cold start).
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
      `[SC5] rescan elapsed: ${elapsed.toFixed(1)}ms (files=${snap.files.length})`
    );

    expect(elapsed, `rescan took ${elapsed.toFixed(1)}ms (SLA 500ms, headroom 50ms)`).toBeLessThan(
      450
    );
  });

  it("logs elapsed for an empty .aifetchly (observability smoke — no SLA assert)", async () => {
    const root = tmpdirSync(); // no .aifetchly dir at all
    const scanner = new WorkspaceConfigScanner();

    const t0 = performance.now();
    const snap = await scanner.scan({
      workspaceId: "w1",
      workspaceRoot: root,
      includeRootAgentsFile: false,
    });
    const elapsed = performance.now() - t0;

    // eslint-disable-next-line no-console
    console.log(
      `[SC5] empty rescan elapsed: ${elapsed.toFixed(1)}ms (files=${snap.files.length})`
    );

    // Smoke: empty scan returns a valid empty snapshot, no throw.
    expect(snap.files).toHaveLength(0);
    expect(snap.instructions).toHaveLength(0);
  });
});
