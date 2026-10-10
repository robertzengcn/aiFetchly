import { describe, expect, it, vi } from "vitest";
import * as path from "path";
import {
  isPathInsideDirectory,
  registerDevelopmentProtocolHandler,
  type ProtocolRegistryClient,
} from "@/main-process/registerDevelopmentProtocolHandler";

function makeRegistry(
  existingApp: string | null
): ProtocolRegistryClient & {
  getDefaultApp: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  deRegister: ReturnType<typeof vi.fn>;
} {
  return {
    getDefaultApp: vi.fn(async () => existingApp),
    register: vi.fn(async () => undefined),
    deRegister: vi.fn(async () => undefined),
  };
}

const protocolRegistryHome = path.join(
  path.sep,
  "Users",
  "dev",
  ".protocol-registry"
);

describe("isPathInsideDirectory", () => {
  it("accepts the directory itself and descendants", () => {
    expect(isPathInsideDirectory(protocolRegistryHome, protocolRegistryHome)).toBe(
      true
    );
    expect(
      isPathInsideDirectory(
        path.join(protocolRegistryHome, "aifetchly", "aiFetchly.app"),
        protocolRegistryHome
      )
    ).toBe(true);
  });

  it("rejects sibling and parent escapes", () => {
    expect(
      isPathInsideDirectory(
        path.join(protocolRegistryHome, "..", "Applications", "aiFetchly.app"),
        protocolRegistryHome
      )
    ).toBe(false);
    expect(
      isPathInsideDirectory(
        path.join(path.sep, "Applications", "aiFetchly.app"),
        protocolRegistryHome
      )
    ).toBe(false);
  });
});

describe("registerDevelopmentProtocolHandler", () => {
  const command = '"/electron" "/project" "$_URL_"';

  it("registers without override when no handler exists", async () => {
    const protocolRegistry = makeRegistry(null);

    const result = await registerDevelopmentProtocolHandler({
      protocolScheme: "aifetchly",
      command,
      appName: "aiFetchly",
      protocolRegistry,
      protocolRegistryHome,
    });

    expect(result).toEqual({ status: "registered" });
    expect(protocolRegistry.deRegister).not.toHaveBeenCalled();
    expect(protocolRegistry.register).toHaveBeenCalledWith(
      "aifetchly",
      command,
      {
        override: false,
        appName: "aiFetchly",
        terminal: true,
      }
    );
  });

  it("does not mutate another app that already owns the scheme", async () => {
    const defaultApp = path.join(path.sep, "Applications", "aiFetchly.app");
    const protocolRegistry = makeRegistry(defaultApp);

    const result = await registerDevelopmentProtocolHandler({
      protocolScheme: "aifetchly",
      command,
      appName: "aiFetchly",
      protocolRegistry,
      protocolRegistryHome,
    });

    expect(result).toEqual({
      status: "skipped-external",
      defaultApp,
    });
    expect(protocolRegistry.deRegister).not.toHaveBeenCalled();
    expect(protocolRegistry.register).not.toHaveBeenCalled();
  });

  it("force-deletes only our protocol-registry wrapper before re-registering", async () => {
    const defaultApp = path.join(
      protocolRegistryHome,
      "aifetchly",
      "aiFetchly.app"
    );
    const protocolRegistry = makeRegistry(defaultApp);

    const result = await registerDevelopmentProtocolHandler({
      protocolScheme: "aifetchly",
      command,
      appName: "aiFetchly",
      protocolRegistry,
      protocolRegistryHome,
    });

    expect(result).toEqual({ status: "refreshed", defaultApp });
    expect(protocolRegistry.deRegister).toHaveBeenCalledWith("aifetchly", {
      force: true,
    });
    expect(protocolRegistry.register).toHaveBeenCalledWith(
      "aifetchly",
      command,
      {
        override: false,
        appName: "aiFetchly",
        terminal: true,
      }
    );
  });
});
