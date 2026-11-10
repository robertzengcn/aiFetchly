import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { log } from "@/modules/Logger";
import { MANAGED_BROWSER_CACHE_DEFAULTS } from "@/config/managedBrowser";
import { userSecretKeyService } from "@/modules/fieldCipher/UserSecretKeyService";
import type { WorkerBrowserStoragePolicy } from "@/entityTypes/managedBrowserTypes";

/**
 * Cache scope derivation (technical design §13.5).
 *
 * The persistent HTTP cache lives at
 *   `<cacheRoot>/aifetchly/managed-browser-cache/v1/<scopeToken>/<namespace>/http-cache/`
 * where `<scopeToken>` is an HMAC of the account id under the user secret key
 * (opaque — never a readable account identifier) and `<namespace>` is the
 * generated `chrome-<major>-<platform>-<arch>-schema-<n>` segment.
 *
 * Every path is produced here and validated by a fixed ladder before any
 * directory is created or handed to Chrome:
 *   1. canonical resolve of the cache root; reject empty/root/home/tmp roots;
 *   2. only generated scope+namespace segments (grammar-validated);
 *   3. reject `..`, separators inside segments, ADS (`:`), device paths
 *      (`\\?\`, `\\.`), and NUL/control bytes;
 *   4. lstat every existing path component — a symlink anywhere aborts;
 *   5. re-check canonical containment inside the exact managed root.
 *
 * When the secret key is unavailable the cache is DISABLED with a reason code —
 * there is deliberately no readable-identifier fallback scope.
 */

const SCOPE_TOKEN_PATTERN = /^[0-9a-f]{24}$/;
const NAMESPACE_PATTERN = /^chrome-\d{1,3}-[a-z0-9]+-[a-z0-9]+-schema-\d{1,2}$/;

/** Grammar check for an HMAC-derived scope token (24 lowercase hex chars). */
export function isValidCacheScopeToken(token: string): boolean {
  return SCOPE_TOKEN_PATTERN.test(token);
}

/**
 * Grammar check for a generated namespace segment. Anything containing
 * traversal, separators, ADS colons, device-path prefixes, whitespace, or
 * control characters fails the regex; the explicit reject list is defense in
 * depth for callers that assemble strings themselves.
 */
export function isValidCacheNamespaceSegment(segment: string): boolean {
  if (!NAMESPACE_PATTERN.test(segment)) {
    return false;
  }
  // Defense in depth: the regex already excludes these, but keep the
  // rejection explicit so future regex edits cannot silently admit them.
  if (
    segment.includes("..") ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes(":") ||
    segment.includes("\0") ||
    segment.startsWith("\\\\?\\") ||
    segment.startsWith("\\\\.")
  ) {
    return false;
  }
  return true;
}

export interface ManagedBrowserCacheScopeDeps {
  /** Resolves the OS cache root (Electron `app.getPath("cache")`). */
  readonly resolveCacheRoot: () => string;
  /** Yields the 32-byte user secret key (HMAC key for scope tokens). */
  readonly getSecretKey: () => Promise<Buffer>;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly homedir: () => string;
  readonly tmpdir: () => string;
  readonly realpath: (p: string) => Promise<string>;
  readonly lstat: (p: string) => Promise<fs.Stats>;
  readonly mkdir: (p: string) => Promise<void>;
}

export type CacheScopePaths =
  | {
      readonly status: "ok";
      readonly cacheRoot: string;
      readonly managedRoot: string;
      readonly scopePath: string;
      readonly namespacePath: string;
      readonly httpCachePath: string;
      readonly scopeToken: string;
      readonly namespace: string;
    }
  | {
      readonly status: "disabled";
      readonly reasonCode:
        | "cache_root_unavailable"
        | "cache_root_rejected"
        | "secret_key_unavailable"
        | "scope_path_invalid";
    };

/** Whole-account scope (all namespaces under one opaque token). */
export type CacheAccountScope =
  | {
      readonly status: "ok";
      readonly cacheRoot: string;
      readonly managedRoot: string;
      readonly scopePath: string;
      readonly scopeToken: string;
    }
  | {
      readonly status: "disabled";
      readonly reasonCode:
        | "cache_root_unavailable"
        | "cache_root_rejected"
        | "secret_key_unavailable"
        | "scope_path_invalid";
    };

/** Shared root + token derivation shared by both public derivations. */
type DerivedRootAndToken =
  | {
      readonly status: "ok";
      readonly cacheRoot: string;
      readonly managedRoot: string;
      readonly scopeToken: string;
    }
  | {
      readonly status: "disabled";
      readonly reasonCode:
        | "cache_root_unavailable"
        | "cache_root_rejected"
        | "secret_key_unavailable"
        | "scope_path_invalid";
    };

