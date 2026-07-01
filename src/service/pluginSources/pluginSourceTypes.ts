import type {
  PluginError,
  PluginSourceKind,
} from "@/entityTypes/pluginTypes";

/**
 * Multi-source plugin install contracts.
 * Source of truth: Spec §4.1.
 */

export interface PluginSourceRequest {
  readonly kind: PluginSourceKind;
  readonly overwrite?: boolean;
  /** local-zip */
  readonly zipPath?: string;
  /** local-folder */
  readonly folderPath?: string;
  /** git / github / url */
  readonly uri?: string;
  /** branch, tag, commit, or release tag */
  readonly ref?: string;
  /** npm */
  readonly npmPackage?: string;
  readonly npmVersion?: string;
  readonly npmRegistry?: string;
  readonly npmAuthScope?: string;
  /** Short-lived. Never persisted; redacted from logs/diagnostics. */
  readonly npmAuthToken?: string;
  /** Optional progress reporter (best-effort, may be ignored). */
  readonly onProgress?: (msg: string, pct?: number) => void;
}

export interface FetchedPluginSource {
  /** Absolute path to a directory containing the plugin root. */
  readonly localRoot: string;
  /** Caller MUST invoke after install/rollback, even on failure. */
  readonly cleanup: () => Promise<void>;
}

export type PluginAcquireResult =
  | { success: true; source: FetchedPluginSource }
  | { success: false; errors: readonly PluginError[] };

export interface PluginSourceFetcher {
  readonly kind: PluginSourceKind;
  acquire(req: PluginSourceRequest): Promise<PluginAcquireResult>;
}

/** Convenience factory for a single typed error. */
export function err(
  code: PluginError["code"],
  message: string,
  extras: Partial<PluginError> = {}
): PluginError {
  return { code, message, recoverable: false, ...extras };
}
