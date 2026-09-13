import type { TrayLabels } from "@/main-process/lifecycle/TrayController";

/**
 * TrayLocale — main-process locale adapter for tray/menu labels
 * (PRD FR-08, design §10: "main-process menus use the selected locale
 * through an established or dedicated locale adapter").
 *
 * The label table mirrors the `applicationLifecycle` translation namespace
 * in src/views/lang/*.ts (single source: keep both in sync — the i18n
 * parity test below enforces key equality across languages). The locale is
 * resolved through the SAME persistence the renderer uses
 * (SystemSettingController language preference), falling back to English
 * when the store is unreachable (early startup / test hosts).
 */

const LABELS: Record<string, TrayLabels> = {
  en: {
    tooltip: "AiFetchly",
    open: "Open AiFetchly",
    exit: "Exit application",
  },
  zh: {
    tooltip: "AiFetchly",
    open: "打开 AiFetchly",
    exit: "退出应用程序",
  },
  es: {
    tooltip: "AiFetchly",
    open: "Abrir AiFetchly",
    exit: "Salir de la aplicación",
  },
  fr: {
    tooltip: "AiFetchly",
    open: "Ouvrir AiFetchly",
    exit: "Quitter l'application",
  },
  de: {
    tooltip: "AiFetchly",
    open: "AiFetchly öffnen",
    exit: "Anwendung beenden",
  },
  ja: {
    tooltip: "AiFetchly",
    open: "AiFetchly を開く",
    exit: "アプリケーションを終了",
  },
};

export const TRAY_LOCALE_CODES = Object.keys(LABELS);

/** Labels for a locale code (unknown codes fall back to English). */
export function trayLabelsForLocale(locale: string | null | undefined): TrayLabels {
  return (locale && LABELS[locale]) || LABELS.en;
}

/**
 * Resolve the current tray labels from the persisted language preference.
 * Never throws — an unreadable store yields English.
 */
export async function resolveTrayLabels(
  getLanguagePreference: () => Promise<string> = defaultLanguagePreference
): Promise<TrayLabels> {
  try {
    const locale = await getLanguagePreference();
    return trayLabelsForLocale(locale);
  } catch {
    return LABELS.en;
  }
}

async function defaultLanguagePreference(): Promise<string> {
  const { SystemSettingController } = await import(
    "@/controller/SystemSettingController"
  );
  return new SystemSettingController().getLanguagePreference();
}
