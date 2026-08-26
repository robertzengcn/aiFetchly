/**
 * aiChatV2 save-to-workspace i18n parity test.
 *
 * Locks cross-language parity so a developer cannot add a new
 * save-to-workspace key without updating all six locales:
 *   - aiChatV2.generatedImageRefs.saveToWorkspace (button label)
 *   - aiChatV2.artifactExport.savedToWorkspace / .saveFailed (toasts)
 */
import { describe, it, expect } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

type LangMessages = Record<string, Record<string, unknown>>;
const LANGS: Record<string, LangMessages> = { en, zh, es, fr, de, ja };

const REFS_KEY = "saveToWorkspace";
const EXPORT_KEYS = ["savedToWorkspace", "saveFailed"] as const;

function group(
  lang: LangMessages,
  name: string
): Record<string, unknown> | undefined {
  const aiChatV2 = lang.aiChatV2 as Record<string, unknown> | undefined;
  return aiChatV2?.[name] as Record<string, unknown> | undefined;
}

describe("aiChatV2 save-to-workspace i18n parity across all six languages", () => {
  for (const [code, lang] of Object.entries(LANGS)) {
    describe(`${code}`, () => {
      it("has aiChatV2.generatedImageRefs.saveToWorkspace as a non-empty string", () => {
        const refs = group(lang, "generatedImageRefs");
        if (!refs) {
          expect.fail(`aiChatV2.generatedImageRefs missing in ${code}`);
        }
        const value = refs[REFS_KEY];
        expect(typeof value, `${code}.saveToWorkspace must be a string`).toBe(
          "string"
        );
        expect((value as string).length).toBeGreaterThan(0);
      });

      for (const exportKey of EXPORT_KEYS) {
        it(`has aiChatV2.artifactExport.${exportKey} as a non-empty string`, () => {
          const artifactExport = group(lang, "artifactExport");
          if (!artifactExport) {
            expect.fail(`aiChatV2.artifactExport missing in ${code}`);
          }
          const value = artifactExport[exportKey];
          expect(
            typeof value,
            `${code}.artifactExport.${exportKey} must be a string`
          ).toBe("string");
          expect((value as string).length).toBeGreaterThan(0);
        });
      }

      it("keeps savedToWorkspace interpolating {fileName} like every other locale", () => {
        const artifactExport = group(lang, "artifactExport");
        const value = artifactExport?.savedToWorkspace;
        expect(typeof value).toBe("string");
        expect(value as string).toContain("{fileName}");
      });
    });
  }
});