export class ManagedBrowserCacheScopeService {
  private readonly deps: ManagedBrowserCacheScopeDeps;

  public constructor(deps: ManagedBrowserCacheScopeDeps) {
    this.deps = deps;
  }

  /**
   * Derives (and validates) the full cache layout for one account + Chrome
   * major. Creates the namespace directory when every ladder step passes.
   */
  public async deriveScopePaths(
    accountId: number,
    chromeMajor: number
  ): Promise<CacheScopePaths> {
    const base = await this.deriveRootAndToken(accountId);
    if (base.status === "disabled") {
      return base;
    }
    const { cacheRoot, managedRoot, scopeToken } = base;

    // Step 3: generated namespace segment.
    const namespace = `chrome-${chromeMajor}-${this.normalizeSegment(
      String(this.deps.platform)
    )}-${this.normalizeSegment(String(this.deps.arch))}-schema-${
      MANAGED_BROWSER_CACHE_DEFAULTS.cacheSchemaVersion
    }`;
    if (!isValidCacheNamespaceSegment(namespace)) {
      return { status: "disabled", reasonCode: "scope_path_invalid" };
    }

    const scopePath = path.join(managedRoot, scopeToken);
    const namespacePath = path.join(scopePath, namespace);
    const httpCachePath = path.join(namespacePath, "http-cache");

    // Step 4: lstat every existing component — no symlinks anywhere.
    if (
      !(await this.hasNoSymlinkComponents(managedRoot)) ||
      !(await this.hasNoSymlinkComponents(scopePath)) ||
      !(await this.hasNoSymlinkComponents(namespacePath))
    ) {
      return { status: "disabled", reasonCode: "scope_path_invalid" };
    }

    // Step 5: create + final containment re-check.
    try {
      await this.deps.mkdir(namespacePath);
    } catch (error) {
      logScopeError("mkdir namespace failed", error);
      return { status: "disabled", reasonCode: "scope_path_invalid" };
    }
    const canonicalParent = await this.deps.realpath(namespacePath);
    if (canonicalParent !== path.resolve(namespacePath)) {
      return { status: "disabled", reasonCode: "scope_path_invalid" };
    }
    if (
      !canonicalParent.startsWith(`${path.resolve(managedRoot)}${path.sep}`)
    ) {
      return { status: "disabled", reasonCode: "scope_path_invalid" };
    }

    return {
      status: "ok",
      cacheRoot,
      managedRoot: path.resolve(managedRoot),
      scopePath,
      namespacePath,
      httpCachePath,
      scopeToken,
      namespace,
    };
  }

  /**
   * Derives the whole-account scope (managed root + scope directory) WITHOUT
   * namespace handling or directory creation. Used by clear/status/queue
   * operations that operate on every namespace under one account scope at
   * once. The scope directory need not exist yet.
   */
  public async deriveAccountScope(
    accountId: number
  ): Promise<CacheAccountScope> {
    const base = await this.deriveRootAndToken(accountId);
    if (base.status === "disabled") {
      return base;
    }
    const scopePath = path.join(base.managedRoot, base.scopeToken);
    // Same symlink ladder, but existence is NOT required (ENOENT is fine —
    // clearing an absent scope is the "empty" outcome, not an error).
    if (!(await this.hasNoSymlinkComponents(base.managedRoot))) {
      return { status: "disabled", reasonCode: "scope_path_invalid" };
    }
    if (!(await this.hasNoSymlinkComponents(scopePath))) {
      return { status: "disabled", reasonCode: "scope_path_invalid" };
    }
    return {
      status: "ok",
      cacheRoot: base.cacheRoot,
      managedRoot: base.managedRoot,
      scopePath,
      scopeToken: base.scopeToken,
    };
  }

  /**
   * Builds the worker-facing `persistentCache` storage policy. When the cache
   * setting is off — or any ladder step fails — returns the disabled variant
   * with a stable reason code (never a path or identifier).
   */
  public async buildPersistentCachePolicy(
    accountId: number,
    chromeMajor: number,
    cacheEnabled: boolean
  ): Promise<WorkerBrowserStoragePolicy["persistentCache"]> {
    if (!cacheEnabled) {
      return { enabled: false, reasonCode: "cache_disabled_by_setting" };
    }
    const derived = await this.deriveScopePaths(accountId, chromeMajor);
    if (derived.status === "disabled") {
      return { enabled: false, reasonCode: derived.reasonCode };
    }
    return {
      enabled: true,
      cachePath: derived.httpCachePath,
      scopeToken: derived.scopeToken,
      namespace: derived.namespace,
    };
  }

