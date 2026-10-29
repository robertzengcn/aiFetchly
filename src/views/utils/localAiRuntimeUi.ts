import type { LocalAiRuntimeState } from "@/entityTypes/localAiRuntimeTypes";

/**
 * True when the downloadable local AI runtime is installed and usable for
 * inference. `update_available` still counts as usable — a newer package exists
 * but the active runtime works (PRD §10.4 / §10.6).
 */
export function isLocalAiRuntimeUsable(
  state: LocalAiRuntimeState | undefined
): boolean {
  return state === "ready" || state === "update_available";
}

/**
 * True when the user must install (or repair) the runtime component before
 * local voice/embedding features can run. Matches the install affordance on
 * the System Settings Local AI Components panel.
 */
export function isLocalAiRuntimeInstallRequired(
  state: LocalAiRuntimeState | undefined
): boolean {
  return (
    state === "not_installed" ||
    state === "download_required" ||
    state === "incompatible"
  );
}
