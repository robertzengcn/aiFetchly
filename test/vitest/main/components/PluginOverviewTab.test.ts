/**
 * Component tests for PluginOverviewTab (git-free GitHub plugin installation
 * PRD §11.2 / US-06): the trusted resolved-revision row shows a SHORTENED
 * immutable commit SHA for GitHub-archive installs and stays hidden for
 * every other source.
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import PluginOverviewTab from "@/views/components/plugins/PluginOverviewTab.vue";
import type { PluginDetail } from "@/views/api/plugins";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      plugins: {
        column_version: "Version",
        column_source: "Source",
        column_status: "Status",
        source_path_imported_from: "Imported from",
        source_path_installed_at: "Installed in",
        command_count: "Commands: {count}",
        hook_count: "Hooks: {count}",
        resolved_revision: "Pinned revision",
        install_source: { source_kind: "Install source" },
      },
    },
  },
});

const SHA = "0123456789abcdef0123456789abcdef01234567";

function makeDetail(
  sourceMeta?: Record<string, unknown>
): PluginDetail {
  return {
    id: 1,
    name: "video-use",
    version: "1.0.0",
    source: "local",
    enabled: true,
    health: "healthy",
    skillCount: 1,
    mcpServerCount: 0,
    agentCount: 0,
    commandCount: 0,
    hookCount: 0,
    permissions: [],
    lastUpdated: new Date("2026-09-14T00:00:00.000Z").toISOString(),
    description: "demo",
    sourceKind: "github",
    sourceUri: "https://github.com/browser-use/video-use",
    sourceRef: "main",
    ...(sourceMeta ? { sourceMeta } : {}),
    skills: [],
    mcpServers: [],
    agents: [],
    commands: [],
    hooks: [],
    errors: [],
    manifest: {},
  };
}

function mountTab(detail: PluginDetail) {
  return mount(PluginOverviewTab, {
    global: { plugins: [i18n] },
    props: { detail },
  });
}

describe("PluginOverviewTab — resolved revision (US-06)", () => {
  it("shows the shortened SHA with the full SHA as title for archive installs", () => {
    const wrapper = mountTab(
      makeDetail({
        acquisition: "github-archive",
        resolvedCommitSha: SHA,
        repositoryHost: "github.com",
      })
    );
    const row = wrapper.find('[data-testid="plugin-resolved-revision"]');
    expect(row.exists()).toBe(true);
    const code = row.find("code");
    // Short display form, full value only in the title/aria label.
    expect(code.text()).toBe(SHA.slice(0, 7));
    expect(code.attributes("title")).toBe(SHA);
    expect(code.attributes("aria-label")).toBe("Pinned revision");
  });

  it("hides the row when sourceMeta has no resolvedCommitSha (release asset)", () => {
    const wrapper = mountTab(makeDetail({ acquisition: "github-release-asset" }));
    expect(wrapper.find('[data-testid="plugin-resolved-revision"]').exists()).toBe(false);
  });

  it("hides the row when the SHA is malformed (untrusted shape)", () => {
    const wrapper = mountTab(makeDetail({ resolvedCommitSha: "not-a-sha" }));
    expect(wrapper.find('[data-testid="plugin-resolved-revision"]').exists()).toBe(false);
  });

  it("still renders the canonical source URI", () => {
    const wrapper = mountTab(makeDetail({ resolvedCommitSha: SHA }));
    expect(wrapper.text()).toContain("https://github.com/browser-use/video-use");
  });
});
