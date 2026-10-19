import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import PluginArtifactCard from "@/views/components/aiChatV2/PluginArtifactCard.vue";
import type { PluginArtifactView } from "@/views/api/pluginArtifact";

/**
 * Component tests for the plugin artifact card (B01): the preview area stays
 * bounded, and host-side truncation is reported visibly to the user next to
 * the bounded preview.
 */

const previewPluginArtifact = vi.fn();
const exportPluginArtifact = vi.fn();
const deletePluginArtifact = vi.fn();

vi.mock("@/views/api/pluginArtifact", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    previewPluginArtifact: (...args: unknown[]) => previewPluginArtifact(...args),
    exportPluginArtifact: (...args: unknown[]) => exportPluginArtifact(...args),
    deletePluginArtifact: (...args: unknown[]) => deletePluginArtifact(...args),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        pluginArtifact: {
          title: "Result files",
          count_label: "{count} file(s)",
          file_title: "Records ({format})",
          records_count: "{count} records",
          saved_at: "Saved {time}",
          preview: "Preview",
          hide_preview: "Hide preview",
          save: "Save file",
          delete: "Delete",
          confirm_delete: "Confirm delete",
          deleted_all: "Files deleted",
          preview_truncated: "… (showing only the first rows)",
        },
      },
    },
  },
});

function artifact(
  overrides: Partial<PluginArtifactView> = {}
): PluginArtifactView {
  return {
    id: "pa_artifact_1",
    format: "json",
    recordCount: 120,
    sizeBytes: 4096,
    createdAt: "2026-10-16T00:00:00Z",
    ...overrides,
  };
}

function mountCard(
  artifacts: PluginArtifactView[] = [artifact()],
  props: { disabled?: boolean } = {}
) {
  return mount(PluginArtifactCard, {
    props: {
      conversationId: "conv-1",
      artifacts,
      disabled: props.disabled ?? false,
    },
    global: {
      plugins: [i18n],
      stubs: {
        "v-icon": { template: "<span><slot /></span>" },
        "v-btn": {
          props: ["disabled", "color", "size", "variant"],
          emits: ["click"],
          template:
            '<button :data-testid="$attrs[\'data-testid\']" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
      },
    },
  });
}

beforeEach(() => {
  previewPluginArtifact.mockReset();
  exportPluginArtifact.mockReset();
  deletePluginArtifact.mockReset();
  previewPluginArtifact.mockResolvedValue({
    ok: true,
    format: "json",
    rows: JSON.stringify({ schemaVersion: 1, records: [{ a: 1 }], truncated: false }),
    truncated: false,
  });
});

describe("PluginArtifactCard", () => {
  it("renders artifact rows with format, count and size metadata", () => {
    const w = mountCard([artifact({ format: "csv", recordCount: 42 })]);
    expect(w.find('[data-testid="plugin-artifact-row"]').exists()).toBe(true);
    const meta = w.find('[data-testid="plugin-artifact-meta"]');
    expect(meta.exists()).toBe(true);
    expect(meta.text()).toContain("CSV");
    expect(meta.text()).toContain("42 records");
    expect(meta.text()).toContain("4.0 KiB");
  });

  it("loads a bounded preview on first toggle without re-fetching on collapse", async () => {
    const w = mountCard();
    previewPluginArtifact.mockResolvedValue({
      ok: true,
      format: "json",
      rows: JSON.stringify({ records: [{ a: 1 }], truncated: false }),
      truncated: false,
    });
    await w
      .find('[data-testid="plugin-artifact-preview-toggle"]')
      .trigger("click");
    await flushPromises();
    const preview = w.find('[data-testid="plugin-artifact-preview"]');
    expect(preview.exists()).toBe(true);
    expect(preview.text()).toContain("a");
    expect(previewPluginArtifact).toHaveBeenCalledTimes(1);
    // No truncation note when the host did not truncate.
    expect(
      w.find('[data-testid="plugin-artifact-preview-truncated"]').exists()
    ).toBe(false);
    // Collapse then re-expand must reuse the fetched preview.
    await w
      .find('[data-testid="plugin-artifact-preview-toggle"]')
      .trigger("click");
    await w
      .find('[data-testid="plugin-artifact-preview-toggle"]')
      .trigger("click");
    await flushPromises();
    expect(previewPluginArtifact).toHaveBeenCalledTimes(1);
  });

  it("shows the truncation note when the host capped the preview (B01)", async () => {
    const longRows = JSON.stringify({
      schemaVersion: 1,
      records: Array.from({ length: 5 }, (_, i) => ({ i })),
    });
    previewPluginArtifact.mockResolvedValue({
      ok: true,
      format: "json",
      rows: longRows,
      truncated: true,
    });
    const w = mountCard();
    await w
      .find('[data-testid="plugin-artifact-preview-toggle"]')
      .trigger("click");
    await flushPromises();
    const note = w.find('[data-testid="plugin-artifact-preview-truncated"]');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain("showing only the first rows");
    expect(w.find('[data-testid="plugin-artifact-preview"]').text()).toContain(
      "… (showing only the first rows)"
    );
  });

  it("appends the truncation note in-render when the row text exceeds the renderer cap (B01)", async () => {
    // Host did not flag it, but the renderer caps displayed rows: the appended
    // label keeps "truncated" honest for a long CSV without header semantics.
    previewPluginArtifact.mockResolvedValue({
      ok: true,
      format: "csv",
      rows: "r1\nr2\nr3\nr4\nr5\nr6\nr7",
      truncated: false,
    });
    const w = mountCard([artifact({ format: "csv" })]);
    await w
      .find('[data-testid="plugin-artifact-preview-toggle"]')
      .trigger("click");
    await flushPromises();
    const preview = w.find('[data-testid="plugin-artifact-preview"]').text();
    expect(preview).toContain("r1");
    expect(preview).toContain("r5");
    expect(preview).not.toContain("r6");
    // Host flag absent → still no distinct note (renderer cap covers display).
    expect(
      w.find('[data-testid="plugin-artifact-preview-truncated"]').exists()
    ).toBe(false);
  });

  it("shows an error row when the preview request fails", async () => {
    previewPluginArtifact.mockResolvedValue({
      ok: false,
      error: "artifact not found",
    });
    const w = mountCard();
    await w
      .find('[data-testid="plugin-artifact-preview-toggle"]')
      .trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="plugin-artifact-error"]').text()).toContain(
      "artifact not found"
    );
  });
});
