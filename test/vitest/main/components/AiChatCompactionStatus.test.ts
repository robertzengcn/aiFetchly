import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatCompactionStatus from "@/views/components/aiChatV2/AiChatCompactionStatus.vue";
import type { CompactionStatusSnapshot } from "@/service/AIChatCompactionCoordinator";

/**
 * Component test for the incremental-compaction status + recovery actions
 * (technical-design §13, FR-09–11).
 *
 * The chip reflects the accurate run state (idle/queued/running/joined/
 * paused/completed/failed/cancelled) and is hidden when there is no run at
 * all. The panel exposes bounded retry/cancel controls plus a link to earlier
 * messages, and explains that originals remain searchable after completion.
 * Progress is indeterminate — never an invented percentage.
 *
 * The component uses `useI18n()` directly (real vue-i18n plugin required,
 * NOT a `$t` mock). Vuetify primitives are stubbed; the VMenu stub renders
 * both the activator (chip) and the panel content so actions are testable.
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
        status_joined: "Joined",
        status_paused: "Paused",
        status_completed: "Compacted",
        status_failed: "Compaction failed",
        status_cancelled: "Cancelled",
        panel_title: "Compaction",
        in_progress_note: "Working in bounded batches — safe to keep chatting.",
        view_history: "View earlier messages",
        completed_detail: "Earlier messages remain searchable.",
        failed_detail: "Compaction stopped with an error.",
        cancelled_detail: "Compaction was cancelled.",
        joined_detail: "Joined an already-running compaction.",
        running_detail: "Compacting earlier history in bounded sections.",
        idle_detail: "Compaction is idle.",
        compaction_retry: "Retry",
        compaction_cancel: "Cancel compaction",
      },
    },
  },
});

function mountStatus(
  status: CompactionStatusSnapshot | null,
  props: Record<string, unknown> = {}
) {
  return mount(AiChatCompactionStatus, {
    props: { status, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        VMenu: {
          template:
            '<div class="v-menu"><div class="v-menu-activator"><slot name="activator" :props="{}" /></div><slot /></div>',
        },
        VChip: {
          template: '<div class="v-chip" data-testid="ai-compaction-status"><slot /></div>',
        },
        VIcon: { template: "<i />" },
        VCard: { template: '<div class="v-card"><slot /></div>' },
        VCardTitle: { template: '<div class="v-card-title"><slot /></div>' },
        VCardText: { template: '<div class="v-card-text"><slot /></div>' },
        VCardActions: { template: '<div class="v-card-actions"><slot /></div>' },
        VBtn: {
          props: { disabled: { type: Boolean, default: false } },
          emits: ["click"],
          template:
            '<button class="v-btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
        VProgressCircular: { template: "<span />" },
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

  it("renders the joined label for a joined run (never completed-by-proxy)", () => {
    const w = mountStatus({ state: "joined", runId: "run-j" });
    expect(w.find('[data-testid="ai-compaction-status"]').text()).toContain(
      "Joined"
    );
  });

  it("renders the completed label", () => {
    const w = mountStatus({ state: "completed", runId: "run-3" });
    expect(w.find('[data-testid="ai-compaction-status"]').text()).toContain(
      "Compacted"
    );
  });

  it("explains that originals remain searchable after completion", () => {
    const w = mountStatus({ state: "completed", runId: "run-3" });
    expect(w.text()).toContain("remain searchable");
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

  it("emits retry for a failed run", async () => {
    const w = mountStatus({ state: "failed", runId: "run-4" });
    await w.find('[data-testid="ai-compaction-retry"]').trigger("click");
    expect(w.emitted("retry")).toBeTruthy();
  });

  it("emits retry for a paused run", async () => {
    const w = mountStatus({ state: "paused", runId: "run-6" });
    await w.find('[data-testid="ai-compaction-retry"]').trigger("click");
    expect(w.emitted("retry")).toBeTruthy();
  });

  it("does not offer retry for a completed run", () => {
    const w = mountStatus({ state: "completed", runId: "run-3" });
    expect(w.find('[data-testid="ai-compaction-retry"]').exists()).toBe(false);
  });

  it("emits cancel for a running run", async () => {
    const w = mountStatus({ state: "running", runId: "run-2" });
    await w.find('[data-testid="ai-compaction-cancel"]').trigger("click");
    expect(w.emitted("cancel")).toBeTruthy();
  });

  it("does not offer cancel for a completed run", () => {
    const w = mountStatus({ state: "completed", runId: "run-3" });
    expect(w.find('[data-testid="ai-compaction-cancel"]').exists()).toBe(false);
  });

  it("emits openHistory from the earlier-messages link", async () => {
    const w = mountStatus({ state: "completed", runId: "run-3" });
    await w.find('[data-testid="ai-compaction-view-history"]').trigger("click");
    expect(w.emitted("openHistory")).toBeTruthy();
  });
});
