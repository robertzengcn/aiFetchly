import { describe, it, expect, afterEach } from "vitest";
import { PluginDiagnosticsService } from "@/service/PluginDiagnosticsService";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { PluginCommandDiagnosticsStore } from "@/service/pluginCompat/PluginCommandDiagnosticsStore";

afterEach(() => {
  // Singleton store — keep cases isolated.
  PluginCommandDiagnosticsStore.clearAll();
});

describe("PluginDiagnosticsService redaction", () => {
  it("redacts api keys, bearer tokens, passwords, and JWTs from string fields", async () => {
    const name = "diag-redact-test";
    const module = new PluginManagementModule();
    // Clean slate in case a previous run left this row.
    await module.uninstallPlugin(name);

    await module.createPlugin({
      name,
      version: "1.0.0",
      description: "d",
      installPath: "/tmp",
      source: "local",
      manifestJson: JSON.stringify({
        name,
        version: "1.0.0",
        description: "d",
        env: {
          API_KEY: "sk-abcdefghijklmnop1234567890",
          AUTH: "Bearer eyJabc.def.ghi1234567890abcdefghijklm",
          PASSWORD: "supersecret-value",
        },
      }),
      permissionsJson: "[]",
      componentStateJson: "{}",
      enabled: 1,
      health: "partial_load",
    });
    await module.setLoadErrors(name, [
      {
        code: "mcp-config-invalid",
        message: "connection failed with token=abcdef0123456789",
        recoverable: true,
      },
    ]);

    try {
      const bundle = await PluginDiagnosticsService.buildBundle(name);
      expect(bundle).to.not.equal(null);
      if (!bundle) return;
      const serialized = JSON.stringify(bundle);
      // Secrets must NOT appear.
      expect(serialized).not.to.contain("sk-abcdefghijklmnop1234567890");
      expect(serialized).not.to.contain("supersecret-value");
      expect(serialized).not.to.contain("abcdef0123456789");
      // Redaction marker must appear.
      expect(serialized).to.contain("[redacted]");
    } finally {
      await module.uninstallPlugin(name);
    }
  });

  it("surfaces cached plugin command diagnostics in the bundle and redacts their messages", async () => {
    const name = "diag-commands-test";
    const module = new PluginManagementModule();
    await module.uninstallPlugin(name);
    await module.createPlugin({
      name,
      version: "1.0.0",
      description: "d",
      installPath: "/tmp",
      source: "local",
      manifestJson: JSON.stringify({ name, version: "1.0.0" }),
      permissionsJson: "[]",
      componentStateJson: "{}",
      enabled: 1,
      health: "partial_load",
    });

    PluginCommandDiagnosticsStore.set(name, [
      {
        severity: "warning",
        source: "plugin",
        sourceId: `plugin:${name}`,
        filePath: "commands/bad.md",
        code: "frontmatter-invalid",
        message: "missing type: prompt; token=abcdef0123456789",
        recoverable: true,
      },
    ]);

    try {
      const bundle = await PluginDiagnosticsService.buildBundle(name);
      expect(bundle).to.not.equal(null);
      if (!bundle) return;
      expect(bundle.commandDiagnostics).toHaveLength(1);
      expect(bundle.commandDiagnostics[0].code).toBe("frontmatter-invalid");
      expect(bundle.commandDiagnostics[0].filePath).toBe("commands/bad.md");
      expect(bundle.commandDiagnostics[0].sourceId).toBe(`plugin:${name}`);
      // Secret in the diagnostic message is redacted.
      expect(JSON.stringify(bundle.commandDiagnostics)).not.to.contain(
        "abcdef0123456789"
      );
    } finally {
      await module.uninstallPlugin(name);
    }
  });

  it("returns an empty commandDiagnostics array when the plugin has no cached diagnostics", async () => {
    const name = "diag-commands-empty";
    const module = new PluginManagementModule();
    await module.uninstallPlugin(name);
    await module.createPlugin({
      name,
      version: "1.0.0",
      description: "d",
      installPath: "/tmp",
      source: "local",
      manifestJson: JSON.stringify({ name, version: "1.0.0" }),
      permissionsJson: "[]",
      componentStateJson: "{}",
      enabled: 1,
      health: "healthy",
    });

    try {
      const bundle = await PluginDiagnosticsService.buildBundle(name);
      expect(bundle).to.not.equal(null);
      if (!bundle) return;
      expect(bundle.commandDiagnostics).toEqual([]);
    } finally {
      await module.uninstallPlugin(name);
    }
  });
});
