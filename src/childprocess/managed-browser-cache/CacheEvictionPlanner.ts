import * as nodeFs from "node:fs/promises";
import * as path from "node:path";
import type { Stats } from "node:fs";
import { MANAGED_BROWSER_CACHE_DEFAULTS } from "@/config/managedBrowser";
import { CACHE_DELETING_DIR_NAME } from "@/childprocess/managed-browser-cache/CachePathValidator";

/**
 * Bounded cache scanning + LRU-inactive eviction planning (design §13.9).
 *
 * Every scan is bounded three ways — visited entries, directory depth, and
 * wall time — and reports `truncated` instead of overrunning. Eviction
 * candidates are scopes that are (a) NOT active and (b) inactive beyond the
 * retention window OR over the per-scope target; they are ordered
 * least-recently-modified first and accumulated only until the projected
 * total fits the global maximum.
 */

export interface ScanLimits {
  readonly maxEntries: number;
  readonly maxDepth: number;
  readonly maxWallTimeMs: number;
}

export interface ScopeScanResult {
  readonly approximateBytes: number;
  readonly fileCount: number;
  /** Newest file mtime seen (epoch ms); 0 for an empty/missing scope. */
  readonly lastModifiedEpochMs: number;
  readonly truncated: boolean;
}

export interface ScopeSummary extends ScopeScanResult {
  readonly scopeToken: string;
}

export interface EvictionPolicy {
  readonly maxTotalBytes: number;
  readonly perScopeTargetBytes: number;
  readonly inactiveRetentionDays: number;
}

export interface EvictionPlan {
  /** Scope tokens in eviction (rename) order — LRU first. */
  readonly entries: readonly string[];
  readonly plannedBytes: number;
}

export interface CacheEvictionPlannerDeps {
  readonly readdir?: (p: string) => Promise<string[]>;
  readonly lstat?: (p: string) => Promise<Stats>;
  readonly now?: () => number;
}

const SCOPE_TOKEN_PATTERN = /^[0-9a-f]{24}$/;

export function defaultScanLimits(): ScanLimits {
  return {
    maxEntries: MANAGED_BROWSER_CACHE_DEFAULTS.scanMaxEntries,
    maxDepth: MANAGED_BROWSER_CACHE_DEFAULTS.scanMaxDepth,
    maxWallTimeMs: MANAGED_BROWSER_CACHE_DEFAULTS.scanMaxWallTimeMs,
  };
}

export class CacheEvictionPlanner {
  private readonly readdir: (p: string) => Promise<string[]>;
  private readonly lstat: (p: string) => Promise<Stats>;
  private readonly now: () => number;

  public constructor(deps: CacheEvictionPlannerDeps = {}) {
    this.readdir = deps.readdir ?? ((p) => nodeFs.readdir(p));
    this.lstat = deps.lstat ?? ((p) => nodeFs.lstat(p));
    this.now = deps.now ?? Date.now;
  }

  /**
   * Bounded scan of one scope directory. Symlinks are skipped (never
   * followed); each visited file contributes its lstat size.
   */
  public async scanScopeDirectory(
    scopePath: string,
    limits: ScanLimits = defaultScanLimits()
  ): Promise<ScopeScanResult> {
    const startedAt = this.now();
    const deadline = startedAt + limits.maxWallTimeMs;
    let approximateBytes = 0;
    let fileCount = 0;
    let lastModifiedEpochMs = 0;
    let truncated = false;

    interface Frame {
      readonly dirPath: string;
      readonly depth: number;
    }
    const stack: Frame[] = [{ dirPath: scopePath, depth: 0 }];

    while (stack.length > 0) {
      if (fileCount >= limits.maxEntries || this.now() > deadline) {
        truncated = true;
        break;
      }
      const frame = stack.pop() as Frame;
      let info: Stats;
      try {
        info = await this.lstat(frame.dirPath);
      } catch {
        continue; // missing/raced — nothing to count
      }
      if (info.isSymbolicLink()) {
        continue; // never follow planted links
      }
      if (info.isFile()) {
        fileCount += 1;
        approximateBytes += info.size;
        lastModifiedEpochMs = Math.max(lastModifiedEpochMs, info.mtimeMs);
        continue;
      }
      if (!info.isDirectory()) {
        continue;
      }
      if (frame.depth >= limits.maxDepth) {
        truncated = true; // children exist but stay unvisited
        continue;
      }
      let children: string[];
      try {
        children = await this.readdir(frame.dirPath);
      } catch {
        continue;
      }
      for (const child of children) {
        stack.push({
          dirPath: path.join(frame.dirPath, child),
          depth: frame.depth + 1,
        });
      }
    }

    return {
      approximateBytes,
      fileCount,
      lastModifiedEpochMs: Math.round(lastModifiedEpochMs),
      truncated,
    };
  }

  /**
   * Bounded scan of every scope under the managed root (single-level
   * readdir, then per-scope bounded scans). Scope summaries are capped at
   * `maxScopes` with a `truncated` flag.
   */
  public async scanManagedRoot(
    managedRoot: string,
    limits: ScanLimits = defaultScanLimits(),
    maxScopes: number = MANAGED_BROWSER_CACHE_DEFAULTS.scanAllMaxScopes
  ): Promise<{ scopes: readonly ScopeSummary[]; truncated: boolean }> {
    let entries: string[];
    try {
      entries = await this.readdir(managedRoot);
    } catch {
      return { scopes: [], truncated: false }; // no root yet — nothing cached
    }
    const summaries: ScopeSummary[] = [];
    let truncated = false;
    for (const entry of entries) {
      if (
        entry === CACHE_DELETING_DIR_NAME ||
        !SCOPE_TOKEN_PATTERN.test(entry)
      ) {
        continue;
      }
      if (summaries.length >= maxScopes) {
        truncated = true;
        break;
      }
      const scan = await this.scanScopeDirectory(
        path.join(managedRoot, entry),
        limits
      );
      summaries.push({ scopeToken: entry, ...scan });
      if (scan.truncated) {
        truncated = true;
      }
    }
    return { scopes: summaries, truncated };
  }

  /**
   * Pure eviction policy: candidates are inactive scopes that are stale
   * (≥ inactiveRetentionDays since last modification) or over the
   * per-scope target. LRU-first ordering; stop as soon as the projected
   * total fits the global maximum.
   */
  public planEviction(
    summaries: readonly ScopeSummary[],
    policy: EvictionPolicy,
    activeScopeTokens: readonly string[],
    nowEpochMs: number = this.now()
  ): EvictionPlan {
    const active = new Set(activeScopeTokens);
    const totalBytes = summaries.reduce((sum, s) => sum + s.approximateBytes, 0);
    const inactiveMs = policy.inactiveRetentionDays * 24 * 60 * 60 * 1000;

    const candidates = summaries
      .filter((s) => !active.has(s.scopeToken))
      .filter(
        (s) =>
          s.approximateBytes > policy.perScopeTargetBytes ||
          (s.lastModifiedEpochMs > 0 &&
            nowEpochMs - s.lastModifiedEpochMs >= inactiveMs) ||
          // An empty-but-present scope is trivially reclaimable.
          s.approximateBytes === 0
      )
      .sort((a, b) => a.lastModifiedEpochMs - b.lastModifiedEpochMs);

    const entries: string[] = [];
    let plannedBytes = 0;
    for (const candidate of candidates) {
      if (totalBytes - plannedBytes <= policy.maxTotalBytes) {
        break;
      }
      entries.push(candidate.scopeToken);
      plannedBytes += candidate.approximateBytes;
    }
    return { entries, plannedBytes };
  }
}
