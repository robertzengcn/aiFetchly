import { describe, expect, it } from "vitest";
import {
  clampBoundsToWorkArea,
  computeInitialBounds,
  hasMeaningfulIntersection,
  normalizeSavedState,
  selectRestoreDisplay,
  type DisplayWorkArea,
  type SavedMainWindowState,
} from "@/main-process/window/mainWindowGeometry";

function workArea(overrides: Partial<DisplayWorkArea> = {}): DisplayWorkArea {
  return {
    displayId: "primary",
    scaleFactor: 1,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

function savedState(
  overrides: Partial<SavedMainWindowState> = {}
): SavedMainWindowState {
  return {
    version: 1,
    maximized: false,
    normalBounds: { x: 100, y: 100, width: 1280, height: 800 },
    ...overrides,
  };
}

describe("computeInitialBounds (design §14.3, §25.1)", () => {
  it("yields a centered 1280x800 window on a 1920x1080 work area", () => {
    expect(computeInitialBounds(workArea())).toEqual({
      x: 320,
      y: 140,
      width: 1280,
      height: 800,
    });
  });

  it("clamps to the margin box on a small laptop display", () => {
    const bounds = computeInitialBounds(workArea({ width: 1100, height: 720 }));
    // 1100 - 96 = 1004 (< 1280), 720 - 96 = 624 (< 800) — both still above
    // nothing? 624 < 640 practical min → small-display rule for height.
    expect(bounds.width).toBeLessThanOrEqual(1100);
    expect(bounds.height).toBeLessThanOrEqual(720);
    // Still centered.
    expect(bounds.x).toBe(Math.round((1100 - bounds.width) / 2));
  });

  it("keeps the practical minimum when the display allows it", () => {
    // 1280-96=1184 >= 960 but < 1280 → width 1184; 760-96=664 >= 640 → 664.
    const bounds = computeInitialBounds(workArea({ width: 1280, height: 760 }));
    expect(bounds).toEqual({ x: 48, y: 48, width: 1184, height: 664 });
  });

  it("remains reachable on displays smaller than the minimum", () => {
    const bounds = computeInitialBounds(workArea({ width: 800, height: 500 }));
    expect(bounds).toEqual({ x: 16, y: 16, width: 768, height: 468 });
  });

  it("supports negative display coordinates (left-of-primary monitors)", () => {
    const area = workArea({ x: -1920, y: 0, width: 1920, height: 1080 });
    const bounds = computeInitialBounds(area);
    expect(bounds.x).toBe(-1600);
    expect(bounds.y).toBe(140);
  });
});

describe("hasMeaningfulIntersection (design §14.5)", () => {
  it("accepts a mostly on-screen window", () => {
    expect(
      hasMeaningfulIntersection(
        { x: 1800, y: 0, width: 1280, height: 800 },
        workArea()
      )
    ).toBe(true);
  });

  it("rejects a sliver or fully off-screen window", () => {
    expect(
      hasMeaningfulIntersection({ x: 1910, y: 0, width: 1280, height: 800 }, workArea())
    ).toBe(false);
    expect(
      hasMeaningfulIntersection({ x: 5000, y: 5000, width: 1280, height: 800 }, workArea())
    ).toBe(false);
  });
});

describe("clampBoundsToWorkArea (design §14.5)", () => {
  it("keeps a reachable title-bar area for partially off-screen bounds", () => {
    const clamped = clampBoundsToWorkArea(
      { x: 1500, y: 400, width: 1280, height: 800 },
      workArea()
    );
    // The design keeps at least the title bar and edges reachable — the
    // intersection, not full containment (§14.5).
    expect(hasMeaningfulIntersection(clamped, workArea())).toBe(true);
    expect(clamped.x).toBeGreaterThanOrEqual(0);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
  });

  it("pulls fully-off-screen bounds back to the work-area edge", () => {
    const clamped = clampBoundsToWorkArea(
      { x: 5000, y: 5000, width: 1280, height: 800 },
      workArea()
    );
    expect(hasMeaningfulIntersection(clamped, workArea())).toBe(true);
  });

  it("shrinks windows larger than the work area", () => {
    const clamped = clampBoundsToWorkArea(
      { x: 0, y: 0, width: 4000, height: 3000 },
      workArea()
    );
    expect(clamped).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

describe("selectRestoreDisplay (design §14.5, §25.1)", () => {
  const secondary = workArea({
    displayId: "secondary",
    x: 1920,
    width: 1920,
  });

  it("prefers the saved display when it still exists", () => {
    expect(
      selectRestoreDisplay(
        savedState({ displayId: "secondary" }),
        [workArea(), secondary],
        workArea()
      ).displayId
    ).toBe("secondary");
  });

  it("falls back to the display with the greatest intersection", () => {
    const onPrimary = savedState({
      normalBounds: { x: 200, y: 200, width: 1280, height: 800 },
    });
    expect(
      selectRestoreDisplay(onPrimary, [workArea(), secondary], workArea()).displayId
    ).toBe("primary");
  });

  it("falls back to the primary display with no intersection", () => {
    const elsewhere = savedState({
      normalBounds: { x: 9000, y: 9000, width: 1280, height: 800 },
    });
    expect(
      selectRestoreDisplay(elsewhere, [workArea(), secondary], workArea()).displayId
    ).toBe("primary");
  });
});

describe("normalizeSavedState (design §14.5, §25.1)", () => {
  it("accepts a valid saved state and keeps the maximized preference", () => {
    const result = normalizeSavedState(
      savedState({ maximized: true }),
      [workArea()],
      workArea()
    );
    expect(result?.maximized).toBe(true);
    expect(result?.normalBounds).toEqual({ x: 100, y: 100, width: 1280, height: 800 });
  });

  it("rejects corrupt JSON shapes, unsupported versions, and bad numbers", () => {
    for (const bad of [
      null,
      "garbage",
      {},
      { version: 2, maximized: false, normalBounds: { x: 0, y: 0, width: 800, height: 600 } },
      { version: 1, maximized: "yes", normalBounds: { x: 0, y: 0, width: 800, height: 600 } },
      { version: 1, maximized: false, normalBounds: { x: Number.NaN, y: 0, width: 800, height: 600 } },
      { version: 1, maximized: false, normalBounds: { x: 0, y: 0, width: -800, height: 600 } },
      { version: 1, maximized: false, normalBounds: { x: 0, y: 0, width: 1e9, height: 600 } },
    ]) {
      expect(normalizeSavedState(bad, [workArea()], workArea())).toBeNull();
    }
  });

  it("rejects sizes below the safety floor", () => {
    expect(
      normalizeSavedState(
        savedState({ normalBounds: { x: 0, y: 0, width: 100, height: 80 } }),
        [workArea()],
        workArea()
      )
    ).toBeNull();
  });

  it("falls back to null when the saved display is disconnected and nothing intersects", () => {
    const stranded = savedState({
      displayId: "gone",
      normalBounds: { x: 6000, y: 6000, width: 1280, height: 800 },
    });
    expect(normalizeSavedState(stranded, [workArea()], workArea())).toBeNull();
  });

  it("clamps partially off-screen saved bounds onto a connected display", () => {
    const result = normalizeSavedState(
      savedState({ normalBounds: { x: 1500, y: 500, width: 1280, height: 800 } }),
      [workArea()],
      workArea()
    );
    expect(result).not.toBeNull();
    expect(hasMeaningfulIntersection(result!.normalBounds, workArea())).toBe(true);
  });

  it("never derives maximized from anything but the explicit flag", () => {
    // Fullscreen-sized bounds are still ordinary normal bounds (§17.2.6).
    const fullscreenSized = savedState({
      maximized: false,
      normalBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    const result = normalizeSavedState(fullscreenSized, [workArea()], workArea());
    expect(result?.maximized).toBe(false);
  });
});
