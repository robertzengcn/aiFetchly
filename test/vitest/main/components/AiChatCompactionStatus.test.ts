import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatCompactionStatus from "@/views/components/aiChatV2/AiChatCompactionStatus.vue";
import type { CompactionStatusSnapshot } from "@/service/AIChatCompactionCoordinator";

/**
 * Component test for the incremental-compaction status badge
 * (technical-design §13).
 *
 * The badge renders a compact Vuetify chip reflecting the active or
 * last-known compaction run state. It is hidden (v-if="visible") when there
 * is no run at all — null status, or queued with no runId — so the header
 * stays uncluttered for conversations that have never compacted.
 *
 * The component uses `useI18n()` directly (real vue-i18n plugin required,
 * NOT a `$t` mock), and references a Vuetify `v-chip` + `v-icon`. Without
 * the Vuetify plugin registered, these render as unresolved custom elements;
 * the chip/icon are stubbed explicitly so assertions target the rendered
 * label text (the i18n key resolution) rather than Vuetify's internal
 * classes.
 *
 * NOTE: This file MUST be run with the dedicated workspace config
 * `test/vitest/main/components/vitest.config.mjs` (which sets
 * `environment: 'happy-dom'`).
 */

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatCompaction: {
        status_idle: "Idle",
        status_queued: "Queued",
        status_running: "Compacting…",
        status_paused: "Paused",
        status_completed: "Compacted",
        status_failed: "Compaction failed",
        status_cancelled: "Cancelled",
      },
    },
  },
});

function mountStatus(status: CompactionStatusSnapshot | null) {
  return mount(AiChatCompactionStatus, {
    props: { status },
    global: {
      plugins: [i18n],
      stubs: {
        VChip: {
          template: '<div class="v-chip" data-testid="ai-compaction-status"><slot /></div>',
        },
        VIcon: { template: "<i />" },
      },
    },
  });
}

describe("AiChatCompactionStatus", () => {
  it("is hidden when status is null", () => {
    const w = mountStatus(null);
    expect(w.find('[data-testid="ai-compaction-status"]').exists()).toBe(false);
  });

  it("is hidden when queued but no runId assigned yet", () => {
    const w = mountStatus({ state: "queued" });
    expect(w.find('[data-testid="ai-compaction-status"]').exists()).toBe(false);
  });

  it("renders the queued label once a runId is assigned", () => {
    const w = mountStatus({ state: "queued", runId: "run-1" });
    const chip = w.find('[data-testid="ai-compaction-status"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("Queued");
  });

  it("renders the running label with a runId", () => {
    const w = mountStatus({ state: "running", runId: "run-2" });
    const chip = w.find('[data-testid="ai-compaction-status"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("Compacting");
  });

  it("renders the completed label", () => {
    const w = mountStatus({ state: "completed", runId: "run-3" });
    expect(w.find('[data-testid="ai-compaction-status"]').text()).toContain(
      "Compacted"
    );
  });

  it("renders the failed label", () => {
    const w = mountStatus({ state: "failed", runId: "run-4" });
    expect(w.find('[data-testid="ai-compaction-status"]').text()).toContain(
      "Compaction failed"
    );
  });

  it("renders the cancelled label", () => {
    const w = mountStatus({ state: "cancelled", runId: "run-5" });
    expect(w.find('[data-testid="ai-compaction-status"]').text()).toContain(
      "Cancelled"
    );
  });

  it("renders the paused label", () => {
    const w = mountStatus({ state: "paused", runId: "run-6" });
    expect(w.find('[data-testid="ai-compaction-status"]').text()).toContain(
      "Paused"
    );
  });

  it("falls back to idle label for an unknown state", () => {
    const w = mountStatus({ state: "weird-state", runId: "run-7" });
    expect(w.find('[data-testid="ai-compaction-status"]').text()).toContain(
      "Idle"
    );
  });
});
