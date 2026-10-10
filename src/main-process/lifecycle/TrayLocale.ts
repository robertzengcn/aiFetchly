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
    keepRunning: "Keep running in system tray",
    cancel: "Cancel",
    closeTitle: "Close AiFetchly?",
    closeDescription:
      "Exit stops running tasks. Keep running hides the window and lets tasks continue in the system tray.",
    exiting: "Exiting AiFetchly…",
  },
  zh: {
    tooltip: "AiFetchly",
    open: "打开 AiFetchly",
    exit: "退出应用程序",
    keepRunning: "保持在系统托盘运行",
    cancel: "取消",
    closeTitle: "关闭 AiFetchly？",
    closeDescription:
      "退出将停止正在运行的任务。保持运行会隐藏窗口，任务继续在系统托盘中运行。",
    exiting: "正在退出 AiFetchly…",
  },
  es: {
    tooltip: "AiFetchly",
    open: "Abrir AiFetchly",
    exit: "Salir de la aplicación",
    keepRunning: "Mantener en la bandeja del sistema",
    cancel: "Cancelar",
    closeTitle: "¿Cerrar AiFetchly?",
    closeDescription:
      "Salir detiene las tareas en ejecución. Mantener en ejecución oculta la ventana y las tareas continúan en la bandeja del sistema.",
    exiting: "Saliendo de AiFetchly…",
  },
  fr: {
    tooltip: "AiFetchly",
    open: "Ouvrir AiFetchly",
    exit: "Quitter l'application",
    keepRunning: "Continuer dans la barre système",
    cancel: "Annuler",
    closeTitle: "Fermer AiFetchly ?",
    closeDescription:
      "Quitter arrête les tâches en cours. Continuer en arrière-plan masque la fenêtre et les tâches continuent dans la barre système.",
    exiting: "Fermeture d'AiFetchly…",
  },
  de: {
    tooltip: "AiFetchly",
    open: "AiFetchly öffnen",
    exit: "Anwendung beenden",
    keepRunning: "Im Infobereich weiterlaufen lassen",
    cancel: "Abbrechen",
    closeTitle: "AiFetchly schließen?",
    closeDescription:
      "Beenden hält laufende Aufgaben an. Weiter im Infobereich blendet das Fenster aus; die Aufgaben laufen dort weiter.",
    exiting: "AiFetchly wird beendet…",
  },
  ja: {
    tooltip: "AiFetchly",
    open: "AiFetchly を開く",
    exit: "アプリケーションを終了",
    keepRunning: "システムトレイで実行を続ける",
    cancel: "キャンセル",
    closeTitle: "AiFetchly を閉じますか？",
    closeDescription:
      "終了すると実行中のタスクが停止します。「システムトレイで実行を続ける」はウィンドウを非表示にし、タスクはシステムトレイで続行されます。",
    exiting: "AiFetchly を終了しています…",
  },
};

export const TRAY_LOCALE_CODES = Object.keys(LABELS);

/** Labels for a locale code (unknown codes fall back to English). */
export function trayLabelsForLocale(
  locale: string | null | undefined
): TrayLabels {
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
