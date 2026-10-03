/**
 * Versioned historical-recall dataset (PRD §10, design §17.4).
 *
 * 50 long-conversation cases across the six supported languages
 * (en/zh/es/fr/de/ja). Each case carries a unique exact marker plus the
 * surrounding text to seed. The deterministic suite
 * (`AIChatHistoricalRecall.test.ts`) proves the STORAGE half: every marker is
 * exactly recoverable via search→read after compaction-shaped archiving.
 *
 * The MODEL half (≥95% correct source-backed answers, zero fabricated exact
 * quotes under the release model/provider) needs a live provider and runs
 * only with `AIFETCHLY_RECALL_LIVE=1`; see the dataset runner notes at the
 * bottom. Record model/window, source-backed accuracy, and fabricated-quote
 * count with each live run.
 *
 * Version: 1. Extend only by appending new ids (never renumber).
 */
export interface RecallCase {
  /** Stable id, e.g. "en-03". Never renumbered. */
  readonly id: string;
  /** BCP-47-ish short tag matching the app's six locales. */
  readonly lang: "en" | "zh" | "es" | "fr" | "de" | "ja";
  /** Unique exact marker the test searches for (verbatim). */
  readonly marker: string;
  /** Full message text seeded into the archive (contains the marker). */
  readonly text: string;
}

function c(
  id: string,
  lang: RecallCase["lang"],
  marker: string,
  text: string
): RecallCase {
  if (!text.includes(marker)) {
    throw new Error(`dataset case ${id}: text must contain its marker`);
  }
  return { id, lang, marker, text };
}

