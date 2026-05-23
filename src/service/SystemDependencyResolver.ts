/**
 * Advisory resolver for system dependencies.
 *
 * Takes error output, platform info, and optional manifest hints,
 * then returns a structured recommendation WITHOUT executing any
 * install commands. This is a pure function with no side effects.
 *
 * Trust boundary: the resolver suggests, the installer validates.
 */

import { SkillDiagnosticsService } from "@/service/SkillDiagnosticsService";
import type { SystemDependencyCatalog } from "@/service/SystemDependencyCatalog";
import type {
  ResolveSystemDependencyInput,
  ResolveSystemDependencyOutput,
} from "@/entityTypes/systemDependencyTypes";

/** Confidence when both manifest and catalog agree. */
const CONFIDENCE_EXACT_MATCH = 0.95;

/** Confidence when matched from stderr pattern only (no manifest). */
const CONFIDENCE_PATTERN_ONLY = 0.7;

/** Threshold below which results require manual review. */
const MANUAL_REVIEW_THRESHOLD = 0.8;

/**
 * Advisory resolver that identifies missing system dependencies
 * from skill execution errors and cross-references them with
 * the local dependency catalog.
 */
export class SystemDependencyResolver {
  private readonly catalog: SystemDependencyCatalog;

  constructor(catalog: SystemDependencyCatalog) {
    this.catalog = catalog;
  }

  /**
   * Resolve a potential missing system dependency from skill error output.
   *
   * This method performs NO side effects — it only analyzes the error
   * and returns a recommendation.
   */
  resolve(input: ResolveSystemDependencyInput): ResolveSystemDependencyOutput {
    const { stderr, manifest } = input;

    // Step 1: Diagnose the error
    const diagnosis = SkillDiagnosticsService.diagnoseStderr(stderr, manifest);

    if (diagnosis.cause !== "missing_system_tool") {
      return {
        resolved: false,
        confidence: 0,
        reason: "Not a system dependency error",
        requires_manual_review: true,
      };
    }

    // Step 2: Get dependency_id from diagnosis
    const dependencyId = diagnosis.dependency_id;
    const missingBinary = diagnosis.missing_binary;

    if (!dependencyId) {
      return {
        resolved: false,
        confidence: 0,
        reason: "Could not identify the missing dependency",
        requires_manual_review: true,
      };
    }

    // Step 3: Validate against catalog
    const catalogEntry = this.catalog.getById(dependencyId);
    if (!catalogEntry) {
      return {
        resolved: false,
        confidence: 0,
        reason: `Dependency "${dependencyId}" not found in local catalog`,
        requires_manual_review: true,
      };
    }

    // Step 4: Determine confidence
    const hasManifest = manifest?.python?.system?.some(
      (dep) => dep.name === dependencyId
    );
    const confidence = hasManifest
      ? CONFIDENCE_EXACT_MATCH
      : CONFIDENCE_PATTERN_ONLY;
    const requiresManualReview = confidence < MANUAL_REVIEW_THRESHOLD;

    // Step 5: Build platform candidates
    const platformCandidates: Record<
      string,
      { manager: string; package: string }
    > = {};
    for (const [plat, candidate] of Object.entries(catalogEntry.platforms)) {
      if (candidate) {
        platformCandidates[plat] = candidate;
      }
    }

    return {
      resolved: true,
      dependency_id: dependencyId,
      missing_binary: missingBinary,
      confidence,
      reason: hasManifest
        ? `Matched "${dependencyId}" from skill manifest (probe: ${missingBinary})`
        : `Matched "${dependencyId}" from error pattern (probe: ${missingBinary})`,
      platform_candidates: platformCandidates,
      requires_manual_review: requiresManualReview,
    };
  }
}
