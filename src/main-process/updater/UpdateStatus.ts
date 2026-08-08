/**
 * Pure update-status model for the About aiFetchly page.
 *
 * Everything in this file is free of Electron / Node side effects so it can be
 * unit-tested directly and shared between the main-process service and tests.
 */

/** UI-facing update states (PRD FR-4.5). */
export type UpdateStatusState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'ready-to-restart'
  | 'unsupported'
  | 'error';

/** Why GitHub self-update is unavailable on this channel (PRD FR-5). */
export type UpdateUnsupportedReason = 'development' | 'store' | 'platform';

/**
 * Immutable status snapshot pushed to the renderer. Contains no credentials and
 * no feed details beyond the public website version labels.
 */
export interface UpdateStatusSnapshot {
  readonly state: UpdateStatusState;
  readonly unsupportedReason?: UpdateUnsupportedReason;
  /** Installed version, sourced from app.getVersion(). */
  readonly currentVersion: string;
  /** Version available for download, when known. */
  readonly availableVersion?: string;
  /** Epoch ms of the last completed check; drives cooldown + UI. */
  readonly lastCheckedAt?: number;
  /** Stable, bounded error code (never raw exception text). */
  readonly errorCode?: string;
}

export interface ComputeUpdateSupportInput {
  readonly isPackaged: boolean;
  readonly platform: string;
  readonly isWindowsStore: boolean;
}

export type UpdateSupportResult =
  | { readonly supported: true }
  | { readonly supported: false; readonly reason: UpdateUnsupportedReason };

/**
 * Pure channel-gating decision (PRD FR-5).
 *
 * Order matters: development builds, Store/MSIX builds, and unsupported
 * platforms each short-circuit before any autoUpdater work.
 */
export function computeUpdateSupport(
  input: ComputeUpdateSupportInput,
): UpdateSupportResult {
  if (!input.isPackaged) {
    return { supported: false, reason: 'development' };
  }
  if (input.isWindowsStore) {
    return { supported: false, reason: 'store' };
  }
  if (input.platform !== 'win32' && input.platform !== 'darwin') {
    return { supported: false, reason: 'platform' };
  }
  return { supported: true };
}

/**
 * Maps an Electron `autoUpdater` event name to the resulting UI state.
 *
 * Returns `null` for events Phase 1 ignores (e.g. download-progress) so the
 * caller can skip no-op transitions.
 */
export function mapAutoUpdaterEvent(
  eventName: string,
): UpdateStatusState | null {
  switch (eventName) {
    case 'checking-for-update':
      return 'checking';
    case 'update-available':
      // autoUpdater begins downloading automatically after this event.
      return 'downloading';
    case 'update-not-available':
      return 'up-to-date';
    case 'update-downloaded':
      return 'ready-to-restart';
    case 'error':
      return 'error';
    default:
      return null;
  }
}
