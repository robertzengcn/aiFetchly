/**
 * Worker-side scan wrapper (workerScanner).
 *
 * This is the ONLY function the worker calls to produce a snapshot. It lives
 * under src/childprocess/aifetchly-config/ per CLAUDE.md mandate, and is the
 * single import boundary the worker has into the shared scan pipeline.
 *
 * Prohibited imports (WorkerNoDbBoundary grep gate): the Electron main
 * module, the ORM, the @/modules business-logic tree, the @/model DB-model
 * tree, and any repository/datasource/SqliteDb symbol. The WorkspaceConfigScanner
 * under @/service/workspaceWatch is pure (no DB coupling — verified Phase
 * 13-01 + this file imports nothing else).
 */

import { WorkspaceConfigScanner } from "@/service/workspaceWatch/WorkspaceConfigScanner";
import type {
  WorkspaceConfigScanInput,
} from "@/service/workspaceWatch/WorkspaceConfigScanner";
import type { AIFetchlyConfigSnapshot } from "@/entityTypes/aifetchlyConfigTypes";

/**
 * Scan a workspace's `.aifetchly` (+ optional root AGENTS.md) into a typed
 * snapshot. NEVER throws — IO/size/path errors surface as recoverable
 * diagnostics on the returned snapshot (CFG-02/04/05).
 */
export async function scanWorkspace(
  input: WorkspaceConfigScanInput
): Promise<AIFetchlyConfigSnapshot> {
  const scanner = new WorkspaceConfigScanner();
  return scanner.scan(input);
}

export type { WorkspaceConfigScanInput };
