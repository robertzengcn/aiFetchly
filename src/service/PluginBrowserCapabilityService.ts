import {
  BrowserExecutableResolver,
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
    this.resolver = deps.resolver ?? new BrowserExecutableResolver();
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