  // -----------------------------------------------------------------------
  // Ladder helpers
  // -----------------------------------------------------------------------

  /** Steps 1-2 of the ladder: safe cache root + opaque scope token. */
  private async deriveRootAndToken(
    accountId: number
  ): Promise<DerivedRootAndToken> {
    // Step 1: resolve + canonicalize the cache root; reject unsafe roots.
    let rawRoot: string;
    try {
      rawRoot = this.deps.resolveCacheRoot();
    } catch {
      return { status: "disabled", reasonCode: "cache_root_unavailable" };
    }
    if (!this.isCacheRootAcceptable(rawRoot)) {
      return { status: "disabled", reasonCode: "cache_root_rejected" };
    }
    const cacheRoot = path.resolve(rawRoot);
    const managedRoot = path.join(
      cacheRoot,
      "aifetchly",
      "managed-browser-cache",
      "v1"
    );

    // Step 2: opaque scope token via HMAC under the user secret key.
    let scopeToken: string;
    try {
      const key = await this.deps.getSecretKey();
      scopeToken = crypto
        .createHmac("sha256", key)
        .update(`managed-browser-cache:v1:${accountId}`)
        .digest("hex")
        .slice(0, 24);
    } catch {
      // NEVER fall back to a readable identifier.
      return { status: "disabled", reasonCode: "secret_key_unavailable" };
    }
    if (!isValidCacheScopeToken(scopeToken)) {
      return { status: "disabled", reasonCode: "scope_path_invalid" };
    }
    return { status: "ok", cacheRoot, managedRoot, scopeToken };
  }

  private isCacheRootAcceptable(rawRoot: string): boolean {
    if (!rawRoot || rawRoot.length === 0) {
      return false;
    }
    const resolved = path.resolve(rawRoot);
    const root = path.parse(resolved).root;
    if (resolved === root) {
      return false; // filesystem root
    }
    const home = this.deps.homedir();
    if (home && resolved === path.resolve(home)) {
      return false; // home directory exactly — never the cache root itself
    }
    const tmp = this.deps.tmpdir();
    if (tmp && resolved === path.resolve(tmp)) {
      return false; // tmpdir directly (temp profiles live there)
    }
    if (resolved.includes("\0")) {
      return false;
    }
    return true;
  }

  /** lstat every existing component of `dirPath` relative to its root. */
  private async hasNoSymlinkComponents(dirPath: string): Promise<boolean> {
    const resolved = path.resolve(dirPath);
    const root = path.parse(resolved).root;
    const parts = resolved.slice(root.length).split(path.sep);
    let current = root;
    for (const part of parts) {
      if (part.length === 0) {
        continue;
      }
      current = path.join(current, part);
      try {
        const stats = await this.deps.lstat(current);
        if (stats.isSymbolicLink()) {
          return false;
        }
      } catch {
        // Missing components are created by mkdir below; nothing to check.
        return true;
      }
    }
    return true;
  }

  /** Lowercase + strip anything outside [a-z0-9] for segment assembly. */
  private normalizeSegment(value: string): string {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9]/g, "");
    return cleaned.length > 0 ? cleaned : "unknown";
  }
}

function logScopeError(context: string, error: unknown): void {
  // Scoped without identifiers — reason codes only (design §13.4).
  const name =
    error instanceof Error
      ? (error as NodeJS.ErrnoException).code ?? error.name
      : "unknown";
  log.warn(`[ManagedBrowserCacheScope] ${context}: ${name}`);
}

/**
 * Production factory. The Electron `app` object is lazily required so this
 * module stays importable from unit tests without a running app.
 */
export function getDefaultManagedBrowserCacheScopeService(): ManagedBrowserCacheScopeService {
  return new ManagedBrowserCacheScopeService({
    resolveCacheRoot: () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require("electron") as {
        app: { getPath(name: "cache"): string };
      };
      return electron.app.getPath("cache");
    },
    getSecretKey: () => userSecretKeyService.getKey(),
    platform: process.platform,
    arch: process.arch,
    homedir: os.homedir,
    tmpdir: os.tmpdir,
    realpath: (p) => fs.promises.realpath(p),
    lstat: (p) => fs.promises.lstat(p),
    mkdir: (p) =>
      fs.promises.mkdir(p, { recursive: true }).then(() => undefined),
  });
}
