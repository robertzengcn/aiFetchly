import { describe, expect, test } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

interface ComplianceMessages {
  route: Record<string, string>;
  mapScraper: Record<string, string>;
  search: Record<string, string>;
}

const locales: Record<string, ComplianceMessages> = { en, zh, es, fr, de, ja };

describe("compliance-facing product nouns", () => {
  // Policy split (compliance PRD vs f0a5c5b9):
  //   - PRD-mandated neutral wording — Channel Alpha (Global) / Channel Beta
  //     (CIS Region), "Export To Routing Sheet", and the Google/Yandex engine
  //     names — is compliance language, not product naming: identical English
  //     in EVERY locale.
  //   - Module display names (Market Insight Explorer, Local Business
  //     Finder, ...) carry the exact PRD noun in English and are localized
  //     in the other five locales (f0a5c5b9 translated the branded route
  //     menu items so the menu does not render in English regardless of
  //     locale). Every locale must still resolve each key to a non-empty
  //     value that is not a pre-PRD tool-descriptive name.

  test("uses PRD module names for primary navigation in every locale", () => {
    const expectedRouteValues: Record<string, string> = {
      search_scraper: "Market Insight Explorer",
      email_extraction: "Contact Profile Insights",
      email_extraction_form: "Contact Profile Insights",
      yellow_pages: "Directory Assistant",
      google_maps_scraper: "Local Business Finder",
      yandex_maps_scraper: "Local Business Finder",
      map_scraper: "Local Business Finder",
      email_marketing: "Outreach Campaign",
    };

    // The English locale carries the exact compliance-PRD module names.
    for (const [key, value] of Object.entries(expectedRouteValues)) {
      expect(locales.en.route[key]).toBe(value);
    }

    // Pre-PRD tool-descriptive names must never return in any locale.
    const legacyRouteNames = new Set([
      // English pre-PRD names.
      "Search Scraper",
      "Email Extraction",
      "Yellow Pages Scraper",
      "Map Scraper",
      "Email Marketing",
      // zh pre-PRD names (the locale that was live before d7e4e09c).
      "搜索抓取器",
      "邮件提取",
      "黄页抓取器",
      "Yandex Maps 抓取器",
      "邮件营销",
    ]);

    for (const messages of Object.values(locales)) {
      for (const key of Object.keys(expectedRouteValues)) {
        const value = messages.route[key];
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
        expect(legacyRouteNames.has(value)).toBe(false);
      }
    }
  });

  test("uses neutral local business channel and export wording", () => {
    // Module title: exact PRD noun in English, localized elsewhere.
    expect(locales.en.mapScraper.title).toBe("Local Business Finder");

    const legacyMapTitles = new Set([
      "Map Scraper",
      "Maps Scraper",
      "Google Maps Scraper",
      "Yandex Maps Scraper",
    ]);

    for (const messages of Object.values(locales)) {
      const title = messages.mapScraper.title;
      expect(typeof title).toBe("string");
      expect(title.length).toBeGreaterThan(0);
      expect(legacyMapTitles.has(title)).toBe(false);

      // Neutral channel and export wording is mandated verbatim by the
      // compliance PRD — identical in every locale, never localized.
      expect(messages.mapScraper.provider_google).toBe(
        "Channel Alpha (Global)"
      );
      expect(messages.mapScraper.provider_yandex).toBe(
        "Channel Beta (CIS Region)"
      );
      expect(messages.mapScraper.export_csv).toBe("Export To Routing Sheet");
    }
  });

  test("keeps Market Insight search engine names explicit", () => {
    for (const messages of Object.values(locales)) {
      expect(messages.search.google).toBe("Google");
      expect(messages.search.yandex).toBe("Yandex");
    }
  });

  test("localizes Market Insight guidance in every supported language", () => {
    const expectedSearchCopy: Record<
      string,
      {
        placeholder: string;
        notice: string;
        useHint: string;
        failure: string;
        editTask: string;
        aiRecoveryHint: string;
      }
    > = {
      en: {
        placeholder:
          "Enter a public web source or industry keyword for market insight...",
        notice:
          "Note: This feature only structures information from public web pages. Please ensure your research activity complies with the target site's robots policy.",
        useHint:
          "Input public sources or industry keywords for market insight organization",
        failure: "Market insight organization failed",
        editTask: "Edit Market Insight Task",
        aiRecoveryHint:
          "When enabled, AI will help recover from data alignment errors by analyzing page structure and suggesting alternative actions",
      },
      zh: {
        placeholder: "请输入您需要进行市场洞察的公开网络源或行业关键词...",
        notice:
          "注：本功能仅用于公开网页信息的自动化结构化整理，请确保您的检索行为符合目标网站的 Robots 协议。",
        useHint: "输入公开来源或行业关键词，用于市场洞察整理",
        failure: "市场洞察整理失败",
        editTask: "编辑市场洞察任务",
        aiRecoveryHint:
          "启用后，AI 将通过分析页面结构并建议替代操作，帮助从数据对齐错误中恢复",
      },
      es: {
        placeholder:
          "Introduce una fuente web pública o una palabra clave del sector para obtener información de mercado...",
        notice:
          "Nota: Esta función solo estructura información de páginas web públicas. Asegúrate de que tu actividad de investigación cumpla con la política de robots del sitio de destino.",
        useHint:
          "Introduce fuentes públicas o palabras clave del sector para organizar información de mercado",
        failure: "Error al organizar información de mercado",
        editTask: "Editar tarea de información de mercado",
        aiRecoveryHint:
          "Cuando está activado, la IA ayuda a recuperarse de errores de alineación de datos analizando la estructura de la página y sugiriendo acciones alternativas",
      },
      fr: {
        placeholder:
          "Saisissez une source web publique ou un mot-clé sectoriel pour l'analyse de marché...",
        notice:
          "Remarque : cette fonction structure uniquement les informations de pages web publiques. Assurez-vous que votre recherche respecte la politique robots du site cible.",
        useHint:
          "Saisissez des sources publiques ou des mots-clés sectoriels pour organiser les informations de marché",
        failure: "Échec de l'organisation des informations de marché",
        editTask: "Modifier la tâche d'analyse de marché",
        aiRecoveryHint:
          "Lorsque cette option est activée, l'IA aide à récupérer les erreurs d'alignement des données en analysant la structure de la page et en suggérant des actions alternatives",
      },
      de: {
        placeholder:
          "Geben Sie eine öffentliche Webquelle oder ein Branchenstichwort für Marktinformationen ein...",
        notice:
          "Hinweis: Diese Funktion strukturiert nur Informationen aus öffentlichen Webseiten. Stellen Sie sicher, dass Ihre Recherche die Robots-Richtlinie der Zielwebsite einhält.",
        useHint:
          "Geben Sie öffentliche Quellen oder Branchenstichwörter ein, um Marktinformationen zu strukturieren",
        failure: "Strukturierung der Marktinformationen fehlgeschlagen",
        editTask: "Marktinformation-Aufgabe bearbeiten",
        aiRecoveryHint:
          "Wenn aktiviert, hilft KI bei der Wiederherstellung nach Datenabgleichsfehlern, indem sie die Seitenstruktur analysiert und alternative Aktionen vorschlägt",
      },
      ja: {
        placeholder:
          "市場インサイトに使用する公開Webソースまたは業界キーワードを入力してください...",
        notice:
          "注: この機能は公開Webページの情報を構造化するためのものです。調査操作が対象サイトのrobotsポリシーに準拠していることを確認してください。",
        useHint:
          "市場インサイト整理に使用する公開ソースまたは業界キーワードを入力してください",
        failure: "市場インサイトの整理に失敗しました",
        editTask: "市場インサイトタスクを編集",
        aiRecoveryHint:
          "有効にすると、AI がページ構造を分析して代替操作を提案し、データ整合エラーからの復旧を支援します",
      },
    };

    for (const [locale, messages] of Object.entries(locales)) {
      expect(messages.search.market_insight_placeholder).toBe(
        expectedSearchCopy[locale].placeholder
      );
      expect(messages.search.public_information_notice).toBe(
        expectedSearchCopy[locale].notice
      );
      expect(messages.search.use_hint).toBe(expectedSearchCopy[locale].useHint);
      expect(messages.search.scraper_failed).toBe(
        expectedSearchCopy[locale].failure
      );
      expect(messages.search.edit_task).toBe(
        expectedSearchCopy[locale].editTask
      );
      expect(messages.search.enable_ai_recovery_hint).toBe(
        expectedSearchCopy[locale].aiRecoveryHint
      );
    }
  });
});
