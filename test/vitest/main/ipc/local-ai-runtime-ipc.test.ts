import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture registered handlers per channel.
const handlers = new Map<
  string,
  (event: unknown, raw: unknown) => Promise<unknown>
>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, h: (...args: unknown[]) => unknown) => {
      handlers.set(channel, h as never);
    },
  },
  app: { getPath: () => "/tmp/aifetchly", getVersion: () => "1.0.0" },
  BrowserWindow: class {},
}));

vi.mock("@/modules/Logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const tokenGetValue = vi.fn(() => "false");
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: tokenGetValue })),
}));

import {
  registerLocalAiRuntimeIpcHandlers,
  resolveCatalogSource,
} from "@/main-process/communication/local-ai-runtime-ipc";
import {
  LOCAL_AI_RUNTIME_STATUS,
  LOCAL_AI_RUNTIME_LIST,
  LOCAL_AI_RUNTIME_PREPARE_INSTALL,
  LOCAL_AI_RUNTIME_INSTALL,
  LOCAL_AI_RUNTIME_CANCEL_INSTALL,
  LOCAL_AI_RUNTIME_REPAIR,
  LOCAL_AI_RUNTIME_REMOVE,
} from "@/config/channellist";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = any;

function makeStubModule(): AnyModule {
  return {
    listStatuses: vi.fn(async () => [
      {
        runtimeId: "voice-sherpa",
        state: "not_installed",
        platform: "linux",
        arch: "x64",
      },
    ]),
    getStatus: vi.fn(async (runtimeId: string) => ({
      runtimeId,
      state: "not_installed",
      platform: "linux",
      arch: "x64",
    })),
    prepareInstall: vi.fn(async (runtimeId: string) => ({
      operationId: "11111111-2222-3333-4444-555555555555",
      runtimeId,
      runtimeVersion: "1.0.0",
      archiveSizeBytes: 1,
      installedSizeBytes: 2,
      consentToken: "22222222-3333-4444-5555-666666666666",
      expiresAt: "2026-07-30T00:00:00Z",
    })),
    install: vi.fn(async (input: { operationId: string }) => ({
      operationId: input.operationId,
      runtimeId: "voice-sherpa",
      runtimeVersion: "1.0.0",
      activated: true,
    })),
    cancelInstall: vi.fn(() => true),
    checkForUpdate: vi.fn(async () => null),
    repair: vi.fn(async (runtimeId: string) => ({
      operationId: "33333333-3333-4444-5555-666666666666",
      runtimeId,
      runtimeVersion: "1.0.0",
      activated: true,
    })),
    remove: vi.fn(async () => undefined),
  };
}

async function invoke(
  channel: string,
  raw: unknown
): Promise<{ status: boolean; msg: string; data: unknown }> {
  const h = handlers.get(channel);
  if (!h) throw new Error(`no handler for ${channel}`);
  return (await h({}, raw)) as { status: boolean; msg: string; data: unknown };
}

describe("local-ai-runtime catalog source", () => {
  it("defaults to the public GitHub release catalog", () => {
    delete process.env.AIFETCHLY_RUNTIME_CATALOG_URL;
    delete process.env.AIFETCHLY_RUNTIME_RELEASE_REPOSITORY;
    delete process.env.AIFETCHLY_RUNTIME_RELEASE_TAG;

    expect(resolveCatalogSource()).toEqual({
      catalogUrl:
        "https://github.com/robertzengcn/aiFetchly/releases/download/local-ai-runtime-v1.0.0/local-ai-runtimes.json",
      allowedHosts: ["github.com"],
    });
  });

  it("prefers an explicitly configured catalog URL", () => {
    process.env.AIFETCHLY_RUNTIME_CATALOG_URL =
      "https://downloads.example.test/catalog.json";
    expect(resolveCatalogSource()).toEqual({
      catalogUrl: "https://downloads.example.test/catalog.json",
      allowedHosts: ["downloads.example.test"],
    });
    delete process.env.AIFETCHLY_RUNTIME_CATALOG_URL;
  });
});

describe("local-ai-runtime IPC registration", () => {
  let stub: AnyModule;

  beforeEach(() => {
    handlers.clear();
    stub = makeStubModule();
    registerLocalAiRuntimeIpcHandlers(
      () => null,
      () => stub
    );
  });

  it("registers all component-management channels", () => {
    for (const channel of [
      LOCAL_AI_RUNTIME_LIST,
      LOCAL_AI_RUNTIME_STATUS,
      LOCAL_AI_RUNTIME_PREPARE_INSTALL,
      LOCAL_AI_RUNTIME_INSTALL,
      LOCAL_AI_RUNTIME_CANCEL_INSTALL,
      LOCAL_AI_RUNTIME_REPAIR,
      LOCAL_AI_RUNTIME_REMOVE,
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  it("routes status to module.getStatus", async () => {
    const res = await invoke(LOCAL_AI_RUNTIME_STATUS, {
      runtimeId: "voice-sherpa",
    });
    expect(res.status).toBe(true);
    expect(stub.getStatus).toHaveBeenCalledWith("voice-sherpa");
    expect((res.data as { runtimeId: string }).runtimeId).toBe("voice-sherpa");
  });

  it("rejects invalid status input with status:false", async () => {
    const res = await invoke(LOCAL_AI_RUNTIME_STATUS, { runtimeId: "evil" });
    expect(res.status).toBe(false);
    expect(res.data).toBeNull();
    expect(stub.getStatus).not.toHaveBeenCalled();
  });

  it("routes install with full consent payload", async () => {
    const payload = {
      operationId: "11111111-2222-3333-4444-555555555555",
      runtimeId: "voice-sherpa",
      expectedRuntimeVersion: "1.0.0",
      consentToken: "22222222-3333-4444-5555-666666666666",
    };
    const res = await invoke(LOCAL_AI_RUNTIME_INSTALL, payload);
    expect(res.status).toBe(true);
    expect(stub.install).toHaveBeenCalledWith(payload);
  });

  it("cancel wraps the boolean in { cancelled }", async () => {
    const res = await invoke(LOCAL_AI_RUNTIME_CANCEL_INSTALL, {
      operationId: "11111111-2222-3333-4444-555555555555",
    });
    expect(res.status).toBe(true);
    expect(res.data).toEqual({ cancelled: true });
  });

  it("remove wraps into { removed: true }", async () => {
    const res = await invoke(LOCAL_AI_RUNTIME_REMOVE, {
      runtimeId: "voice-sherpa",
      removeModels: false,
    });
    expect(res.status).toBe(true);
    expect(res.data).toEqual({ removed: true });
    expect(stub.remove).toHaveBeenCalledWith({
      runtimeId: "voice-sherpa",
      removeModels: false,
    });
  });
});
