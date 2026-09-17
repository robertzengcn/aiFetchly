import * as fs from "fs";
import * as path from "path";
import { log } from "@/modules/Logger";

/**
 * TrayController — system-tray lifetime, icon, menu, restoration
 * (PRD FR-02, FR-03, FR-07; technical design §9).
 *
 * Electron surface is injected via {@link TrayControllerPorts} so the
 * controller logic (readiness gating, menu semantics, exit routing,
 * locale-driven rebuilds) is unit-testable without a real tray.
 *
 * Invariants:
 *  - The tray icon is created and RETAINED before any window hide is
 *    allowed (AC-02): {@link isReady} flips background availability.
 *  - Creation failure never fails app startup and never leaves the app in
 *    an unreachable state — availability simply stays false (AC-10).
 *  - Tray Exit routes through the same lifecycle exit path as every other
 *    exit source (FR-04); it bypasses the close-choice dialog (FR-03).
 *  - The tray is destroyed exactly once at shutdown finalize.
 */

/**
 * Localized labels, resolved lazily so locale changes rebuild the menu.
 * The close-dialog strings back the native fallback dialog (design §9);
 * they mirror the `applicationLifecycle` renderer namespace.
 */
export interface TrayLabels {
  readonly tooltip: string;
  readonly open: string;
  readonly exit: string;
  readonly keepRunning: string;
  readonly cancel: string;
  readonly closeTitle: string;
  readonly closeDescription: string;
  /** Tray-level "exiting" affordance while quitting (FR-04, TODO 10). */
  readonly exiting: string;
}

export interface TrayMenuLike {
  popUpContextMenu(): void;
}

export interface TrayLike {
  setToolTip(tooltip: string): void;
  setContextMenu(menu: TrayMenuLike): void;
  on(event: "click", listener: (...args: unknown[]) => void): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(
    event: string,
    listener: (...args: unknown[]) => void
  ): unknown;
  destroy(): void;
  isDestroyed(): boolean;
}

export interface TrayControllerPorts {
  /** Build a tray bound to the resolved icon (returns null on failure). */
  readonly createTray: (iconPath: string | null) => TrayLike | null;
  /** Build a menu with Open/Exit items calling the given callbacks. */
  readonly buildMenu: (
    labels: TrayLabels,
    actions: TrayActions
  ) => TrayMenuLike;
  /** Restore + focus the main window (tray Open / click activation). */
  readonly restoreWindow: () => void;
  /** Begin the coordinated exit (FR-04 shared path). */
  readonly requestExit: () => void;
  /** Current localized labels (re-read on every rebuild). */
  readonly labels: () => TrayLabels;
  /** Candidate icon paths in priority order. */
  readonly iconCandidates: () => string[];
}

export interface TrayActions {
  readonly open: () => void;
  readonly exit: () => void;
}

export class TrayController {
  private tray: TrayLike | null = null;
  private readonly ports: TrayControllerPorts;
  private ready = false;
  private destroyed = false;
  private exiting = false;
  private readonly clickHandler = (): void => {
    this.restore();
  };

  constructor(ports: TrayControllerPorts) {
    this.ports = ports;
  }

  /** Create the tray. Safe to call once at app-ready. */
  initialize(): boolean {
    if (this.destroyed || this.tray) return this.ready;
    let tray: TrayLike | null = null;
    try {
      const icon = this.ports
        .iconCandidates()
        .find((candidate) => fs.existsSync(candidate));
      tray = this.ports.createTray(icon ?? null);
    } catch (err) {
      log.warn(
        "[tray] creation failed (background mode stays unavailable):",
        err instanceof Error ? err.message : String(err)
      );
    }
    if (!tray) {
      this.ready = false;
      return false;
    }
    this.tray = tray;
    try {
      // Click activation restores the window (FR-03); menu stays available
      // via platform tray affordances.
      tray.on("click", this.clickHandler);
      this.rebuildMenu();
      this.ready = true;
    } catch (err) {
      log.warn(
        "[tray] wiring failed:",
        err instanceof Error ? err.message : String(err)
      );
      this.destroyTray();
      this.ready = false;
      return false;
    }
    return true;
  }

  /** Tray exists and is functional — prerequisite for hiding (AC-02). */
  isReady(): boolean {
    return this.ready && this.tray !== null && !this.tray.isDestroyed();
  }

  /** Locale changes rebuild menu labels (design §9). */
  rebuildMenu(): void {
    if (!this.tray || this.tray.isDestroyed()) return;
    const labels = this.ports.labels();
    if (this.exiting) {
      // FR-04 / TODO 10: while quitting, the tray itself reflects the
      // exiting state and stops offering restore/task actions.
      this.tray.setToolTip(`${labels.tooltip} — ${labels.exiting}`);
    } else {
      this.tray.setToolTip(labels.tooltip);
    }
    this.tray.setContextMenu(
      this.ports.buildMenu(labels, {
        open: () => {
          if (!this.exiting) this.restore();
        },
        exit: () => {
          if (!this.exiting) this.ports.requestExit();
        },
      })
    );
  }

  /**
   * Reflect the shutdown state in the tray (FR-04). While exiting, the
   * tooltip appends the exiting label and the Open/Exit actions become
   * no-ops (repeated requests join the same shutdown, AC-08).
   */
  setExiting(exiting: boolean): void {
    if (this.exiting === exiting) return;
    this.exiting = exiting;
    this.rebuildMenu();
  }

  /** Tray Open / click: restore the existing window (AC-03). */
  restore(): void {
    if (this.destroyed) return;
    this.ports.restoreWindow();
  }

  /** Destroy at shutdown finalize — exactly once, never throws. */
  destroy(): void {
    this.destroyed = true;
    this.ready = false;
    this.destroyTray();
  }

  private destroyTray(): void {
    if (!this.tray) return;
    try {
      this.tray.removeListener("click", this.clickHandler);
      this.tray.destroy();
    } catch (err) {
      log.warn(
        "[tray] destroy failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
    this.tray = null;
  }
}

/**
 * Linux tray-host plausibility (PRD FR-07 / TODO 9): environments where a
 * Tray object can be constructed but no status-notifier host will ever show
 * it (headless sessions, raw tty, no desktop registered). Keep-running
 * stays disabled there so the window is never hidden into an unreachable
 * state. Non-Linux platforms are always plausible.
 */
export function isLinuxTrayHostPlausible(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): boolean {
  if (platform !== "linux") return true;
  const desktop = env.XDG_CURRENT_DESKTOP;
  if (!desktop || desktop.trim().length === 0) return false;
  if ((env.XDG_SESSION_TYPE ?? "").toLowerCase() === "tty") return false;
  return true;
}

/**
 * Resolve tray icon candidates (main bundle dir first, then packaged
 * resources) matching the platform-copy plugin's output location.
 */
export function resolveTrayIconCandidates(dirname: string): string[] {
  return [
    path.join(dirname, "icon.png"),
    path.join(dirname, "..", "icon.png"),
    path.join(
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ??
        dirname,
      "icon.png"
    ),
  ];
}
