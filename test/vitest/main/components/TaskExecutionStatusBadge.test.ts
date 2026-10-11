import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import TaskExecutionStatusBadge from "@/views/components/aiChatV2/TaskExecutionStatusBadge.vue";
import type {
  AiTaskExecutionStatus,
  TaskOutcome,
} from "@/entityTypes/aiTaskExecutionTypes";

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
          outcome_verified_complete: "completed",
          outcome_incomplete: "incomplete",
          outcome_needs_user_input: "needs your input",
          outcome_blocked_by_policy: "blocked by policy",
          outcome_failed: "failed",
          outcome_cancelled: "cancelled",
          outcome_timeout: "timed out",
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
            '<div class="v-chip" :color="color" :title="title"><slot /></div>',
          props: ["color", "title"],
        },
        VIcon: { template: "<i />" },
      },
    },
  });
}

/**
 * T14 (PRD FR-13/15/22, AC-16/21/27/32): a terminal badge must NOT show green
 * "completed" for anything other than `verified_complete`. Each non-success
 * outcome has an honest label, an honest (non-green) color, and surfaces the
 * reason code as a tooltip. The audit's worst case — an incomplete run with
 * CONTINUATION_LIMIT rendered as green Completed — must never happen.
 */
const NON_SUCCESS_OUTCOMES: ReadonlyArray<{
  outcome: TaskOutcome;
  /** Substring the visible label must contain. */
  labelFragment: string;
  /** Color must NOT be this (the success-green default). */
  forbiddenColor: "success";
}> = [
  { outcome: "incomplete", labelFragment: "incomplete", forbiddenColor: "success" },
  { outcome: "needs_user_input", labelFragment: "needs your input", forbiddenColor: "success" },
  { outcome: "blocked_by_policy", labelFragment: "blocked by policy", forbiddenColor: "success" },
  { outcome: "failed", labelFragment: "failed", forbiddenColor: "success" },
  { outcome: "cancelled", labelFragment: "cancelled", forbiddenColor: "success" },
  { outcome: "timeout", labelFragment: "timed out", forbiddenColor: "success" },
];

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

  describe("T14 — honest terminal outcome label/color (FR-13/15/22, AC-16/21/27/32)", () => {
    it("renders green + 'completed' for verified_complete", () => {
      const w = mountBadge("terminal", { outcome: "verified_complete" });
      expect(w.find(".v-chip").attributes("color")).toBe("success");
      expect(w.text()).toContain("completed");
    });

    it("terminal with NO outcome prop stays green 'completed' (backward compatible)", () => {
      // Older callers that don't pass outcome must keep the legacy display —
      // the badge cannot regress to 'unknown' just because outcome is absent.
      const w = mountBadge("terminal");
      expect(w.find(".v-chip").attributes("color")).toBe("success");
      expect(w.text()).toContain("completed");
    });

    it.each(NON_SUCCESS_OUTCOMES.map((o) => [o.outcome, o] as const))(
      "terminal outcome=%s is NOT green and shows its honest label",
      (_outcome, fixture) => {
        const w = mountBadge("terminal", { outcome: fixture.outcome });
        const color = w.find(".v-chip").attributes("color");
        expect(color).not.toBe(fixture.forbiddenColor);
        expect(w.text()).toContain(fixture.labelFragment);
      }
    );

    it("terminal incomplete with CONTINUATION_LIMIT must NEVER be green 'completed'", () => {
      // The audit's named worst case. A green 'completed' here would hide a
      // stalled run from the user.
      const w = mountBadge("terminal", {
        outcome: "incomplete",
        reasonCode: "CONTINUATION_LIMIT",
      });
      expect(w.find(".v-chip").attributes("color")).not.toBe("success");
      expect(w.text()).not.toContain("completed");
      // Reason tooltip still surfaces the why.
      expect(w.find(".v-chip").attributes("title")).toContain(
        "continuation limit was reached"
      );
    });

    it("non-terminal status ignores outcome (no premature honest label)", () => {
      // An in-flight run that the row calls 'failed' but status is still
      // 'active' must NOT flip to the failed color/label — the badge follows
      // authoritative status, and outcome is only meaningful at terminal.
      const w = mountBadge("active", { outcome: "failed" });
      expect(w.find(".v-chip").attributes("color")).toBe("primary");
      expect(w.text()).toContain("working");
      expect(w.text()).not.toContain("failed");
    });

    it("falls back to humanized outcome when the i18n key is missing", () => {
      // `outcome_timeout` is intentionally absent from the test messages below
      // — verify the humanized fallback (underscore→space) is reachable and
      // the raw enum value / i18n key path is NOT leaked into the badge.
      const i18nMissingOutcome = createI18n({
        legacy: false,
        locale: "en",
        messages: {
          en: {
            aiChatV2: {
              taskExecution: {
                status_terminal: "completed",
                // outcome_timeout intentionally MISSING
              },
            },
          },
        },
      });
      const w = mount(TaskExecutionStatusBadge, {
        props: { status: "terminal", outcome: "timeout" },
        global: {
          plugins: [i18nMissingOutcome],
          stubs: {
            VChip: {
              template:
                '<div class="v-chip" :color="color" :title="title"><slot /></div>',
              props: ["color", "title"],
            },
            VIcon: { template: "<i />" },
          },
        },
      });
      // Humanized fallback: "timeout" (underscore→space, already a single word).
      expect(w.text()).toContain("timeout");
      // Must NOT leak the raw i18n key path.
      expect(w.text()).not.toContain("aiChatV2");
      expect(w.text()).not.toContain("outcome_timeout");
    });
  });
});
