import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import CommunityPluginCard from "@/views/components/plugins/CommunityPluginCard.vue";
import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";

/**
 * Provide real English strings so `t()` resolves (vue-i18n returns the key,
 * not undefined, for missing keys — so `t('x') || 'English'` would otherwise
 * yield the key string and never the fallback).
 */
const messages = {
  en: {
    communityPlugins: {
      install: "Install",
      preview: "Preview",
      upgrade: "Upgrade",
      signIn: "Sign in",
      installFuture: "Installable in a future release.",
      manage: "Manage",
      moreTagCount: "{count} more tags",
      statusInstalled: "Installed",
      statusUpgradeRequired: "Upgrade required",
      statusSignInRequired: "Sign in required",
      statusComingSoon: "Coming soon",
      statusUnavailable: "Unavailable",
    },
  },
};

const i18n = createI18n({ legacy: false, locale: "en", messages });

function entry(
  overrides: Partial<PluginCommunityEntry> = {}
): PluginCommunityEntry {
  return {
    slug: "pdf-tools",
    name: "pdf-tools",
    displayName: "PDF Tools",
    description: "Extract, transform, and process PDF documents.",
    owner: "AiFetchly",
    category: "Productivity",
    tags: ["PDF", "Documents", "Automation", "Extra"],
    access: { status: "allowed", installMode: "direct" },
    installed: false,
    ...overrides,
  };
}

function mountCard(
  overrides: Partial<PluginCommunityEntry> = {},
  props: { installing?: boolean; installBusy?: boolean } = {}
) {
  return mount(CommunityPluginCard, {
    global: { plugins: [i18n] },
    props: {
      entry: entry(overrides),
      installing: props.installing ?? false,
      installBusy: props.installBusy ?? false,
    },
  });
}

