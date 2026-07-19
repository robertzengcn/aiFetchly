/**
 * I18-01 Static Test — all six lang files expose the phase-13 i18n groups
 * with identical key sets and preserved interpolation tokens.
 *
 * Locks the i18n contract so a developer cannot add a key to en.ts without
 * updating zh/es/fr/de/ja (or vice versa). Run by `yarn testmain -- i18nKeysPresent`.
 */
import { describe, it, expect } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

// Each lang file is a default-exported messages object. We index dynamically,
// so a permissive record type avoids spurious structural-mismatch errors
// across the six files (their `common` key sets differ slightly).
type LangMessages = Record<string, Record<string, unknown>>;

const LANGS: Record<string, LangMessages> = { en, zh, es, fr, de, ja };

const REQUIRED_AIFETCHLY_CONFIG_KEYS = [
  "title",
  "reload",
  "reloadStarted",
  "reloadResult",
  "reloadFailed",
  "status",
  "statusResult",
  "statusEmpty",
  "watcherNotStarted",
  "diagnosticWarning",
  "diagnosticError",
  "diagnosticInfo",
  "workspaceTrustTitle",
  "workspaceTrustBody",
  "commandDisabledUntrusted",
] as const;

const REQUIRED_SLASH_COMMANDS_KEYS = [
  "help",
  "clear",
  "reloadConfig",
  "status",
  "helpResultTitle",
  "noMatches",
  "unknownCommand",
  "notDispatchable",
  "notACommand",
  "disabledCommand",
  "sourceBuiltin",
  "sourceUser",
  "sourceWorkspace",
  "sourcePlugin",
  "argumentHint",
  "argumentHintNone",
] as const;

// Values that must carry interpolation tokens, mapped token -> key list.
const TOKEN_EXPECTATIONS: Array<{ token: string; keys: string[] }> = [
  { token: "{commandCount}", keys: ["reloadResult", "statusResult"] },
  { token: "{diagnosticCount}", keys: ["reloadResult", "statusResult"] },
  {
    token: "{name}",
    keys: ["unknownCommand", "commandDisabledUntrusted", "disabledCommand"],
  },
];

describe("I18-01 — phase-13 i18n groups present across all six languages", () => {
  for (const [code, lang] of Object.entries(LANGS)) {
    describe(`${code}: aifetchlyConfig group`, () => {
      it("has a non-empty aifetchlyConfig object", () => {
        expect(typeof lang.aifetchlyConfig).toBe("object");
        expect(lang.aifetchlyConfig).not.toBeNull();
      });
      for (const key of REQUIRED_AIFETCHLY_CONFIG_KEYS) {
        it(`has a non-empty string at aifetchlyConfig.${key}`, () => {
          const v = (lang.aifetchlyConfig as Record<string, unknown>)[key];
          expect(typeof v).toBe("string");
          expect((v as string).length).toBeGreaterThan(0);
        });
      }
    });

    describe(`${code}: slashCommands group`, () => {
      it("has a non-empty slashCommands object", () => {
        expect(typeof lang.slashCommands).toBe("object");
        expect(lang.slashCommands).not.toBeNull();
      });
      for (const key of REQUIRED_SLASH_COMMANDS_KEYS) {
        it(`has a non-empty string at slashCommands.${key}`, () => {
          const v = (lang.slashCommands as Record<string, unknown>)[key];
          expect(typeof v).toBe("string");
          expect((v as string).length).toBeGreaterThan(0);
        });
      }
    });

    describe(`${code}: interpolation tokens preserved`, () => {
      for (const { token, keys } of TOKEN_EXPECTATIONS) {
        it(`aifetchlyConfig values carry ${token} where expected`, () => {
          for (const k of keys) {
            if (k === "unknownCommand" || k === "disabledCommand") continue; // slashCommands keys
          }
          // aifetchlyConfig tokens
          for (const k of keys) {
            const inAifetchly = (
              REQUIRED_AIFETCHLY_CONFIG_KEYS as readonly string[]
            ).includes(k);
            if (!inAifetchly) continue;
            const v = (lang.aifetchlyConfig as Record<string, string>)[k];
            expect(
              v,
              `${code}.aifetchlyConfig.${k} must contain ${token}`
            ).toContain(token);
          }
        });
        it(`slashCommands values carry ${token} where expected`, () => {
          for (const k of keys) {
            const inSlash = (
              REQUIRED_SLASH_COMMANDS_KEYS as readonly string[]
            ).includes(k);
            if (!inSlash) continue;
            const v = (lang.slashCommands as Record<string, string>)[k];
            expect(
              v,
              `${code}.slashCommands.${k} must contain ${token}`
            ).toContain(token);
          }
        });
      }
    });
  }

  describe("key-set parity across all six languages", () => {
    it("aifetchlyConfig key sets are identical", () => {
      const sets = Object.values(LANGS).map((l) =>
        Object.keys(l.aifetchlyConfig as Record<string, unknown>)
          .sort()
          .join(",")
      );
      const first = sets[0];
      for (let i = 1; i < sets.length; i++) {
        expect(
          sets[i],
          `language ${Object.keys(LANGS)[i]} aifetchlyConfig keys mismatch`
        ).toBe(first);
      }
    });

    it("slashCommands key sets are identical", () => {
      const sets = Object.values(LANGS).map((l) =>
        Object.keys(l.slashCommands as Record<string, unknown>)
          .sort()
          .join(",")
      );
      const first = sets[0];
      for (let i = 1; i < sets.length; i++) {
        expect(
          sets[i],
          `language ${Object.keys(LANGS)[i]} slashCommands keys mismatch`
        ).toBe(first);
      }
    });
  });
});
