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
  messages: {
    en: {
      ...en,
      plugins: {
        ...en.plugins,
        install_source: {
          ...en.plugins?.install_source,
          working_archive: "Resolving the revision and downloading the archive…",
          "error_source-cancelled": "Installation cancelled.",
        },
      },
    },
  },
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
            "<input v-bind=\"$attrs\" :aria-label=\"label\" :value=\"modelValue\" @input=\"$emit('update:modelValue', $event.target.value)\" />",
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

  it("user cancellation shows no failure alert but IS announced politely", async () => {
    vi.mocked(installPluginFromSource).mockResolvedValue({
      success: false,
      errors: [{ code: "source-cancelled", message: "cancelled", recoverable: true }],
    });
    const wrapper = mountDialog();
    await selectGithubWithUri(wrapper);
    await wrapper.find('[data-testid="install-btn"]').trigger("click");
    await flushPromises();
    // No failure alert…
    expect(wrapper.find('[data-testid="install-error"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Install failed.");
    // …but the live region announces the cancellation (GF §11.5/NFR-10).
    const status = wrapper.find('[data-testid="install-status"]');
    expect(status.exists()).toBe(true);
    expect(status.attributes("role")).toBe("status");
    expect(status.attributes("aria-live")).toBe("polite");
    expect(status.text()).toContain("Installation cancelled.");
  });

  it("empty URL keeps Install disabled; a typed URL enables it", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.find('[data-testid="kind-select"]').setValue("github");
    await flushPromises();
    const btn = wrapper.find('[data-testid="install-btn"]');
    expect(btn.attributes("disabled")).toBeDefined();
    const uriInput = wrapper
      .findAll("input")
      .find((i) => (i.element as HTMLInputElement).value === "");
    expect(uriInput).toBeTruthy();
    await uriInput!.setValue("https://github.com/owner/repo");
    await flushPromises();
    expect(wrapper.find('[data-testid="install-btn"]').attributes("disabled")).toBeUndefined();
  });

  it("shows the working stage in a polite live region until the install settles", async () => {
    let settle!: (v: {
      success: boolean;
      plugin?: unknown;
      errors?: unknown[];
    }) => void;
    vi.mocked(installPluginFromSource).mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve as typeof settle;
        })
    );
    const wrapper = mountDialog();
    await selectGithubWithUri(wrapper);
    await wrapper.find('[data-testid="install-btn"]').trigger("click");
    await flushPromises();
    const status = wrapper.find('[data-testid="install-status"]');
    expect(status.exists()).toBe(true);
    expect(status.attributes("aria-live")).toBe("polite");
    // GitHub stage copy (§11.2): resolving + downloading.
    expect(status.text()).toContain("Resolving the revision");
    settle({
      success: false,
      errors: [{ code: "github-rate-limited", message: "x", recoverable: true }],
    });
    await flushPromises();
    // Settled: the stage line is gone; the typed error alert carries it.
    expect(wrapper.find('[data-testid="install-status"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="install-error"]').attributes("role")).toBe("alert");
  });

  it("renders unavailable-repository and invalid-ref guidance for their stable codes", async () => {
    vi.mocked(installPluginFromSource).mockResolvedValue({
      success: false,
      errors: [
        {
          code: "github-repository-unavailable",
          message: "internal",
          recoverable: true,
        },
      ],
    });
    let wrapper = mountDialog();
    await selectGithubWithUri(wrapper);
    await wrapper.find('[data-testid="install-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="install-error"]').text()).toContain(
      "not found or is not publicly accessible"
    );

    vi.mocked(installPluginFromSource).mockResolvedValue({
      success: false,
      errors: [
        { code: "github-ref-not-found", message: "internal", recoverable: true },
      ],
    });
    wrapper = mountDialog();
    await selectGithubWithUri(wrapper);
    await wrapper.find('[data-testid="install-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="install-error"]').text()).toContain(
      "branch, tag, or commit"
    );
  });

  it("associates the helper and the error alert with the URL field (a11y)", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.find('[data-testid="kind-select"]').setValue("github");
    await flushPromises();
    const uriInput = wrapper
      .findAll("input")
      .find((i) => (i.element as HTMLInputElement).value === "");
    // Helper is linked while it is shown (capability on).
    expect(uriInput!.attributes("aria-describedby")).toContain(
      "github-no-git-hint-el"
    );
    // A typed failure links the alert too.
    vi.mocked(installPluginFromSource).mockResolvedValue({
      success: false,
      errors: [
        {
          code: "github-repository-unavailable",
          message: "internal",
          recoverable: true,
        },
      ],
    });
    await uriInput!.setValue("https://github.com/owner/repo");
    await wrapper.find('[data-testid="install-btn"]').trigger("click");
    await flushPromises();
    const updated = wrapper
      .findAll("input")
      .find((i) => (i.element as HTMLInputElement).value.includes("owner/repo"));
    expect(updated!.attributes("aria-describedby")).toContain(
      "plugin-install-error"
    );
  });
});
