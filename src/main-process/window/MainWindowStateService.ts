import { ElectronStoreService } from "@/modules/electronstoreservice";
import {
  computeInitialBounds,
  normalizeSavedState,
  selectRestoreDisplay,
  type DisplayWorkArea,
  type SavedMainWindowState,
  type WindowBounds,
} from "@/main-process/window/mainWindowGeometry";

/**
 * Main-window state persistence (chat-first shell design §14.4).
 *
 * Reads and writes ONE versioned JSON string through ElectronStoreService;
 * all geometry decisions are made by the pure mainWindowGeometry module.
 * Corrupt or unavailable state never becomes a startup-fatal error — the
 * service always resolves to usable bounds.
 */

const STATE_KEY = "mainWindow.state.v1";
const DEFAULT_DEBOUNCE_MS = 250;

/** Minimal persistence surface (satisfied by ElectronStoreService). */
export interface MainWindowStateStore {
  getValue(key: string): unknown;
  setValue(key: string, value: string): void;
}

/** Electron screen surface used by the service. */
export interface ScreenLike {
  getAllDisplays(): readonly ElectronDisplayLike[];
  getPrimaryDisplay(): ElectronDisplayLike;
}

export interface ElectronDisplayLike {
  id: number;
  scaleFactor: number;
  workArea: { x: number; y: number; width: number; height: number };
}

/** Electron BrowserWindow surface used by the service. */
export interface MainWindowLike {
  on(event: string, listener: () => void): unknown;
  getNormalBounds(): WindowBounds;
  isMaximized(): boolean;
}

export interface ResolvedInitialState {
  readonly normalBounds: WindowBounds;
  readonly maximized: boolean;
  readonly source: "saved" | "default";
}

export interface MainWindowStateDeps {
  readonly store?: MainWindowStateStore;
  readonly screen: ScreenLike;
  /** E2E mode: ignore persisted state, use deterministic bounds, no writes. */
  readonly e2e?: boolean;
  readonly debounceMs?: number;
}

function toWorkArea(display: ElectronDisplayLike): DisplayWorkArea {
  return {
    displayId: String(display.id),
    scaleFactor: display.scaleFactor,
    ...display.workArea,
  };
}

export class MainWindowStateService {
  private readonly store: MainWindowStateStore;
  private readonly screen: ScreenLike;
  private readonly e2e: boolean;
  private readonly debounceMs: number;

  private window: MainWindowLike | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(deps: MainWindowStateDeps) {
    this.screen = deps.screen;
    this.e2e = deps.e2e ?? false;
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.store =
      deps.store ??
      (() => {
        try {
          return new ElectronStoreService("main-window");
        } catch {
          // Store unavailable — resolve bounds but never persist.
          return null as unknown as MainWindowStateStore;
        }
      })();
  }

  /**
   * Resolve the bounds + maximized preference for window creation
   * (design §14.6). Saved state wins only when it validates against the
   * currently connected displays; otherwise centered defaults. E2E runs use
   * deterministic defaults and never read the developer's saved bounds.
   */
  resolveInitialState(): ResolvedInitialState {
    const primary = toWorkArea(this.screen.getPrimaryDisplay());
    if (this.e2e) {
      return {
        normalBounds: computeInitialBounds(primary),
        maximized: false,
        source: "default",
      };
    }
    let raw: unknown = null;
    try {
      const value = this.store.getValue(STATE_KEY);
      raw = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    } catch {
      // Corrupt or unavailable state — fall through to defaults.
    }
    const saved =
      raw === null
        ? null
        : normalizeSavedState(raw, this.currentDisplays(), primary);
    if (saved) {
      return {
        normalBounds: saved.normalBounds,
        maximized: saved.maximized,
        source: "saved",
      };
    }
    return {
      normalBounds: computeInitialBounds(primary),
      maximized: false,
      source: "default",
    };
  }

  /**
   * Attach debounced persistence listeners (design §14.4). Stores
   * `getNormalBounds()` — never the maximized screen bounds — plus the
   * explicit maximized preference.
   */
  attach(window: MainWindowLike): void {
    if (this.e2e) return; // deterministic runs never write window state
    this.window = window;
    for (const event of ["move", "resize", "maximize", "unmaximize"]) {
      window.on(event, () => this.schedulePersist());
    }
    window.on("close", () => this.persistNow());
  }

  /** Detach and cancel pending work (safe on destroy, design §17.4). */
  detach(): void {
    this.destroyed = true;
    this.cancelPendingPersist();
    this.window = null;
  }

  /** Flush a pending debounced write immediately (normal close path). */
  persistNow(): void {
    if (this.destroyed || !this.window || this.e2e) return;
    this.cancelPendingPersist();
    try {
      const saved: SavedMainWindowState = {
        version: 1,
        normalBounds: this.window.getNormalBounds(),
        maximized: this.window.isMaximized(),
        displayId: this.currentDisplayId(),
      };
      this.store.setValue(STATE_KEY, JSON.stringify(saved));
    } catch {
      // Persistence failure must never break the window lifecycle.
    }
  }

  private schedulePersist(): void {
    if (this.destroyed || !this.window) return;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.persistNow();
    }, this.debounceMs);
  }

  private cancelPendingPersist(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private currentDisplays(): readonly DisplayWorkArea[] {
    return this.screen.getAllDisplays().map(toWorkArea);
  }

  /** Display whose work area owns the window center (for save/restore). */
  private currentDisplayId(): string | undefined {
    const window = this.window;
    if (!window) return undefined;
    const bounds = window.getNormalBounds();
    const primary = toWorkArea(this.screen.getPrimaryDisplay());
    const center: SavedMainWindowState = {
      version: 1,
      maximized: false,
      // A 1x1 probe at the window center: the display with the greatest
      // intersection is the display the window lives on.
      normalBounds: {
        x: bounds.x + Math.floor(bounds.width / 2),
        y: bounds.y + Math.floor(bounds.height / 2),
        width: 1,
        height: 1,
      },
    };
    return selectRestoreDisplay(center, this.currentDisplays(), primary)
      .displayId;
  }
}
