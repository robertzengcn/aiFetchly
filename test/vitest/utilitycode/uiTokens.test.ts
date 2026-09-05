import { describe, expect, it } from "vitest";
import {
  aifetchlyDark,
  aifetchlyLight,
  APP_PALETTE_KEYS,
  paletteFor,
} from "@/views/design/tokens";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const SOFT = /^rgba?\(/i;

describe("convergence token palettes (IPR-009..013)", () => {
  it("both themes define the complete semantic key set", () => {
    for (const palette of [aifetchlyDark, aifetchlyLight]) {
      for (const key of APP_PALETTE_KEYS) {
        expect(typeof palette[key]).toBe("string");
        expect(palette[key].length).toBeGreaterThan(0);
      }
    }
  });

  it("uses solid hex for structural colors and rgba only for tone softs", () => {
    // Only the four accent tone-softs are translucent; every other key
    // (including textSoft) is a solid structural value.
    const toneSoftKeys = ["primarySoft", "successSoft", "warningSoft", "dangerSoft"] as const;
    const solidKeys = APP_PALETTE_KEYS.filter(
      (k) => !(toneSoftKeys as readonly string[]).includes(k)
    ) as ReadonlyArray<keyof typeof aifetchlyDark>;
    for (const palette of [aifetchlyDark, aifetchlyLight]) {
      for (const key of solidKeys) {
        expect(HEX.test(palette[key])).toBe(true);
      }
      for (const key of toneSoftKeys) {
        expect(SOFT.test(palette[key])).toBe(true);
      }
    }
  });

  it("keeps dark surfaces darker than their borders and text readable", () => {
    const luminance = (hex: string): number => {
      const v = hex.replace("#", "");
      const r = parseInt(v.slice(0, 2), 16) / 255;
      const g = parseInt(v.slice(2, 4), 16) / 255;
      const b = parseInt(v.slice(4, 6), 16) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(luminance(aifetchlyDark.background)).toBeLessThan(
      luminance(aifetchlyDark.surface)
    );
    expect(luminance(aifetchlyDark.surface)).toBeLessThan(
      luminance(aifetchlyDark.border)
    );
    // Text on canvas keeps WCAG AA-scale contrast in both themes.
    expect(
      luminance(aifetchlyDark.text) - luminance(aifetchlyDark.background)
    ).toBeGreaterThan(0.45);
    expect(
      luminance(aifetchlyLight.background) - luminance(aifetchlyLight.text)
    ).toBeGreaterThan(0.35);
  });

  it("reserves the burnt-orange accent consistently across themes", () => {
    expect(aifetchlyDark.primary).not.toBe(aifetchlyLight.primary);
    expect(paletteFor("aifetchlyDark")).toBe(aifetchlyDark);
    expect(paletteFor("aifetchlyLight")).toBe(aifetchlyLight);
  });
});
