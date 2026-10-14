/**
 * Bounded archive-source navigation (B13, FR-HIS-001, design §12.11).
 *
 * The history drawer can surface passages older than the mounted transcript
 * window. Navigation loads a bounded run of older pages through the history
 * API (the store retains its 200-message cap throughout), then scrolls and
 * focuses the source. Sources beyond the bounded window, unavailable
 * sources, and mid-retrieval selection changes resolve safely without
 * navigating the wrong chat.
 */

export interface HistoryNavigateDeps {
  /** Conversation Navigate was issued in (rechecked after every await). */
  readonly getSelectionId: () => string | null;
  readonly hasOlder: () => boolean;
  readonly isLoadingOlder: () => boolean;
  readonly loadOlder: () => Promise<void>;
  readonly nextFrame: () => Promise<void>;
  readonly queryMessageElement: (messageId: string) => HTMLElement | null;
  readonly scrollToElement: (el: HTMLElement) => void;
  readonly showUnavailable: () => void;
}

export type HistoryNavigateOutcome =
  | "scrolled"
  | "unavailable"
  | "aborted";

/** Maximum older-page loads per navigation (bounded retrieval). */
export const HISTORY_NAVIGATE_MAX_PAGES = 8;

export async function navigateToHistorySource(
  messageId: string,
  originConversationId: string | null,
  deps: HistoryNavigateDeps,
  maxPages: number = HISTORY_NAVIGATE_MAX_PAGES
): Promise<HistoryNavigateOutcome> {
  await deps.nextFrame();
  if (deps.getSelectionId() !== originConversationId) return "aborted";
  if (deps.queryMessageElement(messageId)) {
    const el = deps.queryMessageElement(messageId);
    if (el) deps.scrollToElement(el);
    return "scrolled";
  }
  for (let page = 0; page < maxPages; page += 1) {
    if (deps.getSelectionId() !== originConversationId) return "aborted";
    if (!deps.hasOlder() || deps.isLoadingOlder()) break;
    await deps.loadOlder();
    await deps.nextFrame();
    if (deps.getSelectionId() !== originConversationId) return "aborted";
    const el = deps.queryMessageElement(messageId);
    if (el) {
      deps.scrollToElement(el);
      return "scrolled";
    }
    if (!deps.hasOlder()) break;
  }
  if (deps.getSelectionId() !== originConversationId) return "aborted";
  deps.showUnavailable();
  return "unavailable";
}
