/**
 * Component tests for PluginInstallSourceDialog (git-free GitHub plugin
 * installation PRD §20.6 / design §18.8): the no-Git/no-token helper,
 * capability gating, typed error mapping, working state, and the
 * operationId-keyed cancellation contract.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PluginInstallSourceDialog from "@/views/components/plugins/PluginInstallSourceDialog.vue";
import en from "@/views/lang/en";

vi.mock("@/views/api/plugins", () => ({
  installPluginFromSource: vi.fn(),
  getPluginInstallCapabilities: vi.fn(),
  cancelPluginInstall: vi.fn(),
}));

import {
  installPluginFromSource,
  getPluginInstallCapabilities,
} from "@/views/api/plugins";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en },
});

function mountDialog() {
  return mount(PluginInstallSourceDialog, {
    props: { modelValue: true },
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: {
          template: '<div v-if="modelValue"><slot /></div>',
          props: ["modelValue"],
        },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VSelect: {
          props: ["modelValue", "label", "items"],
          emits: ["update:modelValue"],
          template:
            "<select data-testid=\"kind-select\" :value=\"modelValue\" @change=\"$emit('update:modelValue', $event.target.value)\"><option v-for=\"item in items\" :key=\"item.value\" :value=\"item.value\">{{ item.label }}</option></select>",
        },
        VTextField: {
          props: ["modelValue", "label", "placeholder", "hint", "type"],
          emits: ["update:modelValue"],
          template:
            "<input :aria-label=\"label\" :value=\"modelValue\" @input=\"$emit('update:modelValue', $event.target.value)\" />",
        },
        VBtn: {
          template:
            "<button :data-testid=\"$attrs['data-testid']\" :loading=\"loading\" :disabled=\"disabled\" @click=\"$emit('click')\"><slot /></button>",
          props: ["loading", "disabled"],
        },
        VAlert: { template: "<div><slot /></div>" },
        VSpacer: { template: "<span />" },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPluginInstallCapabilities).mockResolvedValue({
    githubArchiveInstallEnabled: true,
  });
});

/** Switch to the github kind and fill a repository URL so Install enables. */
async function selectGithubWithUri(wrapper: Awaited<ReturnType<typeof mountDialog>>) {
  await wrapper.find('[data-testid="kind-select"]').setValue("github");
  await flushPromises();
  const uriInput = wrapper
    .findAll("input")
    .find((i) => (i.element as HTMLInputElement).value === "");
  if (uriInput) await uriInput.setValue("https://github.com/owner/repo");
  await flushPromises();
}

describe("PluginInstallSourceDialog — git-free GitHub UX", () => {
  it("shows the no-Git/no-token helper on the GitHub source (capability on)", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    const kind = wrapper.find('[data-testid="kind-select"]');
    await kind.setValue("github");
    await flushPromises();
    expect(wrapper.find('[data-testid="github-no-git-hint"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("without Git or a GitHub token");
  });

  it("hides the no-Git helper when the main process disabled archive install", async () => {
    vi.mocked(getPluginInstallCapabilities).mockResolvedValue({
      githubArchiveInstallEnabled: false,
    });
    const wrapper = mountDialog();
    await flushPromises();
    const kind = wrapper.find('[data-testid="kind-select"]');
    await kind.setValue("github");
    await flushPromises();
    expect(wrapper.find('[data-testid="github-no-git-hint"]').exists()).toBe(false);
  });

  it("shows the local-Git-required helper on the Git source", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    const kind = wrapper.find('[data-testid="kind-select"]');
    await kind.setValue("git");
    await flushPromises();
    expect(wrapper.find('[data-testid="git-local-hint"]').exists()).toBe(true);
  });

  it("sends a UUID operationId with the install request", async () => {
    vi.mocked(installPluginFromSource).mockResolvedValue({
      success: true,
      plugin: {
        id: 1,
        name: "p",
        version: "1",
        source: "local" as const,
        enabled: true,
        health: "healthy" as const,
        skillCount: 0,
        mcpServerCount: 0,
        agentCount: 0,
        commandCount: 0,
        hookCount: 0,
        permissions: [],
        lastUpdated: "2026-09-13T00:00:00.000Z",
      },
    });
    const wrapper = mountDialog();
    await selectGithubWithUri(wrapper);
    await wrapper.find('[data-testid="install-btn"]').trigger("click");
    await flushPromises();
    const call = vi.mocked(installPluginFromSource).mock.calls[0]?.[0];
    expect(call?.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(wrapper.emitted("imported")).toBeTruthy();
  });

  it("maps git-not-installed to the localized guidance; unknown codes fall back to the safe message", async () => {
    vi.mocked(installPluginFromSource).mockResolvedValue({
      success: false,
      errors: [
        {
          code: "git-not-installed",
          message: "internal",
          recoverable: true,
        },
      ],
    });
    let wrapper = mountDialog();
    await selectGithubWithUri(wrapper);
    await wrapper.find('[data-testid="install-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Git is not installed or cannot be found");

    vi.mocked(installPluginFromSource).mockResolvedValue({
      success: false,
      errors: [{ code: "brand-new-code", message: "SAFE MESSAGE", recoverable: true }],
    });
    wrapper = mountDialog();
    await selectGithubWithUri(wrapper);
    await wrapper.find('[data-testid="install-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("SAFE MESSAGE");
  });

  it("user cancellation shows no failure alert", async () => {
    vi.mocked(installPluginFromSource).mockResolvedValue({
      success: false,
      errors: [{ code: "source-cancelled", message: "cancelled", recoverable: true }],
    });
    const wrapper = mountDialog();
    await selectGithubWithUri(wrapper);
    await wrapper.find('[data-testid="install-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("cancelled");
    expect(wrapper.text()).not.toContain("Install failed.");
  });
});
