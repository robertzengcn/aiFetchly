/**
 * I18-01 / D-03 parity test — the `workspaceTrust` i18n group consumed by
 * `WorkspaceTrustCard.vue` (Plan 14-04) must exist in ALL SIX supported
 * language files (en/zh/es/fr/de/ja) with identical key sets and non-empty
 * string values.
 *
 * Canonical key source: `src/views/components/aiChatV2/WorkspaceTrustCard.vue`
 * references every key here via `localized('workspaceTrust.<key>', fallback)`.
 * The component reads these through `te(key) ? t(key) : fallback` — if a key
 * is MISSING from a lang file, the user sees the English fallback in that
 * locale (degraded UX). If a key is missing from `en`, vue-i18n returns the
 * key itself (`workspaceTrust.title`) — visible UI breakage. This test locks
 * the contract so a developer cannot add a key to one lang file without
 * updating the other five.
 *
 * Plan 14-05 <action> listed 7 keys (title/body/preview/trustInstructions/
 * trustAll/keepDisabled/previewEmpty). The component ALSO references
 * `workspaceTrust.trustFailed` in its trust-IPC error paths (Rule 1 deviation
 * — the plan's RESEARCH.md key list was incomplete relative to the actual
 * component). The canonical key set here is the UNION: 8 keys.
 */
import { describe, it, expect } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

// Lang files are default-exported message objects. Index dynamically with a
// permissive record type so structural quirks (slight `common` key drift
// across the six files) do not produce spurious TS errors here.
type LangMessages = Record<string, Record<string, unknown>>;

const LANGS: Record<string, LangMessages> = { en, zh, es, fr, de, ja };

// Canonical key set — see module docstring. MUST match the keys actually
// referenced by WorkspaceTrustCard.vue. Add a key here ONLY when the
// component starts reading it.
const REQUIRED_WORKSPACE_TRUST_KEYS = [
  "title",
  "body",
  "preview",
  "trustInstructions",
  "trustAll",
  "keepDisabled",
  "previewEmpty",
  "trustFailed",
] as const;

const EXPECTED_KEY_SET = [...REQUIRED_WORKSPACE_TRUST_KEYS].sort().join(",");

describe("I18-01 / D-03 — workspaceTrust i18n group parity across all six languages", () => {
  for (const [code, lang] of Object.entries(LANGS)) {
    describe(`${code}: workspaceTrust group`, () => {
      it("has a non-empty workspaceTrust object", () => {
        expect(typeof lang.workspaceTrust).toBe("object");
        expect(lang.workspaceTrust).not.toBeNull();
      });

      for (const key of REQUIRED_WORKSPACE_TRUST_KEYS) {
        it(`has a non-empty string at workspaceTrust.${key}`, () => {
          // Skip if the group itself is absent so the per-key assertion does
          // not cascade a misleading "cannot read property" failure on top of
          // the group-presence assertion above.
          if (typeof lang.workspaceTrust !== "object" || lang.workspaceTrust === null) {
            expect.fail(`workspaceTrust group missing in ${code}`);
          }
          const v = (lang.workspaceTrust as Record<string, unknown>)[key];
          expect(typeof v, `${code}.workspaceTrust.${key} must be a string`).toBe("string");
          expect((v as string).length, `${code}.workspaceTrust.${key} must be non-empty`).toBeGreaterThan(0);
        });
      }
    });
  }

  describe("key-set parity across all six languages", () => {
    it("workspaceTrust key sets are identical across en/zh/es/fr/de/ja", () => {
      const sets = Object.values(LANGS).map((l) =>
        Object.keys(l.workspaceTrust as Record<string, unknown>)
          .sort()
          .join(",")
      );
      const first = sets[0];
      for (let i = 1; i < sets.length; i++) {
        expect(
          sets[i],
          `language ${Object.keys(LANGS)[i]} workspaceTrust keys mismatch (expected ${first}, got ${sets[i]})`
        ).toBe(first);
      }
    });

    it("workspaceTrust key set matches the canonical WorkspaceTrustCard.vue key set", () => {
      for (const [code, lang] of Object.entries(LANGS)) {
        const set = Object.keys(lang.workspaceTrust as Record<string, unknown>)
          .sort()
          .join(",");
        expect(
          set,
          `${code} workspaceTrust key set drift: expected ${EXPECTED_KEY_SET}, got ${set}`
        ).toBe(EXPECTED_KEY_SET);
      }
    });
  });
});
