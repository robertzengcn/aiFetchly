// PluginBrowserCapabilityService tests (TD-06 / HOST-15).
import { describe, it, expect } from "vitest";
import { PluginBrowserCapabilityService } from "@/service/PluginBrowserCapabilityService";
import { BrowserExecutableResolver } from "@/childprocess/managed-browser/BrowserExecutableResolver";

const DESCRIPTOR = {
  path: "/opt/chrome/chrome",
  source: "system",
  product: "chrome",
  version: "136.0.7103.94",
  majorVersion: 136,
  architecture: "x64",
} as const;

function resolverReturning(result: unknown): BrowserExecutableResolver {
  return {
    resolve: () => result,
  } as unknown as BrowserExecutableResolver;
}

describe("PluginBrowserCapabilityService", () => {
  it("returns the approved descriptor when resolution succeeds", () => {
    const svc = new PluginBrowserCapabilityService({
      resolver: resolverReturning({ descriptor: DESCRIPTOR }),
    });
    const result = svc.resolve();
    expect("descriptor" in result && result.descriptor.path).toBe(
      "/opt/chrome/chrome"
    );
    expect(svc.describe()?.version).toBe("136.0.7103.94");
  });

  it("returns the typed dependency diagnostic when no browser exists", () => {
    const svc = new PluginBrowserCapabilityService({
      resolver: resolverReturning({
        errorCode: "browser_dependency_missing",
        searchedPaths: ["/usr/bin/chromium"],
      }),
    });
    const result = svc.resolve();
    expect("errorCode" in result && result.errorCode).toBe(
      "browser_dependency_missing"
    );
    expect(svc.describe()).toBeNull();
  });
});
