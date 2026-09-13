import type { BrowserExecutableDescriptor } from "@/entityTypes/managedBrowserTypes";

/**
 * Browser executable resolution (technical design §10).
 *
 * Returns a VALIDATED DESCRIPTOR, not just a path. Resolution order:
 *   1. administrator-configured executable (`chrome_path` setting)
 *   2. AiFetchly's managed Chrome-for-Testing cache (candidates injected —
 *      this module stays puppeteer-free and unit-testable)
 *   3. supported system Chrome via platform-specific known paths
 *   4. typed `browser_dependency_missing` diagnostic
 *
 * NO DOWNLOAD ever happens inside resolution. Installation/update is a
 * separate user-visible system-dependency operation.
 */

export interface ResolvedExecutable {
  readonly descriptor: BrowserExecutableDescriptor;
}

export interface MissingExecutable {
  readonly errorCode: "browser_dependency_missing";
  readonly searchedPaths: readonly string[];
}

export type ExecutableResolutionResult =
  | ResolvedExecutable
  | MissingExecutable;

/** Structural fs subset so tests never touch the real filesystem. */
export interface ResolverFs {
  existsSync(path: string): boolean;
  isFileSync(path: string): boolean;
  realpathSync(path: string): string;
}

export interface BrowserExecutableResolverOptions {
  /** Administrator-configured path (validated before use). */
  readonly configuredPath?: string | null;
  /** Managed Chrome-for-Testing candidates, highest priority first. */
  readonly managedCandidates?: readonly string[];
  /** Additional system paths (tests / packaged overrides). */
  readonly extraSystemPaths?: readonly string[];
  readonly fs?: ResolverFs;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  /**
   * Reads a Chrome version string for an executable (e.g. by spawning
   * `<exe> --version`). Injected for tests; the default shells out lazily.
   */
  readonly readExecutableVersion?: (path: string) => string | null;
}

const SYSTEM_PATHS: Record<string, readonly string[]> = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ],
};

/**
 * Parse a Chrome version string ("136.0.7103.94", "137.0.0.0 dev") into its
 * canonical form + major. Returns null for unparseable input.
 */
export function parseChromeVersion(
  raw: string
): { version: string; majorVersion: number } | null {
  const match = /(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const [, major, minor, build, patch] = match;
  const version = patch
    ? `${major}.${minor}.${build}.${patch}`
    : `${major}.${minor}.${build}`;
  return { version, majorVersion: Number.parseInt(major, 10) };
}

/** Default version probe — shells out to `<exe> --version` lazily. */
function defaultReadExecutableVersion(path: string): string | null {
  try {
    // Lazy require keeps this importable in bundlers/tests without spawning.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const result = spawnSync(path, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    if (result.error || typeof result.stdout !== "string") {
      return null;
    }
    return result.stdout;
  } catch {
    return null;
  }
}

function defaultFs(): ResolverFs {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  return {
    existsSync: (p) => fs.existsSync(p),
    isFileSync: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
    realpathSync: (p) => fs.realpathSync(p),
  };
}

/** Reject filesystem roots, empty values, and null-byte smuggling. */
function isPlausibleExecutablePath(path: string): boolean {
  if (path.length === 0 || path.includes("\0")) {
    return false;
  }
  if (path === "/" || /^[A-Za-z]:\\?$/.test(path)) {
    return false;
  }
  return true;
}

export class BrowserExecutableResolver {
  private readonly configuredPath: string | null;
  private readonly managedCandidates: readonly string[];
  private readonly systemPaths: readonly string[];
  private readonly fs: ResolverFs;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly readVersion: (path: string) => string | null;

  constructor(options: BrowserExecutableResolverOptions = {}) {
    this.configuredPath = options.configuredPath ?? null;
    this.managedCandidates = options.managedCandidates ?? [];
    this.systemPaths = [
      ...(options.extraSystemPaths ?? []),
      ...(SYSTEM_PATHS[options.platform ?? process.platform] ?? []),
    ];
    this.fs = options.fs ?? defaultFs();
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.readVersion = options.readExecutableVersion ?? defaultReadExecutableVersion;
  }

  /**
   * Resolve with version validation. Candidates missing a readable version
   * are skipped (an executable whose version cannot be verified must not be
   * used for an authenticated session).
   */
  public resolve(): ExecutableResolutionResult {
    const searched: string[] = [];
    const attempt = (
      path: string | null | undefined,
      source: BrowserExecutableDescriptor["source"]
    ): BrowserExecutableDescriptor | null => {
      if (!path) {
        return null;
      }
      searched.push(path);
      if (!isPlausibleExecutablePath(path)) {
        return null;
      }
      if (!this.fs.existsSync(path) || !this.fs.isFileSync(path)) {
        return null;
      }
      const versionRaw = this.readVersion(path);
      if (!versionRaw) {
        return null;
      }
      const parsed = parseChromeVersion(versionRaw);
      if (!parsed) {
        return null;
      }
      return {
        path: this.safeRealpath(path),
        source,
        product: "chrome",
        version: parsed.version,
        majorVersion: parsed.majorVersion,
        architecture: this.describeArchitecture(),
      };
    };

    const configured = attempt(this.configuredPath, "configured");
    if (configured) {
      return { descriptor: configured };
    }
    for (const candidate of this.managedCandidates) {
      const managed = attempt(candidate, "managed");
      if (managed) {
        return { descriptor: managed };
      }
    }
    for (const candidate of this.systemPaths) {
      const system = attempt(candidate, "system");
      if (system) {
        return { descriptor: system };
      }
    }
    return { errorCode: "browser_dependency_missing", searchedPaths: searched };
  }

  private safeRealpath(path: string): string {
    try {
      return this.fs.realpathSync(path);
    } catch {
      return path;
    }
  }

  private describeArchitecture(): string {
    switch (this.arch) {
      case "x64":
        return "x64";
      case "arm64":
        return "arm64";
      case "ia32":
        return "x86";
      default:
        return this.arch;
    }
  }
}
