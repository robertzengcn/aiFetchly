import { describe, expect, it } from "vitest";

/**
 * Schedule inspector layout (docked-column change 2026-10-26): jsdom does
 * not lay out flexbox, so the push-column truth is pinned on the CSS
 * source — wide mode must be an in-flow shell column (no fixed overlay),
 * while the `.overlay` drawer variant (narrow/medium) keeps its absolute
 * positioning, width cap and floating shadow.
 */
describe("ScheduleInspector layout (in-flow wide, drawer overlay)", () => {
  it("declares in-flow wide mode and an absolute overlay drawer variant", async () => {
    const source = (
      await import(
        "@/views/components/appShell/inspectors/ScheduleInspector.vue?raw"
      )
    ).default as string;

    const base = /\.app-inspector \{[^}]*\}/.exec(source)?.[0] ?? "";
    expect(base).toContain(".app-inspector");
    expect(/\bposition:\s*fixed/.test(base)).toBe(false);
    expect(/\bheight:\s*100%/.test(base)).toBe(true);

    const overlay = /\.app-inspector\.overlay \{[^}]*\}/.exec(source)?.[0] ?? "";
    expect(overlay).toContain("position: absolute");
    expect(overlay).toContain("width: min(92vw, 520px)");
    expect(/box-shadow/.test(overlay)).toBe(true);
  });
});