describe("CommunityPluginCard", () => {
  it("renders an installed entry with an Installed status chip and Manage action", () => {
    const w = mountCard({ installed: true });
    expect(
      w.find('[data-testid="community-plugin-status-pdf-tools"]').exists()
    ).toBe(true);
    expect(
      w.find('[data-testid="community-plugin-manage-pdf-tools"]').exists()
    ).toBe(true);
    // No Install button on an installed card.
    expect(
      w.find('[data-testid="community-plugin-install-pdf-tools"]').exists()
    ).toBe(false);
  });

  it("emits install with the entry when the Install action is clicked", () => {
    const w = mountCard();
    w.find('[data-testid="community-plugin-install-pdf-tools"]').trigger(
      "click"
    );
    const events = w.emitted("install");
    expect(events).toHaveLength(1);
    expect(events![0][0]).toMatchObject({ slug: "pdf-tools" });
  });

  it("emits manage with the entry when the Manage action is clicked", () => {
    const w = mountCard({ installed: true });
    w.find('[data-testid="community-plugin-manage-pdf-tools"]').trigger(
      "click"
    );
    expect(w.emitted("manage")).toHaveLength(1);
    expect(w.emitted("manage")![0][0]).toMatchObject({ slug: "pdf-tools" });
  });

  it("shows Coming soon status and a disabled Preview button for a ticket entry", () => {
    const w = mountCard({
      access: { status: "allowed", installMode: "ticket" },
    });
    expect(
      w.find('[data-testid="community-plugin-status-pdf-tools"]').text()
    ).toContain("Coming soon");
    const preview = w.find(
      '[data-testid="community-plugin-preview-pdf-tools"]'
    );
    expect(preview.exists()).toBe(true);
    // Bare `disabled` attr renders as "" on custom elements — present, not "true".
    expect(preview.attributes("disabled")).toBe("");
    // The explanation is keyboard-reachable: the disabled button is wrapped in
    // a focusable span whose aria-label carries the Preview + Coming-soon text
    // (PRD §16.11 / tech design §15.4 — a disabled button alone is not focusable).
    const wrap = w.find(
      '[data-testid="community-plugin-preview-wrap-pdf-tools"]'
    );
    expect(wrap.exists()).toBe(true);
    expect(wrap.attributes("tabindex")).toBe("0");
    expect(wrap.attributes("aria-label") ?? "").toContain("Preview");
    expect(wrap.attributes("aria-label") ?? "").toContain("future release");
  });

  it("emits upgrade for a subscription-required entry", () => {
    const w = mountCard({
      access: { status: "subscription_required", installMode: "ticket" },
    });
    w.find('[data-testid="community-plugin-upgrade-pdf-tools"]').trigger(
      "click"
    );
    expect(w.emitted("upgrade")).toHaveLength(1);
  });

  it("emits signin for a login-required entry", () => {
    const w = mountCard({
      access: { status: "login_required", installMode: "direct" },
    });
    w.find('[data-testid="community-plugin-signin-pdf-tools"]').trigger(
      "click"
    );
    expect(w.emitted("signin")).toHaveLength(1);
  });

  it("renders readable Unavailable status and no action for forbidden entries", () => {
    const w = mountCard({
      access: { status: "forbidden", installMode: "direct" },
    });
    expect(
      w.find('[data-testid="community-plugin-status-pdf-tools"]').text()
    ).toContain("Unavailable");
    expect(
      w.find('[data-testid="community-plugin-unavailable-pdf-tools"]').exists()
    ).toBe(true);
    // No interactive action buttons.
    for (const action of [
      "install",
      "manage",
      "upgrade",
      "signin",
      "preview",
    ]) {
      expect(
        w.find(`[data-testid="community-plugin-${action}-pdf-tools"]`).exists()
      ).toBe(false);
    }
  });

  it("renders at most three visible tags plus an overflow count chip", () => {
    const w = mountCard();
    const chips = w.findAll(".community-plugin-card__body v-chip");
    // 4 tags → 3 visible + 1 overflow chip.
    expect(chips.length).toBe(4);
  });

  it("renders description, owner, and category metadata", () => {
    const w = mountCard();
    expect(w.text()).toContain(
      "Extract, transform, and process PDF documents."
    );
    expect(w.text()).toContain("AiFetchly");
    expect(w.text()).toContain("Productivity");
  });

  it("exposes the complete description to keyboard users (AC-UI-03 / a11y §16.12)", () => {
    const w = mountCard();
    const desc = w.find(
      '[data-testid="community-plugin-description-pdf-tools"]'
    );
    expect(desc.exists()).toBe(true);
    // Focusable so keyboard users can reach it.
    expect(desc.attributes("tabindex")).toBe("0");
    // The full text is in the accessibility tree (not only the clamped copy).
    expect(desc.attributes("aria-label")).toBe(
      "Extract, transform, and process PDF documents."
    );
  });

  it("uses stable data-testid values independent of translated labels", () => {
    const w = mountCard({ installed: true });
    expect(
      w.find('[data-testid="community-plugin-card-pdf-tools"]').exists()
    ).toBe(true);
    expect(
      w.find('[data-testid="community-plugin-status-pdf-tools"]').exists()
    ).toBe(true);
    expect(
      w.find('[data-testid="community-plugin-manage-pdf-tools"]').exists()
    ).toBe(true);
  });

  it("does not apply blanket opacity to unavailable cards", () => {
    const w = mountCard({
      access: { status: "forbidden", installMode: "direct" },
    });
    // The unavailable card uses a muted surface class, never the legacy opacity class.
    expect(w.find(".community-plugin-unavailable").exists()).toBe(false);
    expect(w.find(".community-plugin-card--unavailable").exists()).toBe(true);
  });

  it("shows loading on the Install button whose install is in flight", () => {
    // The card binds :loading="installing" (this card) and :disabled="installBusy"
    // (other cards). An in-flight install shows loading, NOT self-disable.
    const w = mountCard({}, { installing: true });
    const installBtn = w.find(
      '[data-testid="community-plugin-install-pdf-tools"]'
    );
    expect(installBtn.attributes("loading")).toBe("true");
    // Not disabled by its own install (installBusy is false here).
    expect(installBtn.attributes("disabled")).toBe("false");
  });

  it("does not show loading when no install is in flight", () => {
    const w = mountCard();
    expect(
      w
        .find('[data-testid="community-plugin-install-pdf-tools"]')
        .attributes("loading")
    ).toBe("false");
  });

  it("disables Install buttons on other cards when a global install is in flight", () => {
    const w = mountCard({}, { installBusy: true });
    expect(
      w
        .find('[data-testid="community-plugin-install-pdf-tools"]')
        .attributes("disabled")
    ).toBe("true");
  });
});
