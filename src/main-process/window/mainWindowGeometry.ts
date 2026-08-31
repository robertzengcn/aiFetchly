/**
 * Pure main-window geometry (chat-first shell design §14.2).
 *
 * NO Electron imports: every function is pure and unit-testable. The
 * Electron-facing service (MainWindowStateService) supplies display data and
 * consumes these decisions. All values are display-independent pixels —
 * never multiply by scaleFactor (design §14.3).
 */

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DisplayWorkArea extends WindowBounds {
  readonly displayId: string;
  readonly scaleFactor: number;
}

export interface SavedMainWindowState {
  readonly version: 1;
  readonly normalBounds: WindowBounds;
  readonly maximized: boolean;
  readonly displayId?: string;
}

/** Preferred first-launch content size (design §14.3). */
export const PREFERRED_WIDTH = 1280;
export const PREFERRED_HEIGHT = 800;

/** Preferred margin on each side when the display allows it. */
export const PREFERRED_MARGIN = 48;

/** Practical minimum content size when the display allows it. */
export const PRACTICAL_MIN_WIDTH = 960;
export const PRACTICAL_MIN_HEIGHT = 640;

/** Minimum margin when the display is smaller than the practical minimum. */
export const SMALL_DISPLAY_MARGIN = 16;

/** Saved-state validity floors: anything smaller (or larger) is corrupt. */
export const MIN_VALID_WIDTH = 320;
export const MIN_VALID_HEIGHT = 240;
export const MAX_VALID_DIMENSION = 20_000;

/**
 * A saved rectangle must keep at least this much of the title bar reachable
 * (width x height of intersection) to count as on-screen (design §14.5).
 */
export const MIN_INTERSECTION_WIDTH = 120;
export const MIN_INTERSECTION_HEIGHT = 32;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function right(bounds: WindowBounds): number {
  return bounds.x + bounds.width;
}

function bottom(bounds: WindowBounds): number {
  return bounds.y + bounds.height;
}

/** Center one dimension inside a span. */
function centered(size: number, spanStart: number, spanSize: number): number {
  return Math.round(spanStart + Math.max(0, (spanSize - size) / 2));
}

/**
 * First-launch bounds (design §14.3): preferred 1280x800 inside the work
 * area with 48px margins, a practical 960x640 minimum when the display
 * allows it, work-area-minus-16px on smaller displays, centered. Never
 * maximized.
 */
export function computeInitialBounds(workArea: DisplayWorkArea): WindowBounds {
  const marginBoxWidth = workArea.width - PREFERRED_MARGIN * 2;
  const marginBoxHeight = workArea.height - PREFERRED_MARGIN * 2;

  let width: number;
  let height: number;
  if (
    marginBoxWidth >= PRACTICAL_MIN_WIDTH &&
    marginBoxHeight >= PRACTICAL_MIN_HEIGHT
  ) {
    width = Math.min(PREFERRED_WIDTH, marginBoxWidth);
    height = Math.min(PREFERRED_HEIGHT, marginBoxHeight);
  } else {
    // Display smaller than the practical minimum: use all available work
    // area minus a 16px margin on each side so controls stay reachable.
    width = Math.max(1, workArea.width - SMALL_DISPLAY_MARGIN * 2);
    height = Math.max(1, workArea.height - SMALL_DISPLAY_MARGIN * 2);
  }
  return {
    x: centered(width, workArea.x, workArea.width),
    y: centered(height, workArea.y, workArea.height),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * Whether the rectangle keeps a meaningful (title-bar sized) portion inside
 * the work area (design §14.5).
 */
export function hasMeaningfulIntersection(
  bounds: WindowBounds,
  workArea: DisplayWorkArea
): boolean {
  const overlapWidth = Math.min(right(bounds), right(workArea)) - Math.max(bounds.x, workArea.x);
  const overlapHeight = Math.min(bottom(bounds), bottom(workArea)) - Math.max(bounds.y, workArea.y);
  return (
    overlapWidth >= MIN_INTERSECTION_WIDTH &&
    overlapHeight >= MIN_INTERSECTION_HEIGHT
  );
}

/**
 * Clamp partially off-screen bounds so at least the title bar and resizing
 * edges remain reachable inside the work area (design §14.5). Oversized
 * windows shrink to the work area.
 */
export function clampBoundsToWorkArea(
  bounds: WindowBounds,
  workArea: DisplayWorkArea
): WindowBounds {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const maxX = workArea.x + workArea.width - MIN_INTERSECTION_WIDTH;
  const maxY = workArea.y + workArea.height - MIN_INTERSECTION_HEIGHT;
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, workArea.x), Math.max(workArea.x, maxX)),
    y: Math.min(Math.max(bounds.y, workArea.y), Math.max(workArea.y, maxY)),
  };
}

/**
 * Choose the display a saved state restores onto (design §14.5): the saved
 * display when it still exists, else the display with the greatest
 * intersection, else the primary display.
 */
export function selectRestoreDisplay(
  saved: SavedMainWindowState,
  displays: readonly DisplayWorkArea[],
  primary: DisplayWorkArea
): DisplayWorkArea {
  if (saved.displayId) {
    const byId = displays.find((d) => d.displayId === saved.displayId);
    if (byId) return byId;
  }
  let best: DisplayWorkArea | null = null;
  let bestArea = 0;
  for (const display of displays) {
    const overlapWidth =
      Math.min(right(saved.normalBounds), right(display)) -
      Math.max(saved.normalBounds.x, display.x);
    const overlapHeight =
      Math.min(bottom(saved.normalBounds), bottom(display)) -
      Math.max(saved.normalBounds.y, display.y);
    const area =
      overlapWidth > 0 && overlapHeight > 0 ? overlapWidth * overlapHeight : 0;
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }
  return best ?? primary;
}

function isValidBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    !isFiniteNumber(candidate.x) ||
    !isFiniteNumber(candidate.y) ||
    !isFiniteNumber(candidate.width) ||
    !isFiniteNumber(candidate.height)
  ) {
    return false;
  }
  return (
    candidate.width >= MIN_VALID_WIDTH &&
    candidate.height >= MIN_VALID_HEIGHT &&
    candidate.width <= MAX_VALID_DIMENSION &&
    candidate.height <= MAX_VALID_DIMENSION
  );
}

/**
 * Validate a raw saved value (design §14.5): supported version, finite
 * coordinates, safe sizes, and a meaningful intersection with a connected
 * display. Returns the normalized state — clamped into the chosen display —
 * or null when the caller must fall back to centered defaults.
 */
export function normalizeSavedState(
  saved: unknown,
  displays: readonly DisplayWorkArea[],
  primary: DisplayWorkArea
): SavedMainWindowState | null {
  if (!saved || typeof saved !== "object") return null;
  const candidate = saved as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.maximized !== "boolean") return null;
  if (!isValidBounds(candidate.normalBounds)) return null;
  const normalized: SavedMainWindowState = {
    version: 1,
    normalBounds: candidate.normalBounds,
    maximized: candidate.maximized,
    ...(typeof candidate.displayId === "string"
      ? { displayId: candidate.displayId }
      : {}),
  };
  const display = selectRestoreDisplay(normalized, displays, primary);
  if (!hasMeaningfulIntersection(normalized.normalBounds, display)) {
    return null;
  }
  return {
    ...normalized,
    normalBounds: clampBoundsToWorkArea(normalized.normalBounds, display),
  };
}