export const RECALL_DATASET_V1: readonly RecallCase[] = [
  // ---- English (8) ----
  c("en-01", "en", "RECALL-EN-ALPHA-7741",
    "The launch checklist reference is RECALL-EN-ALPHA-7741 for the spring campaign."),
  c("en-02", "en", "RECALL-EN-NUM-3.14159",
    "Use the column order: email, company, country. Budget cap RECALL-EN-NUM-3.14159 applies."),
  c("en-03", "en", "RECALL-EN-URL-9910",
    "Dashboard link for Q3: https://example.com/dash/RECALL-EN-URL-9910?tab=overview."),
  c("en-04", "en", "RECALL-EN-DECIDE-2210",
    "Decision: we will sunset the legacy importer (RECALL-EN-DECIDE-2210) by October."),
  c("en-05", "en", "RECALL-EN-CORRECT-2211",
    "Correction: keep the legacy importer after all; supersedes RECALL-EN-DECIDE-2210 (see RECALL-EN-CORRECT-2211)."),
  c("en-06", "en", "RECALL-EN-REJECT-3305",
    "Rejected alternative: nightly full-table sync, too costly (RECALL-EN-REJECT-3305)."),
  c("en-07", "en", "RECALL-EN-QUOTE-4412",
    "Exact subject line to reuse: “Fall styles are here, Maria” (RECALL-EN-QUOTE-4412)."),
  c("en-08", "en", "RECALL-EN-LIMIT-100k",
    "Hard limit: at most 100000 contacts per export batch (RECALL-EN-LIMIT-100k)."),
  // ---- Chinese (8) ----
  c("zh-01", "zh", "RECALL-ZH-甲-1101",
    "春季营销活动的参考编号是RECALL-ZH-甲-1101，请勿遗失。"),
  c("zh-02", "zh", "RECALL-ZH-数字-3.14159",
    "列顺序为：邮箱、公司、国家，预算上限RECALL-ZH-数字-3.14159。"),
  c("zh-03", "zh", "RECALL-ZH-链接-9910",
    "第三季度看板链接：https://example.com/看板/RECALL-ZH-链接-9910。"),
  c("zh-04", "zh", "RECALL-ZH-决定-2210",
    "决定：十月前下线旧版导入器（RECALL-ZH-决定-2210）。"),
  c("zh-05", "zh", "RECALL-ZH-更正-2211",
    "更正：旧版导入器予以保留，取代之前的决定（RECALL-ZH-更正-2211）。"),
  c("zh-06", "zh", "RECALL-ZH-否决-3305",
    "已否决方案： nightly 全表同步，成本过高（RECALL-ZH-否决-3305）。"),
  c("zh-07", "zh", "RECALL-ZH-引用-4412",
    "请复用的准确标题：“秋季新品到了，玛丽”（RECALL-ZH-引用-4412）。"),
  c("zh-08", "zh", "RECALL-ZH-上限-100k",
    "硬性限制：每个导出批次最多100000个联系人（RECALL-ZH-上限-100k）。"),
  // ---- Spanish (8) ----
  c("es-01", "es", "RECALL-ES-ALFA-1101",
    "La referencia de la campaña de primavera es RECALL-ES-ALFA-1101."),
  c("es-02", "es", "RECALL-ES-NUM-3.14159",
    "Orden de columnas: correo, empresa, país. Límite RECALL-ES-NUM-3.14159."),
  c("es-03", "es", "RECALL-ES-URL-9910",
    "Panel del tercer trimestre: https://example.com/panel/RECALL-ES-URL-9910."),
  c("es-04", "es", "RECALL-ES-DECIDE-2210",
    "Decisión: retirar el importador heredado (RECALL-ES-DECIDE-2210) en octubre."),
  c("es-05", "es", "RECALL-ES-CORRIGE-2211",
    "Corrección: conservar el importador heredado; sustituye a RECALL-ES-DECIDE-2210 (véase RECALL-ES-CORRIGE-2211)."),
  c("es-06", "es", "RECALL-ES-RECHAZA-3305",
    "Alternativa rechazada: sincronización nocturna completa, costosa (RECALL-ES-RECHAZA-3305)."),
  c("es-07", "es", "RECALL-ES-CITA-4412",
    "Asunto exacto para reutilizar: «Ya llegó el otoño, María» (RECALL-ES-CITA-4412)."),
  c("es-08", "es", "RECALL-ES-LIMITE-100k",
    "Límite estricto: máximo 100000 contactos por lote (RECALL-ES-LIMITE-100k)."),
  // ---- French (8) ----
  c("fr-01", "fr", "RECALL-FR-ALPHA-1101",
    "La référence de la campagne de printemps est RECALL-FR-ALPHA-1101."),
  c("fr-02", "fr", "RECALL-FR-NUM-3.14159",
    "Ordre des colonnes : e-mail, société, pays. Plafond RECALL-FR-NUM-3.14159."),
  c("fr-03", "fr", "RECALL-FR-URL-9910",
    "Tableau de bord T3 : https://example.com/tableau/RECALL-FR-URL-9910."),
  c("fr-04", "fr", "RECALL-FR-DECIDE-2210",
    "Décision : retirer l’importateur historique (RECALL-FR-DECIDE-2210) en octobre."),
  c("fr-05", "fr", "RECALL-FR-CORRIGE-2211",
    "Correction : conserver l’importateur historique ; remplace RECALL-FR-DECIDE-2210 (voir RECALL-FR-CORRIGE-2211)."),
  c("fr-06", "fr", "RECALL-FR-REJETTE-3305",
    "Alternative rejetée : synchronisation nocturne complète, trop coûteuse (RECALL-FR-REJETTE-3305)."),
  c("fr-07", "fr", "RECALL-FR-CITE-4412",
    "Objet exact à réutiliser : « L’automne est arrivé, Marie » (RECALL-FR-CITE-4412)."),
  c("fr-08", "fr", "RECALL-FR-LIMITE-100k",
    "Limite stricte : 100000 contacts maximum par lot (RECALL-FR-LIMITE-100k)."),
  // ---- German (8) ----
  c("de-01", "de", "RECALL-DE-ALPHA-1101",
    "Die Referenz der Frühjahrskampagne lautet RECALL-DE-ALPHA-1101."),
  c("de-02", "de", "RECALL-DE-NUM-3.14159",
    "Spaltenreihenfolge: E-Mail, Firma, Land. Obergrenze RECALL-DE-NUM-3.14159."),
  c("de-03", "de", "RECALL-DE-URL-9910",
    "Dashboard für Q3: https://example.com/dashboard/RECALL-DE-URL-9910."),
  c("de-04", "de", "RECALL-DE-ENTSCHEID-2210",
    "Entscheidung: alten Importer bis Oktober abschalten (RECALL-DE-ENTSCHEID-2210)."),
  c("de-05", "de", "RECALL-DE-KORREKTUR-2211",
    "Korrektur: alten Importer doch behalten; ersetzt RECALL-DE-ENTSCHEID-2210 (siehe RECALL-DE-KORREKTUR-2211)."),
  c("de-06", "de", "RECALL-DE-ABLEHN-3305",
    "Abgelehnte Alternative: nächtlicher Vollabgleich, zu teuer (RECALL-DE-ABLEHN-3305)."),
  c("de-07", "de", "RECALL-DE-ZITAT-4412",
    "Exakte Betreffzeile zur Wiederverwendung: „Herbststyles sind da, Maria“ (RECALL-DE-ZITAT-4412)."),
  c("de-08", "de", "RECALL-DE-LIMIT-100k",
    "Hartes Limit: höchstens 100000 Kontakte pro Export (RECALL-DE-LIMIT-100k)."),
  // ---- Japanese (8) ----
  c("ja-01", "ja", "RECALL-JA-甲-1101",
    "春キャンペーンの参照番号はRECALL-JA-甲-1101です。"),
  c("ja-02", "ja", "RECALL-JA-数値-3.14159",
    "列の順序：メール、会社、国。上限はRECALL-JA-数値-3.14159。"),
  c("ja-03", "ja", "RECALL-JA-URL-9910",
    "Q3ダッシュボード：https://example.com/ダッシュボード/RECALL-JA-URL-9910。"),
  c("ja-04", "ja", "RECALL-JA-決定-2210",
    "決定：10月までに旧インポーターを廃止する（RECALL-JA-決定-2210）。"),
  c("ja-05", "ja", "RECALL-JA-訂正-2211",
    "訂正：旧インポーターは維持する。RECALL-JA-決定-2210を取り消す（RECALL-JA-訂正-2211参照）。"),
  c("ja-06", "ja", "RECALL-JA-却下-3305",
    "却下案：夜間フル同期はコスト過大（RECALL-JA-却下-3305）。"),
  c("ja-07", "ja", "RECALL-JA-引用-4412",
    "再利用する正確な件名：「秋の新作が届きました、マリア」（RECALL-JA-引用-4412）。"),
  c("ja-08", "ja", "RECALL-JA-上限-100k",
    "上限：1バッチあたり最大100000件（RECALL-JA-上限-100k）。"),
  // ---- Cross-language / edge (2) ----
  c("en-09", "en", "RECALL-X-EMOJI-🎯-5510",
    "Milestone marker with emoji 🎯 inline: RECALL-X-EMOJI-🎯-5510 do not split it."),
  c("en-10", "en", "RECALL-X-LONG-6610",
    "Padding " + "lorem ipsum dolor sit amet ".repeat(40) + "tail marker RECALL-X-LONG-6610."),
];
