/**
 * Renderer-facing update-status types.
 *
 * Re-exported (type-only) from the pure main-process model so there is a single
 * source of truth and the renderer never imports runtime main-process code.
 */
export type {
  UpdateStatusState,
  UpdateUnsupportedReason,
  UpdateStatusSnapshot,
} from '@/main-process/updater/UpdateStatus';
