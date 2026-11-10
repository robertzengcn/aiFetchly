import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * AC-05 (TODO task 3): the contact-extraction LAZY spawn path must refuse a
 * new worker once the lifecycle enters quitting. Drives the real
 * START_CONTACT_EXTRACTION handler with the spawn gate bound to a quitting
 * lifecycle; the spawn must never be attempted.
 */

const handleMock = vi.fn();
const invokeHandlers = new Map<
  string,
  (event: unknown, raw: unknown) => Promise<unknown>
>();

vi.mock("electron", () => ({
  app: {
    getName: () => "AiFetchly",
    getPath: (_name: string) => "/tmp/aifetchly-test-userdata",
  },
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: unknown, raw: unknown) => Promise<unknown>
    ) => {
      handleMock(channel, fn);
      invokeHandlers.set(channel, fn);
    },
    removeHandler: (channel: string) => invokeHandlers.delete(channel),
  },
  BrowserWindow: class {},
}));

vi.mock("@/service/ToolExecutor", () => ({ ToolExecutor: class {} }));
vi.mock("@/modules/ContactInfoModule", () => ({
  ContactInfoModule: class {
    getInFlightResultIds(): Promise<number[]> {
      return Promise.resolve([]);
    }
    batchUpdateExtractionStatus(): Promise<void> {
      return Promise.resolve();
    }
    getSearchResults(): Promise<Array<{ id: number; url: string; title: string }>> {
      return Promise.resolve([
        { id: 1, url: "https://example.com", title: "t" },
        { id: 2, url: "https://example.org", title: "t2" },
      ]);
    }
    createPendingContactInfo(): Promise<void> {
      return Promise.resolve();
    }
  },
}));
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "";
    }
    setValue(): void {
      /* test */
    }
  },
}));
vi.mock("@/main-process/communication/contactExtractionWorkerPath", () => ({
  getContactExtractionWorkerPath: () => "/tmp/fake-worker.js",
}));

import { ApplicationLifecycleService } from "@/main-process/lifecycle/ApplicationLifecycleService";
import { bindSpawnGateToLifecycle } from "@/main-process/lifecycle/spawnGate";
import {
  registerContactExtractionHandlers,
} from "@/main-process/communication/contactExtraction-ipc";
import { START_CONTACT_EXTRACTION } from "@/config/channellist";

describe("contact-extraction lazy spawn gate (AC-05, TODO 3)", () => {
  beforeEach(() => {
    invokeHandlers.clear();
    handleMock.mockClear();
  });

  it("refuses to start a new worker after Exit begins", async () => {
    const lifecycle = new ApplicationLifecycleService();
    let release!: (clean: boolean) => void;
    lifecycle.setCleanupRunner(
      () =>
        new Promise((resolve) => {
          release = (clean: boolean) => resolve({ clean });
        })
    );
    bindSpawnGateToLifecycle(lifecycle);
    lifecycle.requestExit("tray"); // quitting — gate closed, cleanup held open
    registerContactExtractionHandlers();

    const handler = invokeHandlers.get(START_CONTACT_EXTRACTION);
    expect(handler).toBeDefined();
    const result = (await handler!(
      { sender: { id: 1 } },
      JSON.stringify({ resultIds: [1, 2] })
    )) as {
      status: boolean;
      data: { success: boolean; message?: string } | null;
    };

    // Refused: no worker spawned. The handler's own try/catch converts the
    // SpawnGateError into its {success:false} result shape (envelope status
    // stays true — the IPC call itself succeeded).
    expect(result.data?.success).toBe(false);
    expect(result.data?.message).toContain("shutting down");
    release(true); // let the held cleanup settle
    await lifecycle.requestExit("tray"); // join the same (now-resolved) exit
  });

  it("while NOT quitting, the handler runs the normal path shape", async () => {
    bindSpawnGateToLifecycle(new ApplicationLifecycleService());
    registerContactExtractionHandlers();
    const handler = invokeHandlers.get(START_CONTACT_EXTRACTION);
    expect(handler).toBeDefined();
    // resultIds of wrong shape fail schema validation -> status:false envelope,
    // which still proves the gate did NOT throw before validation ordering.
    const result = (await handler!(
      { sender: { id: 1 } },
      JSON.stringify({ resultIds: [] })
    )) as { status: boolean };
    expect(result.status).toBe(false);
  });
});
