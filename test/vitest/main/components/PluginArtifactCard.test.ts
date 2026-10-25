import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import PluginArtifactCard from "@/views/components/aiChatV2/PluginArtifactCard.vue";
import type {
  PluginArtifactView,
  PluginExecutionJournalView,
} from "@/views/api/pluginArtifact";

/**
 * Component tests for the plugin artifact card (B01): the preview area stays
 * bounded, and host-side truncation is reported visibly to the user next to
 * the bounded preview.
 */

const previewPluginArtifact = vi.fn();
const exportPluginArtifact = vi.fn();
const deletePluginArtifact = vi.fn();
const listPluginExecutionJournals = vi.fn();

vi.mock("@/views/api/pluginArtifact", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    previewPluginArtifact: (...args: unknown[]) => previewPluginArtifact(...args),
    exportPluginArtifact: (...args: unknown[]) => exportPluginArtifact(...args),
    deletePluginArtifact: (...args: unknown[]) => deletePluginArtifact(...args),
    listPluginExecutionJournals: (...args: unknown[]) =>
      listPluginExecutionJournals(...args),
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
          expires_at: "Expires {time}",
          expired_at: "Expired {time}",
          recovered_title: "Recovered executions",
          recovered_entry: "{plugin} · {time}",
          recovered_note: "An earlier run was interrupted before its results were saved.",
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
  props: { disabled?: boolean; onDeleted?: (id: string) => void } = {}
) {
  return mount(PluginArtifactCard, {
    props: {
      conversationId: "conv-1",
      artifacts,
      disabled: props.disabled ?? false,
      ...(props.onDeleted ? { onDeleted: props.onDeleted } : {}),
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
  listPluginExecutionJournals.mockReset();
  listPluginExecutionJournals.mockResolvedValue([]);
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

  it("keeps a cancelled native save dialog error-free (G04)", async () => {
    exportPluginArtifact.mockResolvedValue({ cancelled: true });
    const w = mountCard();
    await w.find('[data-testid="plugin-artifact-save"]').trigger("click");
    await flushPromises();
    expect(exportPluginArtifact).toHaveBeenCalledWith("conv-1", "pa_artifact_1");
    expect(w.find('[data-testid="plugin-artifact-error"]').exists()).toBe(false);
  });

  it("surfaces a save error from the host (e.g. ownership denial) (G04)", async () => {
    exportPluginArtifact.mockRejectedValue(
      new Error("artifact not found for this conversation")
    );
    const w = mountCard();
    await w.find('[data-testid="plugin-artifact-save"]').trigger("click");
    await flushPromises();
    const err = w.find('[data-testid="plugin-artifact-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain("artifact not found for this conversation");
  });

  it("requires a two-step delete confirmation, then hides the row (G04)", async () => {
    deletePluginArtifact.mockResolvedValue({ deleted: true });
    const deletedIds: string[] = [];
    const w = mountCard([artifact()], {
      onDeleted: (id: string) => deletedIds.push(id),
    });
    const del = w.find('[data-testid="plugin-artifact-delete-pa_artifact_1"]');
    // First click only introduces the confirm-state button label.
    await del.trigger("click");
    expect(w.find('[data-testid="plugin-artifact-delete-pa_artifact_1"]').text()).toContain(
      "Confirm delete"
    );
    expect(deletePluginArtifact).not.toHaveBeenCalled();
    // Second click deletes: row hidden + deleted event + last-file notice.
    await w.find('[data-testid="plugin-artifact-delete-pa_artifact_1"]').trigger("click");
    await flushPromises();
    expect(deletePluginArtifact).toHaveBeenCalledWith("conv-1", "pa_artifact_1");
    expect(deletedIds).toEqual(["pa_artifact_1"]);
    expect(w.find('[data-testid="plugin-artifact-row"]').exists()).toBe(false);
    expect(
      w.find('[data-testid="plugin-artifact-deleted-notice"]').text()
    ).toContain("Files deleted");
  });

  it("surfaces a delete failure and resets the confirm state (G04)", async () => {
    deletePluginArtifact.mockRejectedValue(new Error("denied: foreign conversation"));
    const w = mountCard();
    await w.find('[data-testid="plugin-artifact-delete-pa_artifact_1"]').trigger("click");
    await w.find('[data-testid="plugin-artifact-delete-pa_artifact_1"]').trigger("click");
    await flushPromises();
    const err = w.find('[data-testid="plugin-artifact-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain("denied: foreign conversation");
    // Confirm state reset: the button label is back to plain "Delete".
    expect(
      w.find('[data-testid="plugin-artifact-delete-pa_artifact_1"]').text()
    ).not.toContain("Confirm delete");
    expect(w.find('[data-testid="plugin-artifact-row"]').exists()).toBe(true);
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

  it("renders a future expiry as 'Expires' and a past expiry as 'Expired' (G03)", async () => {
    const w = mountCard([
      artifact({ expiresAt: "2030-01-01T00:00:00.000Z" }),
    ]);
    await flushPromises();
    let label = w.find('[data-testid="plugin-artifact-expires"]').text();
    expect(label).toContain("Expires");
    expect(label).not.toContain("Expired 2");
    // expect(label).not.toMatch(/^Expired/) -- formatted date, assert prefix
    expect(label.startsWith("Expired")).toBe(false);

    const w2 = mountCard([
      artifact({ expiresAt: "2001-01-01T00:00:00.000Z" }),
    ]);
    await flushPromises();
    label = w2.find('[data-testid="plugin-artifact-expires"]').text();
    expect(label).toContain("Expired");

    // Rows without expiry show no label.
    const w3 = mountCard();
    await flushPromises();
    expect(
      w3.find('[data-testid="plugin-artifact-expires"]').exists()
    ).toBe(false);
  });

  it("lists interrupted executions that registered no artifact (G03)", async () => {
    const journal = (
      overrides: Partial<PluginExecutionJournalView>
    ): PluginExecutionJournalView => ({
      executionId: "exec-int-1",
      status: "interrupted",
      at: "2026-10-19T10:00:00.000Z",
      pluginName: "hook-scrape",
      registeredCount: 0,
      message: null,
      ...overrides,
    });
    listPluginExecutionJournals.mockResolvedValue([
      journal({}),
      journal({ executionId: "exec-int-2", pluginName: "hook-scrape" }),
      // complete/degraded journals already surface as artifact rows — filtered.
      journal({
        executionId: "exec-done",
        status: "complete",
        registeredCount: 3,
      }),
      journal({ executionId: "exec-deg", status: "degraded", registeredCount: 1 }),
    ]);
    const w = mountCard();
    await flushPromises();
    expect(
      w.find('[data-testid="plugin-artifact-interrupted"]').exists()
    ).toBe(true);
    const entries = w.findAll(
      '[data-testid="plugin-artifact-interrupted-entry"]'
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].text()).toContain("hook-scrape");
    expect(entries[0].text()).toContain("·");
    expect(listPluginExecutionJournals).toHaveBeenCalledWith("conv-1");
  });

  it("caps recovered-execution entries bounded and stays silent when the journal fetch fails (G03)", async () => {
    const journal = (
      executionId: string
    ): PluginExecutionJournalView => ({
      executionId,
      status: "interrupted",
      at: "2026-10-19T10:00:00.000Z",
      pluginName: "hook-scrape",
      registeredCount: 0,
      message: null,
    });
    listPluginExecutionJournals.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => journal(`exec-${i}`))
    );
    let w = mountCard();
    await flushPromises();
    expect(
      w.findAll('[data-testid="plugin-artifact-interrupted-entry"]')
    ).toHaveLength(8);

    // Fetch failure → no section, no crash; later successful mounts work.
    listPluginExecutionJournals.mockRejectedValue(new Error("boom"));
    w = mountCard();
    await flushPromises();
    expect(
      w.find('[data-testid="plugin-artifact-interrupted"]').exists()
    ).toBe(false);
    expect(w.find('[data-testid="plugin-artifact-row"]').exists()).toBe(true);
  });
});
