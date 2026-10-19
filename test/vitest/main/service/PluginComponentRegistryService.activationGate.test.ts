/**
 * HOST-04 activation gate tests — a manifest whose tool policies or host
 * requirements fail registration must not leave the plugin healthy or its
 * MCP servers discoverable (no silent fall-through to the 90-second
 * name-inference timeout).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PluginComponentRegistryService } from "@/service/PluginComponentRegistryService";
import { PluginLoaderService } from "@/service/PluginLoaderService";
import { UserPluginAutoInstallService } from "@/service/UserPluginAutoInstallService";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { setPluginToolPolicyRegistryForTest } from "@/service/PluginToolPolicyRegistry";
import { PluginRuntimeCache } from "@/service/PluginRuntimeCache";
import { PluginHookRegistrar } from "@/service/pluginCompat/PluginHookRegistrar";

const VALID_POLICY = {
  contractVersion: 1,
  timeoutClass: "fast",
  maxRunMs: 30_000,
  supportsProgress: false,
  supportsPartialResult: false,
  cancellable: true,
  maxConcurrentPerConversation: 1,
};

function loadedPlugin(manifest: Record<string, unknown>) {
  return {
    name: String(manifest.name),
    displayName: String(manifest.name),
    version: "1.0.0",
    source: "local" as const,
    enabled: true,
    manifest,
    skills: [],
    mcpServers: [],
    hooks: [],
    errors: [],
  };
}

describe("PluginComponentRegistryService HOST-04 activation gate", () => {
  let loadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Seed a clean policy registry so the gate is re-evaluated per test.
    vi.spyOn(
      UserPluginAutoInstallService,
      "syncDefaultUserPlugins"
    ).mockResolvedValue({ scanned: 0, installed: 0, skipped: 0, errors: [] });
    loadSpy = vi
      .spyOn(PluginLoaderService, "loadAllPlugins")
      .mockResolvedValue({ enabled: [], disabled: [], errors: [] });
    vi.spyOn(
      PluginComponentRegistryService,
      "promotePluginCommandsAndAgents"
    ).mockResolvedValue({ diagnostics: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setPluginToolPolicyRegistryForTest(undefined);
  });

  it("valid policies register cleanly and the gate does nothing", async () => {
    setPluginToolPolicyRegistryForTest(undefined);
    loadSpy.mockResolvedValue({
      enabled: [
        loadedPlugin({
          name: "clean-plugin",
          version: "1.0.0",
          toolPolicies: { "scraper/scrape": VALID_POLICY },
        }),
      ] as never,
      disabled: [],
      errors: [],
    });
    const updateSpy = vi
      .spyOn(PluginManagementModule.prototype, "updatePluginState")
      .mockResolvedValue(true);
    const disableSpy = vi
      .spyOn(MCPToolModule.prototype, "setPluginServersEnabled")
      .mockResolvedValue(0);
    // G01: the target universe comes from the plugin's persisted MCP rows —
    // seed one scoped row (empty tool list = declared, tools unknown).
    vi.spyOn(MCPToolModule.prototype, "findMcpByPluginName").mockResolvedValue(
      [
        {
          id: 1,
          serverName: "clean-plugin__scraper",
          transport: "stdio",
          enabled: 1,
          authType: "none",
          timeout: 30000,
          tools: "[]",
          toolConfig: "{}",
          metadata: JSON.stringify({
            pluginServerName: "scraper",
            pluginOwner: "clean-plugin",
          }),
        } as never,
      ]
    );

    const hookSpy = vi.spyOn(PluginHookRegistrar, "registerFromLoadedPlugins");
    await PluginComponentRegistryService.applyLoadedPlugins();
    PluginRuntimeCache.clear("gate-test-cleanup");

    expect(updateSpy).not.toHaveBeenCalled();
    expect(disableSpy).not.toHaveBeenCalled();
    // G01: hooks follow policy validation — the passing plugin keeps them.
    const hookCall = hookSpy.mock.calls.at(-1)?.[0] ?? [];
    expect(hookCall.some((plugin: { name: string }) => plugin.name === "clean-plugin")).toBe(true);
  });

  it("a gate-failed plugin exposes no hooks, commands or agents until it passes (G01)", async () => {
    setPluginToolPolicyRegistryForTest(undefined);
    loadSpy.mockResolvedValue({
      enabled: [
        loadedPlugin({
          name: "broken-plugin",
          version: "1.0.0",
          toolPolicies: { "scraper/scrape": VALID_POLICY },
        }),
      ] as never,
      disabled: [],
      errors: [],
    });
    // No MCP rows exist for "broken-plugin" in this harness: the policy
    // target universe is empty, so the gate fails closed.
    const updateSpy = vi
      .spyOn(PluginManagementModule.prototype, "updatePluginState")
      .mockResolvedValue(true);
    const disableSpy = vi
      .spyOn(MCPToolModule.prototype, "setPluginServersEnabled")
      .mockResolvedValue(0);
    const hookSpy = vi.spyOn(PluginHookRegistrar, "registerFromLoadedPlugins");
    const unregisterCapsSpy = vi
      .spyOn(
        PluginComponentRegistryService,
        "unregisterPluginCapabilities"
      )
      .mockResolvedValue(undefined);
    const promoteSpy = vi
      .spyOn(
        PluginComponentRegistryService,
        "promotePluginCommandsAndAgents"
      )
      .mockResolvedValue({ diagnostics: [] });

    await PluginComponentRegistryService.applyLoadedPlugins();

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "broken-plugin", health: "invalid" })
    );
    // Hooks skip the failed plugin; its runtime capabilities are stripped.
    const hookCall = hookSpy.mock.calls.at(-1)?.[0] ?? [];
    expect(
      hookCall.some((plugin: { name: string }) => plugin.name === "broken-plugin")
    ).toBe(false);
    expect(unregisterCapsSpy).toHaveBeenCalledWith("broken-plugin");
    // Commands/agents promotion reconciles the failed plugin separately.
    const promoted =
      (promoteSpy.mock.calls.at(-1)?.[2] as readonly { name: string }[]) ?? [];
    expect(pred(promoted, "broken-plugin")).toBe(false);
  });

  function pred(list: readonly { name: string }[], name: string): boolean {
    return list.some((entry: { name: string }) => entry.name === name);
  }

  it("an unsupported required capability marks the plugin invalid and hides its MCP servers", async () => {
    setPluginToolPolicyRegistryForTest(undefined);
    loadSpy.mockResolvedValue({
      enabled: [
        loadedPlugin({
          name: "future-plugin",
          version: "2.0.0",
          hostRequirements: {
            contractVersion: 1,
            capabilities: { "linux-only-capability": 1 },
          },
        }),
      ] as never,
      disabled: [],
      errors: [],
    });
    const updateSpy = vi
      .spyOn(PluginManagementModule.prototype, "updatePluginState")
      .mockResolvedValue(true);
    const disableSpy = vi
      .spyOn(MCPToolModule.prototype, "setPluginServersEnabled")
      .mockResolvedValue(3);

    await PluginComponentRegistryService.applyLoadedPlugins();

    expect(disableSpy).toHaveBeenCalledWith("future-plugin", false);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "future-plugin",
        health: "invalid",
      })
    );
    const persisted = updateSpy.mock.calls[0]?.[0];
    expect(String(persisted?.lastLoadErrorsJson)).toContain(
      "dependency-unsatisfied"
    );
    expect(String(persisted?.lastLoadErrorsJson)).toContain(
      "linux-only-capability"
    );
  });

  it("an invalid toolPolicies entry blocks activation the same way", async () => {
    setPluginToolPolicyRegistryForTest(undefined);
    loadSpy.mockResolvedValue({
      enabled: [
        loadedPlugin({
          name: "broken-policy-plugin",
          version: "1.0.0",
          toolPolicies: {
            "scraper/scrape": {
              contractVersion: 1,
              timeoutClass: "not-a-class",
              maxRunMs: 30_000,
              cancellable: true,
              maxConcurrentPerConversation: 1,
            },
          },
        }),
      ] as never,
      disabled: [],
      errors: [],
    });
    const updateSpy = vi
      .spyOn(PluginManagementModule.prototype, "updatePluginState")
      .mockResolvedValue(true);
    const disableSpy = vi
      .spyOn(MCPToolModule.prototype, "setPluginServersEnabled")
      .mockResolvedValue(1);

    await PluginComponentRegistryService.applyLoadedPlugins();

    expect(disableSpy).toHaveBeenCalledWith(
      "broken-policy-plugin",
      false
    );
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "broken-policy-plugin",
        health: "invalid",
      })
    );
  });

  it("a gate failure does not prevent the disabled-plugin cleanup path", async () => {
    setPluginToolPolicyRegistryForTest(undefined);
    loadSpy.mockResolvedValue({
      enabled: [
        loadedPlugin({
          name: "gate-failed-plugin",
          version: "1.0.0",
          hostRequirements: {
            contractVersion: 1,
            capabilities: { "missing-capability": 1 },
          },
        }),
      ] as never,
      disabled: [loadedPlugin({ name: "disabled-plugin" })] as never,
      errors: [],
    });
    vi.spyOn(
      PluginManagementModule.prototype,
      "updatePluginState"
    ).mockResolvedValue(true);
    const disableSpy = vi
      .spyOn(MCPToolModule.prototype, "setPluginServersEnabled")
      .mockResolvedValue(0);

    await PluginComponentRegistryService.applyLoadedPlugins();

    // Disabled plugins are unregistered; the gate only disables servers.
    expect(disableSpy).toHaveBeenCalledTimes(1);
  });
});
