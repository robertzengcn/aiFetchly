import {
  BrowserExecutableResolver,
  defaultManagedChromeCacheDir,
  defaultFs,
  enumerateManagedChromeCandidates,
  type ExecutableResolutionResult,
} from "@/childprocess/managed-browser/BrowserExecutableResolver";
import type { BrowserExecutableDescriptor } from "@/entityTypes/managedBrowserTypes";

/**
 * PluginBrowserCapabilityService — generic host capability exposing an
 * approved Chrome/Chromium executable to browser plugins (HOST-15, design
 * §6.3).
 *
 * Reuses the existing managed-browser resolution order (configured →
 * managed cache → system) WITHOUT exposing application settings, the
 * settings module, or Puppeteer to the caller. The returned descriptor is
 * consumed only by host code writing the trusted host-context file — the
 * plugin never reads application settings or the database.
 *
 * B11/HOST-15: the production service actually FEEDS the resolver the real
 * candidates — the administrator-configured path (env) and the installed
 * Chrome-for-Testing builds under the managed puppeteer cache — instead of
 * relying on the resolver defaults (configured: null, managed: empty) that
 * silently skipped configured/managed-only installations.
 *
 * No download happens here: a missing browser is a typed dependency
 * diagnostic the plugin surfaces as BROWSER_EXECUTABLE_MISSING; installation
 * runs through the existing user-visible dependency flow.
 */

export type BrowserCapabilityResult = ExecutableResolutionResult;

export interface PluginBrowserCapabilityServiceDeps {
  readonly resolver?: BrowserExecutableResolver;
}

export class PluginBrowserCapabilityService {
  private readonly resolver: BrowserExecutableResolver;

  constructor(deps: PluginBrowserCapabilityServiceDeps = {}) {
    this.resolver =
      deps.resolver ??
      new BrowserExecutableResolver({
        // Administrator-configured executable (legacy env contract used by
        // BrowserManager; empty values degrade to null).
        configuredPath:
          process.env.LOCAL_BROWSER_EXCUTE_PATH &&
          process.env.LOCAL_BROWSER_EXCUTE_PATH.length > 0
            ? process.env.LOCAL_BROWSER_EXCUTE_PATH
            : null,
        // Installed Chrome-for-Testing builds under the managed cache,
        // newest first.
        managedCandidates: enumerateManagedChromeCandidates(
          defaultFs(),
          defaultManagedChromeCacheDir()
        ),
      });
  }

  /** Resolve the approved browser executable, or a typed missing-dependency result. */
  public resolve(): BrowserCapabilityResult {
    return this.resolver.resolve();
  }

  /** Convenience: the descriptor for host-context assembly, or null. */
  public describe(): BrowserExecutableDescriptor | null {
    const result = this.resolve();
    return "descriptor" in result ? result.descriptor : null;
  }

  /**
   * B11/HOST-15: a PLUGIN's declared capability surface decides whether a
   * browser is required at all; a resolved descriptor must additionally
   * satisfy the manifest's declared compatibility floor
   * (`minBrowserMajorVersion`). A plugin without the browser grant is
   * trivially compatible (no browser is part of its surface).
   */
  public testBrowserUsable(
    caps: { browserExecutable?: boolean; minBrowserMajorVersion?: number } = {}
  ): {
    compatible: boolean;
    missing: boolean;
    outOfRange: boolean;
    descriptor: BrowserExecutableDescriptor | null;
  } {
    if (caps.browserExecutable !== true) {
      return {
        compatible: true,
        missing: false,
        outOfRange: false,
        descriptor: this.describe(),
      };
    }
    const result = this.resolve();
    if (!("descriptor" in result)) {
      return {
        compatible: false,
        missing: true,
        outOfRange: false,
        descriptor: null,
      };
    }
    const min = caps.minBrowserMajorVersion ?? null;
    if (min !== null && result.descriptor.majorVersion < min) {
      return {
        compatible: false,
        missing: false,
        outOfRange: true,
        descriptor: result.descriptor,
      };
    }
    return {
      compatible: true,
      missing: false,
      outOfRange: false,
      descriptor: result.descriptor,
    };
  }
}

let defaultService: PluginBrowserCapabilityService | undefined;

export function getPluginBrowserCapabilityService(): PluginBrowserCapabilityService {
  if (!defaultService) defaultService = new PluginBrowserCapabilityService();
  return defaultService;
}

export function setPluginBrowserCapabilityServiceForTest(
  service: PluginBrowserCapabilityService | undefined
): void {
  defaultService = service;
}
