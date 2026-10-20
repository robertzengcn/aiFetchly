import { describe, expect, it } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";
import {
  TASK_EXECUTION_REASON_CODES,
  TASK_EXECUTION_STATUSES,
} from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Six-language coverage for recoverable-history UI strings (AC-24).
 *
 * Every `aiChatHistory` / `aiChatCompaction` key present in English must
 * exist — non-empty — in Chinese, Spanish, French, German, and Japanese.
 * Missing keys silently fall back to English at runtime; this test makes the
 * fallback impossible to ship unnoticed.
 */

const LOCALES: Record<string, unknown> = { en, zh, es, fr, de, ja };

function sectionKeys(locale: unknown, section: string): string[] {
  const root = locale as Record<string, unknown>;
  const part = root[section];
  expect(part, `missing section ${section}`).toBeTypeOf("object");
  return Object.keys(part as Record<string, unknown>);
}

describe.each(["aiChatHistory", "aiChatCompaction"])(
  "locale coverage for %s",
  (section) => {
    it("defines the same keys in all six languages", () => {
      const expected = sectionKeys(en, section).sort();
      expect(expected.length).toBeGreaterThan(0);
      for (const [name, locale] of Object.entries(LOCALES)) {
        expect(sectionKeys(locale, section).sort(), name).toEqual(expected);
      }
    });

    it("has no empty translations in any language", () => {
      for (const [name, locale] of Object.entries(LOCALES)) {
        const part = (locale as Record<string, Record<string, unknown>>)[
          section
        ];
        for (const [key, value] of Object.entries(part)) {
          expect(
            typeof value === "string" && value.trim().length > 0,
            `${name}.${section}.${key}`
          ).toBe(true);
        }
      }
    });
  }
);

/**
 * Nested six-language parity for the task-execution renderer surface
 * (PRD FR-13/FR-15, AC-29). `aiChatV2.taskExecution` is a two-level section
 * (actions/errors are objects), so the flat `sectionKeys` walker above cannot
 * see inside it. This block asserts:
 *   1. every status label for every AiTaskExecutionStatus exists non-empty,
 *   2. the actions object (continue/retry/cancel) matches across languages,
 *   3. the errors map covers ALL TASK_EXECUTION_REASON_CODES — a new reason
 *      code added to the source union without translations fails here.
 */
describe("locale coverage for aiChatV2.taskExecution", () => {
  type TaskExecutionSection = {
    actions: Record<string, unknown>;
    errors: Record<string, unknown>;
  } & Record<string, unknown>;

  function taskExecutionFor(locale: unknown): TaskExecutionSection {
    const root = locale as Record<string, Record<string, unknown>>;
    const aiChatV2 = root["aiChatV2"];
    expect(aiChatV2, "missing section aiChatV2").toBeTypeOf("object");
    const section = aiChatV2["taskExecution"] as TaskExecutionSection;
    expect(section, "missing section aiChatV2.taskExecution").toBeTypeOf(
      "object"
    );
    return section;
  }

  function assertNonEmptyString(
    localeName: string,
    path: string,
    value: unknown
  ): void {
    expect(
      typeof value === "string" && value.trim().length > 0,
      `${localeName}.aiChatV2.taskExecution.${path}`
    ).toBe(true);
  }

  it("labels every execution status in all six languages", () => {
    for (const [name, locale] of Object.entries(LOCALES)) {
      const section = taskExecutionFor(locale);
      for (const status of TASK_EXECUTION_STATUSES) {
        assertNonEmptyString(name, `status_${status}`, section[`status_${status}`]);
      }
    }
  });

  it("defines the same actions keys in all six languages", () => {
    const expected = Object.keys(taskExecutionFor(en).actions).sort();
    expect(expected.length).toBeGreaterThan(0);
    for (const [name, locale] of Object.entries(LOCALES)) {
      const actions = taskExecutionFor(locale).actions;
      expect(Object.keys(actions).sort(), name).toEqual(expected);
      for (const [key, value] of Object.entries(actions)) {
        assertNonEmptyString(name, `actions.${key}`, value);
      }
    }
  });

  it("covers every TASK_EXECUTION_REASON_CODE in all six languages", () => {
    const expected = [...TASK_EXECUTION_REASON_CODES].sort();
    expect(expected.length).toBeGreaterThan(0);
    for (const [name, locale] of Object.entries(LOCALES)) {
      const errors = taskExecutionFor(locale).errors;
      expect(Object.keys(errors).sort(), name).toEqual(expected);
      for (const [code, value] of Object.entries(errors)) {
        assertNonEmptyString(name, `errors.${code}`, value);
      }
    }
  });
});
