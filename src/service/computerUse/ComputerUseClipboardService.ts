/**
 * Computer Use clipboard service (design §6.3, W1-5).
 *
 * Rows are inserted by paste: the host writes tab-separated text to the
 * clipboard with the main-process Electron clipboard API, the agent pastes,
 * and the host then restores the user's previous clipboard text. Rich
 * clipboard formats are not preserved — the user is told so on first use.
 *
 * Restore runs on success, failure, AND stop: a saved clipboard must never
 * leak into a stopped run's cleanup path.
 */

/** Injectable seam over Electron's main-process clipboard. */
export interface ClipboardSeam {
  readText(): string;
  writeText(text: string): void;
}

export interface SavedClipboard {
  readonly previousText: string;
  /** Restore the saved text. Idempotent. */
  restore: () => void;
}

export class ComputerUseClipboardService {
  private saved: SavedClipboard | null = null;

  constructor(private readonly clipboard: ClipboardSeam) {}

  /**
   * Save the user's current clipboard text and write the TSV payload.
   * Returns the saved handle whose `restore()` puts the user's text back.
   */
  beginPaste(tsv: string): SavedClipboard {
    const previousText = this.clipboard.readText();
    this.clipboard.writeText(tsv);
    let restored = false;
    const saved: SavedClipboard = {
      previousText,
      restore: () => {
        if (restored) return;
        restored = true;
        this.clipboard.writeText(previousText);
        if (this.saved === saved) this.saved = null;
      },
    };
    this.saved = saved;
    return saved;
  }

  /** Restore after a successful paste. */
  restoreAfterSuccess(saved: SavedClipboard): void {
    saved.restore();
  }

  /** Restore after a failed paste — the payload never lingers. */
  restoreAfterFailure(saved: SavedClipboard): void {
    saved.restore();
  }

  /** Restore during stop/cleanup; safe when nothing is pending. */
  restoreOnStop(): void {
    this.saved?.restore();
  }

  /** Whether a paste is pending (diagnostics). */
  get pastePending(): boolean {
    return this.saved !== null;
  }
}
