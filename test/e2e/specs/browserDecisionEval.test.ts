import { expect, test } from "@playwright/test";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";
import { createTemporaryRoot, writeStateManifest } from "../fixtures/temporaryState";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * E02 (PRD §§8–10, design §§20–21): the PAIRED-evaluation harness.
 *
 * Runs the SAME task set through BOTH executor arms (fast_runner =
 * acceleration, llm_agent = operator baseline available in the same
 * build), collects the §21 metrics per task (status, reason, timings,
 * tokens, attempts), aggregates the report (p50/p95 wall, per-arm
 * success/fallback counts, tokens, cost proxy, parent-context bytes) and
 * writes `test-results/browser-eval-report.json`.
 *
 * RUN MODES:
 *  - Default (no AIFETCHLY_EVAL): a 2-task HARNESS SMOKE against the
 *    deterministic fake provider — proves the harness executes and the
 *    report is produced. NOT evidence of model quality.
 *  - AIFETCHLY_EVAL=1 with a configured provider backend (fakeAiBaseUrl
 *    replaced by the real gateway / custom provider) and the REAL held-out
 *    task set (`AIFETCHLY_EVAL_TASKSET=<path>`): the qualification run.
 *    The live-backend run and the Jev/Laya hybrid arms require deployed
 *    backends and stay operator-gated; this harness is the runner.
 */

interface TaskSpec {
  readonly goal: string;
  readonly family: string;
  readonly language: string;
}

interface ArmRow {
  readonly arm: string;
  readonly taskIndex: number;
  readonly family: string;
  readonly language: string;
  readonly status: string;
  readonly reason: string;
  readonly wallMs: number | null;
  readonly tokensUsed: number;
  readonly attempts: number;
  readonly parentContextBytes: number;
}

const p50 = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
};

const p95 = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * 95) / 100))] ?? 0;
};

const HARNESS_TASKS: readonly TaskSpec[] = [
  { goal: "Search for supplier prices and open the results.", family: "search", language: "en" },
  { goal: "Search for widgets and open the results.", family: "search", language: "en" },
];

test.describe("browser decision paired evaluation (E02)", () => {
  test("runs the paired arms over the task set and writes the §21 report", async () => {
    test.setTimeout(300_000);
    const evalMode = process.env.AIFETCHLY_EVAL === "1";
    const taskSetPath = process.env.AIFETCHLY_EVAL_TASKSET;
    let tasks: readonly TaskSpec[] = HARNESS_TASKS;
    if (evalMode && taskSetPath && fs.existsSync(taskSetPath)) {
      tasks = JSON.parse(fs.readFileSync(taskSetPath, "utf8")) as TaskSpec[];
    }
    const arms: ReadonlyArray<"fast_runner" | "llm_agent"> = ["fast_runner", "llm_agent"];

    const fakeAi = await startFakeOpenAiServer();
    const root = createTemporaryRoot({
      testId: "browser-decision-eval",
      workerIndex: 0,
    });
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
    });
    const app: LaunchedApp = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      extraEnv: { AIFETCHLY_E2E_APP_HOOKS: "1" },
    });
    try {
      await fakeAi.setScenario("browser-decision");
      const rows: ArmRow[] = [];
      for (const arm of arms) {
        for (let index = 0; index < tasks.length; index++) {
          const task = tasks[index]!;
          const result = await app.mainWindow.evaluate(
            async (input: {
              goals: readonly string[];
              executor: "fast_runner" | "llm_agent";
            }) => {
              const hooks = (window as unknown as {
                __e2e?: {
                  runBatchAndStop?: (input: {
                    readonly goals: readonly string[];
                    readonly executor: "fast_runner" | "llm_agent";
                  }) => Promise<{
                    batchId: string;
                    statuses: string[];
                    openSessions: number;
                    metrics?: {
                      wallMs: number;
                      tokensUsed: number;
                      attempts: number;
                      phases: {
                        observationMs: number;
                        decideMs: number;
                        executeMs: number;
                        verifyMs: number;
                      };
                      parentContextBytes: number;
                    };
                    rows: Array<Record<string, unknown>>;
                  }>;
                };
              }).__e2e;
              if (!hooks?.runBatchAndStop) {
                throw new Error("e2e_hooks_missing");
              }
              return await hooks.runBatchAndStop({
                goals: input.goals,
                executor: input.executor,
              });
            },
            { goals: [task.goal], executor: arm }
          );
          const row = result.rows[0] ?? {};
          const timings = row.timings as
            | { wallMs: number; attempts: number }
            | undefined;
          rows.push({
            arm,
            taskIndex: index,
            family: task.family,
            language: task.language,
            status: String(row.status ?? "unknown"),
            reason: String(row.summary ?? "").slice(0, 200),
            wallMs: timings?.wallMs ?? result.metrics?.wallMs ?? null,
            tokensUsed: Number(row.tokensUsed ?? result.metrics?.tokensUsed ?? 0),
            attempts: timings?.attempts ?? result.metrics?.attempts ?? 0,
            parentContextBytes: result.metrics?.parentContextBytes ?? 0,
          });
          // The batch path releases every session between tasks.
          expect(result.openSessions).toBe(0);
        }
      }

      // §21 aggregation per arm.
      const report = {
        generatedAt: new Date().toISOString(),
        mode: evalMode ? "qualification-candidate" : "harness-smoke",
        note:
          evalMode
            ? "operator-provided backend + held-out task set"
            : "deterministic fake provider — harness smoke, NOT model-quality evidence",
        arms: arms.map((arm) => {
          const armRows = rows.filter((r) => r.arm === arm);
          const walls = armRows
            .map((r) => r.wallMs)
            .filter((v): v is number => typeof v === "number" && v >= 0);
          return {
            arm,
            tasks: armRows.length,
            completed: armRows.filter((r) => r.status === "completed").length,
            failed: armRows.filter((r) => r.status === "failed").length,
            cancelledOrPartial: armRows.filter(
              (r) => r.status === "cancelled" || r.status === "partial"
            ).length,
            wallP50Ms: p50(walls),
            wallP95Ms: p95(walls),
            tokensUsed: armRows.reduce((sum, r) => sum + r.tokensUsed, 0),
            attempts: armRows.reduce((sum, r) => sum + r.attempts, 0),
            parentContextBytes: armRows.reduce(
              (sum, r) => sum + r.parentContextBytes,
              0
            ),
            costPerVerifiedSuccessProxy:
              armRows.filter((r) => r.status === "completed").length > 0
                ? Math.round(
                    (armRows.reduce((sum, r) => sum + r.tokensUsed, 0) /
                      armRows.filter((r) => r.status === "completed").length) *
                      100
                  ) / 100
                : null,
          };
        }),
        rows,
      };

      const outDir = path.join(process.cwd(), "test-results");
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, "browser-eval-report.json");
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

      // The harness invariant: the report exists, both arms ran, and the
      // shape carries the §21 metrics.
      expect(report.rows).toHaveLength(arms.length * tasks.length);
      expect(report.arms).toHaveLength(2);
      for (const arm of report.arms) {
        expect(arm.tasks).toBe(tasks.length);
        expect(arm.parentContextBytes).toBeGreaterThan(0);
      }
    } finally {
      await app.electronApp.close();
      await fakeAi.stop();
    }
  });
});
