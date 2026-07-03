import { describe, it, expect, vi } from "vitest";
import { PluginHookRegistrar } from "@/service/pluginCompat/PluginHookRegistrar";

// Mock HookRegistry to capture registrations without touching the global.
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

// Mock logger to avoid import side effects.
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
});
