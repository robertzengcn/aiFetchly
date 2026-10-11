/**
 * Computer Use safety controls (design §10.5.3, CU-SESSION-09/10).
 *
 * These checks live in the supervisor's dispatch path and run for every
 * session and every action, whatever the adapter or skill text says
 * (decision 13):
 *
 *  - Own-window rejection: a resolved point inside ANY visible AiFetchly
 *    window (main, strip, overlay, dialogs, consent prompts) is rejected
 *    with `own_window`; keyboard input is refused while an AiFetchly window
 *    has focus. This stops the agent approving its own prompts or typing
 *    into AI Chat.
 *  - Elevated-window rejection and host-elevation refusal delegate to
 *    ComputerUseElevationService.
 *  - Stop-hotkey chord actions are refused so injected keystrokes cannot
 *    trigger (or be confused with) the stop hotkey.
 *  - Strip masking: the control strip's screen rectangle is converted into
 *    capture pixels and excluded from every observation used for grounding
 *    or planning (capture exclusion is best-effort; masking is the
 *    guarantee).
 */
import {
  type ComputerUseActionRequest,
  type ComputerUseRect,
  type ComputerUseResolvedTarget,
  type ComputerUseSafetyController,
  type ComputerUseSafetyVerdict,
} from "@/entityTypes/computerUseTypes";
import type { CaptureToExecutorTransform } from "@/service/computerUse/ComputerUseCoordinateTransforms";
import { mapCaptureToExecutor } from "@/service/computerUse/ComputerUseCoordinateTransforms";
import type { ComputerUseElevationService } from "@/service/computerUse/ComputerUseElevationService";
import type { ComputerUseStopHotkeyService } from "@/service/computerUse/ComputerUseStopHotkeyService";

const POINTER_ACTIONS = new Set([
  "click",
  "double_click",
  "right_click",
  "move_pointer",
  "drag",
  "scroll",
]);
const KEYBOARD_ACTIONS = new Set(["type_text", "key", "hotkey"]);

/** Pure point-in-rect test with an inclusive edge margin of 0. */
export function pointInRect(
  x: number,
  y: number,
  rect: ComputerUseRect
): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

/**
 * Providers injected from the Electron main process; each is trivially
 * fakeable in tests. Window bounds arrive ALREADY converted from DIP to
 * physical screen pixels (screen.dipToScreenRect) by the provider.
 */
export interface ComputerUseSafetyProviders {
  /** Visible AiFetchly window rects in physical screen pixels. */
  ownWindowScreenRects(): ComputerUseRect[];
  /** Whether an AiFetchly window currently has keyboard focus. */
  ownWindowFocused(): boolean;
  /** Target process id for elevation checks. */
  targetProcessId(): number | null;
  /** Elevation service (required). */
  elevation: ComputerUseElevationService;
  /** Stop-hotkey service for chord refusal (optional). */
  stopHotkey?: ComputerUseStopHotkeyService;
  /** AiFetchly's process set (app.getAppMetrics() pids, refreshed often). */
  ownProcessIds?: ReadonlySet<number>;
  /** Per-session capture→executor transform provider. */
  captureToExecutorFor?(sessionId: string): CaptureToExecutorTransform | null;
}

export class ComputerUseSafetyService implements ComputerUseSafetyController {
  private readonly providers: ComputerUseSafetyProviders;

  constructor(providers: ComputerUseSafetyProviders) {
    this.providers = providers;
  }

  /** Full pre-dispatch verdict (design §10.5.3 steps 1–3 + chord rule). */
  async preDispatchCheck(input: {
    sessionId: string;
    generation: number;
    request: ComputerUseActionRequest;
    target: ComputerUseResolvedTarget;
  }): Promise<ComputerUseSafetyVerdict> {
    const { request, target } = input;

    // Hotkey-chord refusal (§10.5.1).
    if (this.providers.stopHotkey?.isActionForbidden(request)) {
      return {
        allowed: false,
        errorCode: "permission_denied",
        reason: "action chord matches the stop hotkey",
      };
    }

    // Elevation: unknown integrity fails closed (§10.5.4).
    const targetPid = this.providers.targetProcessId();
    if (targetPid !== null) {
      if (await this.providers.elevation.isTargetElevatedOrUnknown(targetPid)) {
        return {
          allowed: false,
          errorCode: "elevated_window",
          reason: "target runs above AiFetchly's integrity level or unknown",
        };
      }
    }

    if (KEYBOARD_ACTIONS.has(request.actionKind)) {
      // Keyboard input is refused while AiFetchly has focus (§10.5.3).
      if (this.providers.ownWindowFocused()) {
        return {
          allowed: false,
          errorCode: "own_window",
          reason: "an AiFetchly window has keyboard focus",
        };
      }
      return { allowed: true };
    }

    if (POINTER_ACTIONS.has(request.actionKind)) {
      const transform = this.providers.captureToExecutorFor?.(input.sessionId);
      if (!transform) {
        // Fail closed: without the adapter geometry we cannot prove the
        // point avoids AiFetchly's own windows.
        return {
          allowed: false,
          errorCode: "coordinates_invalid",
          reason: "no capture→executor transform available for the session",
        };
      }
      const point = request.point ?? target.capturePoint;
      const executorPoint = mapCaptureToExecutor(transform, point);
      for (const rect of this.providers.ownWindowScreenRects()) {
        if (pointInRect(executorPoint.x, executorPoint.y, rect)) {
          return {
            allowed: false,
            errorCode: "own_window",
            reason: "resolved point lands on an AiFetchly window",
          };
        }
      }
      return { allowed: true };
    }

    // Unknown action kinds are never allowed by default.
    return {
      allowed: false,
      errorCode: "unsupported_target",
      reason: `unknown action kind ${request.actionKind}`,
    };
  }

  /**
   * Target-picker filtering: remove windows owned by AiFetchly's process
   * set (CU-SESSION-10; the picker lists no AiFetchly windows).
   */
  filterSelectableWindows<T extends { processId: number }>(
    windows: readonly T[]
  ): T[] {
    return windows.filter((w) => !this.isOwnProcess(w.processId));
  }

  isOwnProcess(processId: number): boolean {
    return this.providers.ownProcessIds?.has(processId) ?? false;
  }

  /**
   * Compute the strip's rectangle in capture pixels for masking. Returns
   * null when the strip lies entirely outside the capture.
   */
  static stripMaskRect(
    capture: { width: number; height: number },
    captureToExecutor: CaptureToExecutorTransform,
    stripScreenRect: ComputerUseRect
  ): ComputerUseRect | null {
    // Invert the executor mapping: capture = (screen - origin) / scale.
    const x1 = (stripScreenRect.x - captureToExecutor.originX) / captureToExecutor.scaleX;
    const y1 = (stripScreenRect.y - captureToExecutor.originY) / captureToExecutor.scaleY;
    const x2 =
      (stripScreenRect.x + stripScreenRect.width - captureToExecutor.originX) /
      captureToExecutor.scaleX;
    const y2 =
      (stripScreenRect.y + stripScreenRect.height - captureToExecutor.originY) /
      captureToExecutor.scaleY;
    const left = Math.max(0, Math.floor(x1));
    const top = Math.max(0, Math.floor(y1));
    const right = Math.min(capture.width, Math.ceil(x2));
    const bottom = Math.min(capture.height, Math.ceil(y2));
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
}
