import { describe, it, expect, vi } from "vitest";
import { PluginHookRegistrar } from "@/service/pluginCompat/PluginHookRegistrar";

// Capture calls to SkillWorkerClient.executeHook so we can assert dispatch
// happened (AC-17) and what the script returned (AC-7).
const executeHookMock = vi.fn<
  [script: string, input: unknown],
  Promise<{ permissionDecision: "allow" | "deny"; reason?: string }>
>();

vi.mock("@/service/hooks/HookRegistry", () => {
  const registered: unknown[] = [];
  return {
    HookRegistry: {
      registerBuiltinHook: (hook: unknown) => {
        registered.push(hook);
      },
      _registered: registered,
    },
  };
});

vi.mock("@/service/SkillWorkerClient", () => ({
  SkillWorkerClient: {
    getInstance: () => ({
      executeHook: executeHookMock,
    }),
  },
}));

vi.mock("@/service/pluginPaths", () => ({
  getPluginInstallRoot: (name: string) => `/tmp/plugins/${name}`,
}));

vi.mock("fs", () => ({
  existsSync: (p: string) => p.endsWith("hook.js"),
  readFileSync: () => "return { permissionDecision: 'deny' };",
}));

vi.mock("@/modules/Logger", () => ({
  log: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

import { HookRegistry } from "@/service/hooks/HookRegistry";

describe("PluginHookRegistrar", () => {
  it("registers a callback hook per matcher", () => {
    const reg = HookRegistry as unknown as {
      registerBuiltinHook: (h: unknown) => void;
      _registered: unknown[];
    };
    reg._registered.length = 0;

    PluginHookRegistrar.registerForPlugin("p", [
      {
        event: "PreToolUse",
        matcher: "shell_execute",
        pluginName: "p",
        sourceCommand: "echo deny",
      },
      {
        event: "Stop",
        pluginName: "p",
        sourceCommand: "echo done",
      },
    ]);

    expect(reg._registered.length).toBe(2);
    const first = reg._registered[0] as {
      id: string;
      eventName: string;
      type: string;
      source: string;
      matcher?: string;
    };
    expect(first.id).toBe("plugin:p:0");
    expect(first.eventName).toBe("PreToolUse");
    expect(first.type).toBe("callback");
    expect(first.source).toBe("plugin");
    expect(first.matcher).toBe("shell_execute");
  });

  it("registerFromLoadedPlugins skips plugins with no hooks", () => {
    const reg = HookRegistry as unknown as {
      registerBuiltinHook: (h: unknown) => void;
      _registered: unknown[];
    };
    reg._registered.length = 0;

    PluginHookRegistrar.registerFromLoadedPlugins([
      { name: "no-hooks", hooks: [] },
      {
        name: "with-hooks",
        hooks: [
          {
            event: "PreToolUse",
            pluginName: "with-hooks",
            sourceCommand: "x",
          },
        ],
      },
    ]);

    expect(reg._registered.length).toBe(1);
  });

  it("AC-7: callback dispatches to SkillWorker when scriptPath is set, returns deny", async () => {
    const reg = HookRegistry as unknown as {
      registerBuiltinHook: (h: unknown) => void;
      _registered: Array<{
        callback: (input: unknown) => Promise<unknown>;
        matcher?: string;
      }>;
    };
    reg._registered.length = 0;
    executeHookMock.mockResolvedValue({
      permissionDecision: "deny",
      reason: "blocked by plugin policy",
    });

    PluginHookRegistrar.registerForPlugin("p", [
      {
        event: "PreToolUse",
        matcher: "shell_execute",
        pluginName: "p",
        sourceCommand: "echo",
        scriptPath: "hooks/hook.js",
      },
    ]);

    const hook = reg._registered[0];
    const result = (await hook.callback({
      tool: { name: "shell_execute" },
    })) as {
      permissionDecision: string;
      reason?: string;
    };

    expect(executeHookMock).toHaveBeenCalledTimes(1);
    expect(result.permissionDecision).toBe("deny");
    expect(result.reason).toBe("blocked by plugin policy");
  });

  it("AC-17: callback without scriptPath does NOT dispatch to SkillWorker", async () => {
    const reg = HookRegistry as unknown as {
      registerBuiltinHook: (h: unknown) => void;
      _registered: Array<{
        callback: (input: unknown) => Promise<unknown>;
      }>;
    };
    reg._registered.length = 0;
    executeHookMock.mockClear();

    PluginHookRegistrar.registerForPlugin("p", [
      {
        event: "PreToolUse",
        pluginName: "p",
        sourceCommand: "echo", // Claude native shell — no auto-exec
      },
    ]);

    const result = (await reg._registered[0].callback({})) as {
      permissionDecision: string;
    };
    expect(executeHookMock).not.toHaveBeenCalled();
    expect(result.permissionDecision).toBe("allow");
  });
});
