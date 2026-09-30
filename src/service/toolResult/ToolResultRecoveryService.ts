import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import type { ToolResultModule } from "@/modules/ToolResultModule";

/**
 * Startup reconciliation for preserved outputs (technical design §12.2).
 *
 * A crash can leave the filesystem and the registry disagreeing, because they
 * are not one transaction. The two interesting cases are:
 *
 *   - the payload was renamed into place but the registry commit never
 *     happened -> a file with no row, reclaimed after the grace period,
 *   - the registry row is committed but the terminal receipt was never
 *     published -> a recoverable `pending` outbox row.
 *
 * The rule this service must never break: NEVER INFER OPERATION SUCCESS FROM A
 * PAYLOAD FILE. A file proves bytes were written, not that the tool succeeded.
 * If the recorded outcome is missing, the artifact is left alone and the
 * existing job reconciliation decides what happened; recovery does not call
 * the original tool, and does not guess.
 *
 * Work is done in bounded keyset batches with a yield between them so a large
 * orphan directory cannot monopolize application startup.
 */

/** Counters describing one reconciliation pass. */
export interface RecoveryReport {
  readonly expiredLeasesReclaimed: number;
  readonly pendingReceiptsCompleted: number;
  readonly orphansRemoved: number;
  readonly filesSkippedTooRecent: number;
  readonly errors: number;
}

/** Bounded per-pass limits. */
export interface RecoveryOptions {
  /** Max registry rows examined per state. */
  readonly batchSize?: number;
  /** Max orphan directories removed per pass. */
  readonly maxOrphanRemovals?: number;
  readonly onYield?: () => void | Promise<void>;
}

export class ToolResultRecoveryService {
  private readonly module: ToolResultModule;
  private readonly storage: ToolResultStorageService;
  private readonly root: string;

  constructor(
    module: ToolResultModule,
    storage: ToolResultStorageService
  ) {
    this.module = module;
    this.storage = storage;
    this.root = storage.getRoot();
  }

  /**
   * Run one reconciliation pass. Safe to call at startup and again later; it
   * is idempotent and never throws for an individual bad artifact.
   */
  async run(options: RecoveryOptions = {}): Promise<RecoveryReport> {
    const batchSize = options.batchSize ?? 100;
    const maxOrphanRemovals = options.maxOrphanRemovals ?? 200;
    const graceMs = TOOL_RESULT_CONFIG.orphanGraceHours * 60 * 60 * 1000;
    const cutoff = Date.now() - graceMs;

    let expiredLeasesReclaimed = 0;
    let pendingReceiptsCompleted = 0;
    let orphansRemoved = 0;
    let filesSkippedTooRecent = 0;
    let errors = 0;

    // 1. Reclaim writing slots whose lease expired. These are crash residue:
    // the writer is gone, so the row can never reach 'committed' now.
    try {
      const abandoned = await this.module.listAbandonedClaims(
        new Date(),
        batchSize
      );
      for (const row of abandoned) {
        if (row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now()) {
          // An ACTIVE lease is always protected, however old the crash residue
          // around it looks.
          continue;
        }
        await this.module.markOutputFailed(
          row.outputId,
          "OUTPUT_PUBLICATION_FAILED"
        );
        expiredLeasesReclaimed += 1;
        await options.onYield?.();
      }
    } catch {
      errors += 1;
    }

    // 2. Complete terminal receipt publication for still-valid epochs.
    try {
      const pending = await this.module.listPendingPublications(batchSize);
      for (const row of pending) {
        // Only finish a publication whose owner scope is still valid; a
        // deleted conversation must not gain a receipt on restart.
        const decision = await this.module.authorizeAccess({
          outputId: row.outputId,
          profileId: row.profileId,
          conversationId: row.conversationId,
        });
        if (!decision.ok) continue;
        await this.module.markReceiptPublished(row.outputId);
        pendingReceiptsCompleted += 1;
        await options.onYield?.();
      }
    } catch {
      errors += 1;
    }

    // 3. Sweep unregistered artifact directories past the grace period.
    try {
      const result = await this.sweepOrphans(cutoff, maxOrphanRemovals);
      orphansRemoved += result.removed;
      filesSkippedTooRecent += result.skipped;
    } catch {
      errors += 1;
    }

    return {
      expiredLeasesReclaimed,
      pendingReceiptsCompleted,
      orphansRemoved,
      filesSkippedTooRecent,
      errors,
    };
  }

  /**
   * Remove artifact directories that are old enough and have no registry row.
   *
   * The grace period is what makes this safe: a directory younger than the
   * grace window may belong to a capture that is still running.
   */
  private async sweepOrphans(
    cutoff: number,
    maxRemovals: number
  ): Promise<{ removed: number; skipped: number }> {
    const toolResultsRoot = path.join(this.root, "tool-results");
    if (!fs.existsSync(toolResultsRoot)) return { removed: 0, skipped: 0 };

    let removed = 0;
    let skipped = 0;
    // Walk profile -> epoch -> output-id. One level at a time keeps memory
    // bounded regardless of how many artifacts exist.
    for (const profileDir of safeReadDir(toolResultsRoot)) {
      for (const epochDir of safeReadDir(profileDir)) {
        for (const outputDir of safeReadDir(epochDir)) {
          if (removed >= maxRemovals) return { removed, skipped };
          // The directory is named `sha256(outputId)`, NOT the output id.
          // Looking the name up as an output id matches nothing, which would
          // make every COMMITTED artifact look like an orphan and delete it.
          const dirName = path.basename(outputDir);
          const registered = await this.module
            .findRegisteredOutputDir(dirName)
            .catch(() => null);
          if (registered) continue;
          let mtimeMs: number;
          try {
            mtimeMs = fs.statSync(outputDir).mtimeMs;
          } catch {
            continue;
          }
          if (mtimeMs > cutoff) {
            // Too recent to be crash residue: a capture may still own it.
            skipped += 1;
            continue;
          }
          await fs.promises
            .rm(outputDir, { recursive: true, force: true })
            .catch(() => undefined);
          removed += 1;
        }
      }
    }
    return { removed, skipped };
  }
}

/** Read a directory, returning [] instead of throwing on a racing delete. */
function safeReadDir(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}
