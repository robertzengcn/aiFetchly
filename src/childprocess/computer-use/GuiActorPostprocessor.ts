/**
 * GUI-Actor postprocessing and calibration (design §5.7).
 *
 * GUI-Actor always produces an attention peak; it has no native "not
 * present" output. Classification is therefore calibrated, model-specific,
 * and NEVER a probability:
 *
 *  - Ambiguous: the second-ranked region's score is at least a calibrated
 *    ratio of the top score AND its center lies outside the top region →
 *    `target_ambiguous`.
 *  - Likely absent: the top region's mean activation is below a threshold
 *    calibrated on absent-target fixtures → `target_not_found`.
 *  - Otherwise `resolved`.
 *
 * Scores are metadata for ranking and diagnostics only. Absent/ambiguous
 * output can never dispatch input (CU-VISION-07 / §5.9.2).
 */
import type {
  GroundingCandidate,
  GroundingOutcome,
} from "@/entityTypes/computerUseTypes";
import { ComputerUseError } from "@/entityTypes/computerUseTypes";

export interface GroundingCalibration {
  /** second.score >= ambiguityRatio * top.score AND disjoint → ambiguous. */
  readonly ambiguityRatio: number;
  /** top.score < absenceThreshold → target_not_found. */
  readonly absenceThreshold: number;
}

/** Defaults pending Phase 2 calibration on Excel absent-target fixtures. */
export const GUI_ACTOR_DEFAULT_CALIBRATION: GroundingCalibration = {
  ambiguityRatio: 0.85,
  absenceThreshold: 0.2,
};

export function validateCalibration(calibration: GroundingCalibration): void {
  if (
    !Number.isFinite(calibration.ambiguityRatio) ||
    calibration.ambiguityRatio <= 0 ||
    calibration.ambiguityRatio > 1
  ) {
    throw new ComputerUseError(
      "coordinates_invalid",
      "ambiguityRatio must be in (0, 1]"
    );
  }
  if (
    !Number.isFinite(calibration.absenceThreshold) ||
    calibration.absenceThreshold < 0 ||
    calibration.absenceThreshold > 1
  ) {
    throw new ComputerUseError(
      "coordinates_invalid",
      "absenceThreshold must be in [0, 1]"
    );
  }
}

/** Sort candidates by descending score (stable for equal scores). */
export function rankCandidates(
  candidates: readonly GroundingCandidate[]
): GroundingCandidate[] {
  return [...candidates]
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.score - a.candidate.score || a.index - b.index)
    .map((entry) => entry.candidate);
}

/** True when point (px, py) lies inside the region centered at top. */
function pointInsideRegion(
  px: number,
  py: number,
  top: GroundingCandidate
): boolean {
  const halfW = (top.regionWidthNormalized ?? 0) / 2;
  const halfH = (top.regionHeightNormalized ?? 0) / 2;
  if (halfW <= 0 || halfH <= 0) return false;
  return (
    px >= top.nx - halfW &&
    px <= top.nx + halfW &&
    py >= top.ny - halfH &&
    py <= top.ny + halfH
  );
}

/**
 * Apply the calibrated classification. Input candidates may be unranked;
 * the returned ranked list is the model-facing candidate order.
 */
export function classifyGrounding(
  candidates: readonly GroundingCandidate[],
  calibration: GroundingCalibration = GUI_ACTOR_DEFAULT_CALIBRATION
): { outcome: GroundingOutcome; ranked: GroundingCandidate[] } {
  validateCalibration(calibration);
  const ranked = rankCandidates(candidates);
  if (ranked.length === 0) {
    return { outcome: "target_not_found", ranked };
  }
  const top = ranked[0];
  if (top.score < calibration.absenceThreshold) {
    return { outcome: "target_not_found", ranked };
  }
  if (ranked.length >= 2) {
    const second = ranked[1];
    const secondOutsideTop = !pointInsideRegion(second.nx, second.ny, top);
    if (second.score >= calibration.ambiguityRatio * top.score && secondOutsideTop) {
      return { outcome: "target_ambiguous", ranked };
    }
  }
  return { outcome: "resolved", ranked };
}

/** The calibration identity recorded in every trace (CU-VISION-15). */
export function calibrationRevisionOf(
  calibration: GroundingCalibration
): string {
  return `gui-actor-calib-a${calibration.ambiguityRatio.toFixed(3)}-t${calibration.absenceThreshold.toFixed(3)}`;
}

export const GUI_ACTOR_DECODING_REVISION = "gui-actor-pointer-centroid-v1";
