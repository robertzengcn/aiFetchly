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
import { PortableMemoryFileScanner } from "./PortableMemoryFileScanner";

/**
 * Scan a workspace's `.aifetchly` (+ optional root AGENTS.md) into a typed
 * snapshot. NEVER throws — IO/size/path errors surface as recoverable
 * diagnostics on the returned snapshot (CFG-02/04/05).
 */
export async function scanWorkspace(
  input: WorkspaceConfigScanInput
): Promise<AIFetchlyConfigSnapshot> {
  const scanner = new WorkspaceConfigScanner();
  const snapshot = await scanner.scan(input);
  // Portable-memory scan rides the same snapshot (design §12.4). The scanner
  // is worker-only and bounded; failures surface as diagnostics + an
  // incomplete snapshot rather than throwing.
  const portable = await new PortableMemoryFileScanner().scan({
    workspaceRoot: input.workspaceRoot,
    sourceId: snapshot.sourceId,
  });
  return { ...snapshot, portableMemory: portable };
}

export type { WorkspaceConfigScanInput };
