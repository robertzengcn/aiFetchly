/**
 * Typed primitive theme palettes — the single source of truth for
 * convergence colors (design §7.1). Vuetify themes and semantic SCSS aliases
 * both consume these values; converged pages must not carry literals.
 */

export interface AppThemePalette {
  background: string;
  shell: string;
  sidebar: string;
  surface: string;
  surfaceRaised: string;
  surfaceHover: string;
  surfaceSelected: string;
  border: string;
  borderStrong: string;
  text: string;
  textSoft: string;
  textMuted: string;
  primary: string;
  primarySoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  focus: string;
}

/** Palette key set used by completeness tests (IPR-009). */
export const APP_PALETTE_KEYS = [
  "background",
  "shell",
  "sidebar",
  "surface",
  "surfaceRaised",
  "surfaceHover",
  "surfaceSelected",
  "border",
  "borderStrong",
  "text",
  "textSoft",
  "textMuted",
  "primary",
  "primarySoft",
  "success",
  "successSoft",
  "warning",
  "warningSoft",
  "danger",
  "dangerSoft",
  "focus",
] as const satisfies ReadonlyArray<keyof AppThemePalette>;

/**
 * Dark direction from the approved workspace preview: near-black canvas,
 * neutral dark surfaces, low-contrast separators, restrained burnt-orange
 * accent reserved for selection/primary actions (PRD §9.1).
 */
export const aifetchlyDark: AppThemePalette = {
  background: "#101014",
  shell: "#14141a",
  sidebar: "#17171e",
  surface: "#1a1a22",
  surfaceRaised: "#20202a",
  surfaceHover: "#26262f",
  surfaceSelected: "#2c2622",
  border: "#26262e",
  borderStrong: "#3a3a44",
  text: "#e9e9ec",
  textSoft: "#b9b9c0",
  textMuted: "#8a8a93",
  primary: "#d97a3c",
  primarySoft: "rgba(217, 122, 60, 0.16)",
  success: "#4fb286",
  successSoft: "rgba(79, 178, 134, 0.14)",
  warning: "#d9a13c",
  warningSoft: "rgba(217, 161, 60, 0.14)",
  danger: "#d95c5c",
  dangerSoft: "rgba(217, 92, 92, 0.14)",
  focus: "#e8925a",
};

/** Complete semantic light counterpart with equivalent contrast roles. */
export const aifetchlyLight: AppThemePalette = {
  background: "#f4f4f6",
  shell: "#ffffff",
  sidebar: "#fafafb",
  surface: "#ffffff",
  surfaceRaised: "#ffffff",
  surfaceHover: "#efeff2",
  surfaceSelected: "#f7ece3",
  border: "#e4e4e8",
  borderStrong: "#c9c9d0",
  text: "#1c1c22",
  textSoft: "#4a4a55",
  textMuted: "#75757f",
  primary: "#b85f22",
  primarySoft: "rgba(184, 95, 34, 0.12)",
  success: "#2e8b62",
  successSoft: "rgba(46, 139, 98, 0.12)",
  warning: "#a87514",
  warningSoft: "rgba(168, 117, 20, 0.12)",
  danger: "#bd3d3d",
  dangerSoft: "rgba(189, 61, 61, 0.12)",
  focus: "#a8551f",
};

export type ThemeName = "aifetchlyDark" | "aifetchlyLight";

export function paletteFor(theme: ThemeName): AppThemePalette {
  return theme === "aifetchlyDark" ? aifetchlyDark : aifetchlyLight;
}
