/**
 * Decide how the already-running process should react when the user launches
 * the app again (Electron `second-instance`).
 *
 * A stuck first process with no healthy renderer used to only "focus" nothing
 * useful, leaving the user unable to recover without a reboot. Recreate when
 * there is no live window or the renderer never finished loading.
 */
export type SecondInstanceWindowAction = "focus" | "recreate";

export interface SecondInstanceWindowState {
  hasLiveWindow: boolean;
  rendererHtmlLoaded: boolean;
}

export function resolveSecondInstanceWindowAction(
  state: SecondInstanceWindowState
): SecondInstanceWindowAction {
  if (!state.hasLiveWindow || !state.rendererHtmlLoaded) {
    return "recreate";
  }
  return "focus";
}
