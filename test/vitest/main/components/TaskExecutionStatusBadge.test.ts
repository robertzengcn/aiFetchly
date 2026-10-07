import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import TaskExecutionStatusBadge from "@/views/components/aiChatV2/TaskExecutionStatusBadge.vue";
import type { AiTaskExecutionStatus } from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Component test for the task-execution status badge (PRD FR-13, AC-29):
 * checking-completion / continuing-work / waiting / terminal states render
 * with a translated label; a terminal reason code surfaces as a tooltip so
 * the user sees *why* a run ended; a missing i18n key falls back to the raw
 * status (FR-15 English fallback rule).
 *
 * The component uses `useI18n()` directly (real vue-i18n plugin required,
 * NOT a `$t` mock). Vuetify primitives are stubbed.
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
      aiChatV2: {
        taskExecution: {
          status_resolving: "resolving",
          status_active: "working",
          status_verifying: "checking",
          status_continuing: "continuing",
          status_waiting_permission: "awaiting permission",
          status_waiting_input: "needs input",
          status_terminal: "completed",
          errors: {
            CONTINUATION_LIMIT:
              "The continuation limit was reached; the task stopped incomplete.",
            USER_CANCELLED: "The task was cancelled by the user.",
          },
        },
      },
    },
  },
});

function mountBadge(
  status: AiTaskExecutionStatus,
  props: Record<string, unknown> = {}
) {
  return mount(TaskExecutionStatusBadge, {
    props: { status, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        VChip: {
          template:
            '<div class="v-chip" :title="title"><slot /></div>',
          props: ["title"],
        },
        VIcon: { template: "<i />" },
      },
    },
  });
}

describe("TaskExecutionStatusBadge", () => {
  it("renders the working label for an active execution", () => {
    const w = mountBadge("active");
    expect(w.find(".v-chip").exists()).toBe(true);
    expect(w.text()).toContain("working");
  });

  it("renders the checking label while verifying", () => {
    const w = mountBadge("verifying");
    expect(w.text()).toContain("checking");
  });

  it("renders the continuing label during continuation dispatch", () => {
    const w = mountBadge("continuing");
    expect(w.text()).toContain("continuing");
  });

  it("renders waiting states with their own labels", () => {
    expect(mountBadge("waiting_permission").text()).toContain(
      "awaiting permission"
    );
    expect(mountBadge("waiting_input").text()).toContain("needs input");
  });

  it("renders the completed label at terminal status", () => {
    const w = mountBadge("terminal");
    expect(w.text()).toContain("completed");
  });

  it("shows the reason-code message as a tooltip when provided", () => {
    const w = mountBadge("terminal", { reasonCode: "CONTINUATION_LIMIT" });
    const chip = w.find(".v-chip");
    expect(chip.attributes("title")).toContain("continuation limit was reached");
  });

  it("falls back to a humanized reason code when the i18n key is missing", () => {
    const w = mountBadge("terminal", { reasonCode: "SOME_NEW_CODE" });
    const chip = w.find(".v-chip");
    expect(chip.attributes("title")).toContain("some new code");
  });

  it("omits the tooltip when no reason code is provided", () => {
    const w = mountBadge("terminal");
    const chip = w.find(".v-chip");
    expect(chip.attributes("title")).toBe("");
  });

  it("falls back to a humanized status when the i18n key is missing", () => {
    // preparing is deliberately absent from the test i18n messages.
    const w = mountBadge("preparing");
    expect(w.text()).toContain("preparing");
  });
});
