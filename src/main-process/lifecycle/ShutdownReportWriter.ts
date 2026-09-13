import * as fs from "fs";
import * as path from "path";
import { log } from "@/modules/Logger";
import { getDiagnosticsDir } from "@/modules/diagnostics/DiagnosticPaths";
import type { ShutdownReport } from "@/main-process/lifecycle/ShutdownCoordinator";

/**
 * ShutdownReportWriter — persists the privacy-safe shutdown report as JSONL
 * in the local diagnostics directory (PRD FR-09, AC-15).
 *
 * Local-only: no remote telemetry, no command arguments, no credentials —
 * the report shape is already sanitized by the coordinator (truncated
 * messages, participant ids only). Failures are logged and never thrown:
 * a diagnostics write must not alter shutdown behavior.
 */

const REPORT_FILENAME = "shutdown-reports.jsonl";
/** Keep the file bounded: newest 200 attempts. */
const MAX_REPORTS = 200;

export function appendShutdownReport(report: ShutdownReport): void {
  try {
    const dir = getDiagnosticsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, REPORT_FILENAME);
    const line = `${JSON.stringify({
      ...report,
      recordedAt: new Date().toISOString(),
    })}\n`;
    fs.appendFileSync(file, line);
    trimToLimit(file);
  } catch (err) {
    log.warn(
      "[shutdown] could not persist shutdown report:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

function trimToLimit(file: string): void {
  try {
    if (!fs.existsSync(file)) return;
    const lines = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    if (lines.length <= MAX_REPORTS) return;
    fs.writeFileSync(file, `${lines.slice(-MAX_REPORTS).join("\n")}\n`);
  } catch {
    /* best-effort retention trim */
  }
}
