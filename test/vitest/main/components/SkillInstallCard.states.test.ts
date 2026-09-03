/**
 * Install-card state/mode/i18n coverage (final-audit 5; PRD §26.4, NFR-08).
 *
 * - disabled-state rendering (skill disabled by lifecycle op)
 * - linked-target-missing rendering + recovery guidance
 * - rollback_required rendering + recovery guidance
 * - managed-copy vs linked-mode display (mode comes from natural-language
 *   input — the card DISPLAYS it; PRD §9.2 constrains selection to NL,
 *   which this test documents rather than adding a card selector)
 * - exact six-language i18n parity for every installer-card key
 */

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import Card from "@/views/components/aiChatV2/SkillInstallCard.vue";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";
import type { InstallSnapshot } from "@/entityTypes/skillInstallationTypes";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en },
});

function makeSnapshot(
  overrides: Partial<InstallSnapshot> = {}
): InstallSnapshot {
  return {
    sessionId: "sess-s1",
    installationId: null,
    state: "awaiting_approval",
    nextAction: "review-plan",
    planRevision: "rev-s1",
    safeSummary: "source verified",
    recoverable: true,
    ...overrides,
  };
}

function mountCard(snapshot: InstallSnapshot) {
  return mount(Card, {
    props: { snapshot },
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VBtn: {
          template:
            '<button :data-testid="$attrs[\'data-testid\']" @click="$emit(\'click\')"><slot /></button>',
          props: ["loading", "disabled"],
        },
        VIcon: true,
        VChip: { template: "<span><slot /></span>" },
        VProgressLinear: true,
        VSpacer: { template: "<span />" },
        VTextField: true,
      },
    },
  });
}

describe("SkillInstallCard states (final-audit 5)", () => {
  it("renders the disabled state with its label and no action buttons", () => {
    // 'disabled' is an installation STATUS (not a session state) — the
    // card's label/color path must still render it when a lifecycle op
    // reports it. Build the snapshot through an unknown-typed literal.
    const disabledSnapshot = {
      ...makeSnapshot({ state: "cancelled" }),
      state: "disabled",
    } as unknown as InstallSnapshot;
    const wrapper = mountCard(disabledSnapshot);
    const text = wrapper.text();
    expect(text).toContain("Disabled");
    // No approval/secret/retry affordances in a disabled state.
    expect(wrapper.find('[data-testid="skill-install-review"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-testid="skill-install-secret"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-testid="skill-install-failed"]').exists()).toBe(
      false
    );
  });

  it("renders linked-target-missing as a failure with recovery guidance", () => {
    // A linked skill whose external target vanished: the installer reports
    // a failed state whose safeSummary names the link problem.
    const wrapper = mountCard(
      makeSnapshot({
        state: "failed",
        recoverable: true,
        errorCode: "LINK_TARGET_MISSING",
        safeSummary:
          "The linked skill's target directory is missing. Repair the " +
          "link or reinstall with managed copy.",
      })
    );
    expect(wrapper.find('[data-testid="skill-install-failed"]').exists()).toBe(
      true
    );
    expect(wrapper.text()).toContain("linked skill's target directory is missing");
    expect(wrapper.text()).toContain("Retry");
    expect(wrapper.text()).toContain("Cancel");
  });

  it("renders rollback_required with recovery guidance", () => {
    const wrapper = mountCard(
      makeSnapshot({
        state: "rollback_required",
        nextAction: "retry",
        planRevision: null,
        safeSummary:
          "Activation verification failed; rolled back to the previous state.",
      })
    );
    // Error coloring + recovery affordances.
    expect(wrapper.find('[data-testid="skill-install-failed"]').exists()).toBe(
      true
    );
    expect(wrapper.text()).toContain("rolled back");
    expect(wrapper.text()).toContain("Retry");
  });

  it("displays the selected install mode without offering a selector (PRD §9.2)", () => {
    // Mode selection is constrained to natural-language input; the card
    // only DISPLAYS the mode from the structured plan (documented decision
    // in the final audit: no card mode selector).
    const managed = mountCard(
      makeSnapshot({
        safePlan: {
          source: "https://github.com/a/b",
          revision: "rev",
          skills: [],
          dependencies: [],
          credentials: [],
          mode: "managed-copy",
          commands: [],
          warnings: [],
        },
      })
    );
    expect(managed.find('[data-testid="skill-install-plan"]').text()).toContain(
      "managed-copy"
    );

    const linked = mountCard(
      makeSnapshot({
        safePlan: {
          source: "https://github.com/a/b",
          revision: "rev",
          skills: [],
          dependencies: [],
          credentials: [],
          mode: "symbolic-link",
          commands: [],
          warnings: [],
        },
      })
    );
    expect(linked.find('[data-testid="skill-install-plan"]').text()).toContain(
      "symbolic-link"
    );
  });
});

describe("installer-card i18n parity (NFR-08, final-audit 5)", () => {
  const LANGS: ReadonlyArray<{
    readonly code: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly messages: any;
  }> = [
    { code: "en", messages: en },
    { code: "zh", messages: zh },
    { code: "es", messages: es },
    { code: "fr", messages: fr },
    { code: "de", messages: de },
    { code: "ja", messages: ja },
  ];

  function flatten(obj: unknown, prefix = ""): string[] {
    if (typeof obj !== "object" || obj === null) return [prefix];
    return Object.entries(obj).flatMap(([key, value]) =>
      flatten(value, prefix ? `${prefix}.${key}` : key)
    );
  }

  it("every skillInstall key exists with a non-empty value in all six languages", () => {
    const enKeys = flatten(en.skillInstall).sort();
    expect(enKeys.length).toBeGreaterThan(10);
    for (const lang of LANGS) {
      const langKeys = flatten(lang.messages.skillInstall).sort();
      expect(
        langKeys,
        `${lang.code} must have exactly the en key set`
      ).toEqual(enKeys);
    }
  });

  it("no language falls back to the raw key (every value is real text)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collect = (obj: any, prefix = ""): Array<[string, unknown]> => {
      if (typeof obj !== "object" || obj === null) return [[prefix, obj]];
      return Object.entries(obj).flatMap(([key, value]) =>
        collect(value, prefix ? `${prefix}.${key}` : key)
      );
    };
    for (const lang of LANGS) {
      for (const [key, value] of collect(lang.messages.skillInstall)) {
        expect(
          typeof value === "string" && value.trim().length > 0,
          `${lang.code}.${key} must be a non-empty string`
        ).toBe(true);
      }
    }
  });
});
