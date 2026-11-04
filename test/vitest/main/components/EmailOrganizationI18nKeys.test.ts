import { describe, it, expect } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

/**
 * AC-20 / FR-15: every emailOrganization key must exist in all six
 * supported languages with non-empty text. Missing keys fall back to
 * English silently — this test makes the fallback visible at CI time.
 */

const ENGLISH = (en as unknown as Record<string, Record<string, string>>).emailOrganization;

function keysOf(block: Record<string, string>): Set<string> {
  return new Set(Object.keys(block));
}

function nonEmptyValues(block: Record<string, string>): boolean {
  return Object.values(block).every(
    (value) => typeof value === "string" && value.trim().length > 0
  );
}

describe("emailOrganization i18n coverage (six languages)", () => {
  it("defines the emailOrganization block in English", () => {
    expect(ENGLISH).toBeDefined();
    expect(keysOf(ENGLISH).size).toBeGreaterThan(30);
    expect(nonEmptyValues(ENGLISH)).toBe(true);
  });

  for (const [name, messages] of [
    ["zh", zh],
    ["es", es],
    ["fr", fr],
    ["de", de],
    ["ja", ja],
  ] as const) {
    it(`covers every key in ${name}`, () => {
      const block = (messages as unknown as Record<string, Record<string, string>>)
        .emailOrganization;
      expect(block, name).toBeDefined();
      expect(keysOf(block)).toEqual(keysOf(ENGLISH));
      expect(nonEmptyValues(block), name).toBe(true);
    });
  }

  it("covers the emailReceive keys added by the organization feature (review)", () => {
    const languages = [en, zh, es, fr, de, ja] as const;
    for (const messages of languages) {
      const block = (messages as unknown as Record<string, never>).emailReceive as Record<
        string,
        unknown
      >;
      for (const key of [
        "thread_label",
        "image_hidden",
        "load_failed",
        "invalid_message_id",
        "retry",
      ]) {
        expect(typeof block[key], key).toBe("string");
      }
      const states = block["classification_state"] as Record<string, string>;
      for (const key of [
        "interested",
        "not_interested",
        "unsubscribe",
        "bounce",
        "auto_reply",
        "support_request",
        "needs_human_review",
        "unknown",
      ]) {
        expect(typeof states[key], key).toBe("string");
      }
    }
  });

  it("covers the status vocabulary for operation cards", () => {
    for (const kind of ["forward", "trash", "restore"]) {
      for (const status of [
        "prepared",
        "running",
        "succeeded",
        "partially_succeeded",
        "failed",
        "cancelled",
        "needs_reconciliation",
      ]) {
        expect(ENGLISH[`op_${kind}_${status}`], `${kind}/${status}`).toBeDefined();
      }
    }
  });
});
