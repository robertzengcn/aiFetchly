import { describe, expect, it } from "vitest";
import { buildDecisionCandidates } from "@/service/browserDecision/BrowserCandidateBuilder";

/**
 * D-FR-13/14: the shortlist is PRIORITY-ordered — focused/dialog controls
 * surface first so they survive the candidate ceiling; the document-order
 * tail follows.
 */

describe("buildDecisionCandidates priority ordering (D-FR-13/14)", () => {
  const row = (
    ref: string,
    role: string,
    name: string,
    priority?: boolean
  ) => ({
    ref,
    role,
    name,
    disabled: false,
    ...(priority === undefined ? {} : { priority }),
  });

  it("priority controls fill the shortlist before document-order controls", () => {
    // A long page: one focused dialog control at the END of the document,
    // then 20 plain buttons. The ceiling is 8.
    const elements = [
      ...Array.from({ length: 20 }, (_, i) =>
        row(`e_p${i}`, "button", `Plain ${i}`)
      ),
      row("e_dlg", "button", "Dialog confirm", true),
    ];
    const candidates = buildDecisionCandidates({
      elements,
      maxCandidates: 8,
    });
    const ids = candidates.map((c) => c.candidate_id);
    // The priority control is IN the shortlist despite its position.
    expect(ids).toContain("e_dlg");
    // It is FIRST.
    expect(ids[0]).toBe("e_dlg");
    // The ceiling still applies.
    expect(candidates).toHaveLength(8);
  });

  it("priority group is stable (document order within the group)", () => {
    const elements = [
      row("e_late", "button", "Late priority", true),
      row("e_plain", "button", "Plain"),
      row("e_early", "textbox", "Early priority", true),
    ];
    const candidates = buildDecisionCandidates({ elements });
    expect(candidates.map((c) => c.candidate_id)).toEqual([
      "e_late",
      "e_early",
      "e_plain",
    ]);
  });
});
