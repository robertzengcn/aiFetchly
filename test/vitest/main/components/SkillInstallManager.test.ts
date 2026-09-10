/**
 * Component tests for SkillInstallManager (PRD §22.3, NFR-08): the
 * skill-management detail surface — listing, detail fields, lifecycle
 * actions, and the destructive-uninstall confirmation.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SkillInstallManager from "@/views/components/aiChatV2/SkillInstallManager.vue";
import en from "@/views/lang/en";

vi.mock("@/views/api/skillInstallation", () => ({
  listSkillInstallations: vi.fn(),
  updateSkillInstall: vi.fn(),
  repairSkillInstall: vi.fn(),
  disableSkillInstall: vi.fn(),
  enableSkillInstall: vi.fn(),
  uninstallSkillInstall: vi.fn(),
}));

import {
  listSkillInstallations,
  repairSkillInstall,
  disableSkillInstall,
  enableSkillInstall,
  uninstallSkillInstall,
} from "@/views/api/skillInstallation";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en },
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    installationId: "inst-1",
    name: "video-use",
    kind: "prompt",
    sourceUri: "https://github.com/browser-use/video-use",
    sourceRevision: "abc123def456",
    activationMode: "managed-copy",
    status: "ready",
    enabled: true,
    updatedAt: "2026-09-10T00:00:00.000Z",
    credentialNames: ["ELEVENLABS_API_KEY"],
    ...overrides,
  };
}

function mountManager() {
  return mount(SkillInstallManager, {
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VDivider: true,
        VIcon: true,
        VSpacer: { template: "<span />" },
        VBtn: {
          template:
            "<button :data-testid=\"$attrs['data-testid']\" :loading=\"loading\" @click=\"$emit('click')\"><slot /></button>",
          props: ["loading", "disabled"],
        },
        VChip: { template: "<span><slot /></span>" },
        VExpansionPanels: { template: "<div><slot /></div>" },
        VExpansionPanel: { template: "<div><slot /></div>" },
        VExpansionPanelTitle: { template: "<div><slot /></div>" },
        VExpansionPanelText: { template: "<div><slot /></div>" },
        VDialog: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<div v-if="modelValue" :data-testid="$attrs[\'data-testid\']"><slot /></div>',
        },
        VCheckbox: {
          props: ["modelValue", "label"],
          emits: ["update:modelValue"],
          template:
            "<label><input type=\"checkbox\" :checked=\"modelValue\" @change=\"$emit('update:modelValue', $event.target.checked)\" /> {{ label }}</label>",
        },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkillInstallManager", () => {
  it("lists installations with the §22.3 detail fields", async () => {
    vi.mocked(listSkillInstallations).mockResolvedValue([makeRow()]);
    const wrapper = mountManager();
    await flushPromises();
    expect(listSkillInstallations).toHaveBeenCalled();
    expect(wrapper.text()).toContain("video-use");
    expect(wrapper.text()).toContain("https://github.com/browser-use/video-use");
    expect(wrapper.text()).toContain("managed-copy");
    // Credential NAMES render; values never exist here.
    expect(wrapper.text()).toContain("ELEVENLABS_API_KEY");
    expect(wrapper.find('[data-testid="skill-install-manager-empty"]').exists()).toBe(false);
  });

  it("shows the empty state when nothing is installed", async () => {
    vi.mocked(listSkillInstallations).mockResolvedValue([]);
    const wrapper = mountManager();
    await flushPromises();
    expect(wrapper.find('[data-testid="skill-install-manager-empty"]').exists()).toBe(true);
  });

  it("repair renders its per-check report", async () => {
    vi.mocked(listSkillInstallations).mockResolvedValue([makeRow()]);
    vi.mocked(repairSkillInstall).mockResolvedValue({
      ok: true,
      checks: [
        { name: "activation-readable", passed: true, detail: "/x" },
        { name: "content-hash-matches", passed: false, detail: "changed" },
      ],
      repaired: [],
    });
    const wrapper = mountManager();
    await flushPromises();
    await wrapper.find('[data-testid="skill-install-manager-repair-btn"]').trigger("click");
    await flushPromises();
    expect(repairSkillInstall).toHaveBeenCalledWith({ installationId: "inst-1" });
    expect(wrapper.find('[data-testid="skill-install-manager-repair"]').text()).toContain(
      "content-hash-matches"
    );
  });

  it("disable/enable toggle flows through the lifecycle API", async () => {
    vi.mocked(listSkillInstallations).mockResolvedValue([makeRow()]);
    vi.mocked(disableSkillInstall).mockResolvedValue({
      disabled: true,
      deactivatedInvocations: 0,
    });
    const wrapper = mountManager();
    await flushPromises();
    await wrapper.find('[data-testid="skill-install-manager-toggle"]').trigger("click");
    await flushPromises();
    expect(disableSkillInstall).toHaveBeenCalledWith("inst-1");

    // Disabled row toggles back via enable.
    vi.mocked(listSkillInstallations).mockResolvedValue([
      makeRow({ enabled: false, status: "disabled" }),
    ]);
    vi.mocked(enableSkillInstall).mockResolvedValue(true);
    await wrapper.find('[data-testid="skill-install-manager-refresh"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="skill-install-manager-toggle"]').trigger("click");
    await flushPromises();
    expect(enableSkillInstall).toHaveBeenCalledWith("inst-1");
  });

  it("uninstall requires confirmation and honors the secrets choice", async () => {
    vi.mocked(listSkillInstallations).mockResolvedValue([makeRow()]);
    vi.mocked(uninstallSkillInstall).mockResolvedValue({
      ok: true,
      removed: "directory",
      targetPreserved: null,
      secretsDeleted: 1,
      deactivatedInvocations: 0,
    });
    const wrapper = mountManager();
    await flushPromises();

    // Destructive action opens the confirmation, not the API.
    await wrapper.find('[data-testid="skill-install-manager-uninstall"]').trigger("click");
    await flushPromises();
    expect(uninstallSkillInstall).not.toHaveBeenCalled();
    expect(
      wrapper.find('[data-testid="skill-install-manager-uninstall-dialog"]').exists()
    ).toBe(true);

    // Default choice deletes secrets.
    await wrapper
      .find('[data-testid="skill-install-manager-uninstall-confirm"]')
      .trigger("click");
    await flushPromises();
    expect(uninstallSkillInstall).toHaveBeenCalledWith({
      installationId: "inst-1",
      deleteSecrets: true,
    });
  });
});
