import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * SAVE_TEMP_FILE orphan-cleanup regression: when the upload metadata fails
 * Zod validation AFTER the file was already staged to disk, the handler must
 * delete the staged file — the error response returns tempFilePath: "", so
 * nobody else owns the file. Rejected uploads otherwise accumulate full
 * copies under userData/uploads forever.
 */

// Mutable temp state read at handler-call time via the mocked app.getPath.
const tempState = vi.hoisted(() => ({
  userDataDir: "",
}));

vi.mock("electron", () => ({
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockImplementation((name: string) => {
      if (name === "userData") return tempState.userDataDir;
      return os.tmpdir();
    }),
    isReady: vi.fn(() => true),
  },
  dialog: {},
}));

vi.mock("@/modules/Logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn(function TokenMock() {
    return {
      getValue: vi
        .fn()
        .mockImplementation((key: string) =>
          key === "user_dbpath" ? tempState.userDataDir : ""
        ),
      setValue: vi.fn(),
      deleteValue: vi.fn(),
      hasValue: vi.fn(() => false),
    };
  }),
}));

vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return {
    ...actual,
    USERSDBPATH: "user_dbpath",
  };
});

// The controller is constructed + initialized before validation — stub the
// class so no DB boots while the rejection path still runs.
vi.mock("@/controller/RagSearchController", () => ({
  RagSearchController: vi.fn(function RagSearchControllerMock() {
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
      uploadDocument: vi.fn(),
    };
  }),
}));

vi.mock("@/main-process/communication/handleRagImportWebsite", () => ({
  handleRagImportWebsite: vi.fn(),
}));

vi.mock("@/service/AiFeatureGate", () => ({
  isAiEnabled: vi.fn(() => true),
}));

import { ipcMain } from "electron";
import { registerRagIpcHandlers } from "@/main-process/communication/rag-ipc";
import { SAVE_TEMP_FILE, SAVE_TEMP_FILE_COMPLETE } from "@/config/channellist";

type IpcListener = (event: unknown, data: unknown) => Promise<void> | void;

function captureListener(channel: string): IpcListener {
  const mockOn = ipcMain.on as unknown as ReturnType<typeof vi.fn>;
  const allCalls = mockOn.mock.calls as unknown as Array<[string, IpcListener]>;
  const calls = allCalls.filter(([c]) => c === channel);
  const listener = calls.at(-1)?.[1] as IpcListener | undefined;
  if (!listener) throw new Error(`no listener registered for ${channel}`);
  return listener;
}

function stagedFiles(): string[] {
  const uploadsDir = path.join(tempState.userDataDir, "uploads");
  if (!fs.existsSync(uploadsDir)) return [];
  return fs
    .readdirSync(uploadsDir)
    .map((f) => path.join(uploadsDir, f))
    .filter((p) => fs.existsSync(p));
}

describe("SAVE_TEMP_FILE orphan cleanup on rejected metadata", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempState.userDataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "aifetchly-rag-orphan-")
    );
    registerRagIpcHandlers();
  });

  it("deletes the staged file when metadata validation rejects", async () => {
    const listener = captureListener(SAVE_TEMP_FILE);
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const event = {
      sender: {
        send: (channel: string, payload: string) => {
          sent.push({ channel, payload: JSON.parse(payload) });
        },
      },
    };

    // Malformed metadata (tags must be an array of strings) — the Zod
    // schema rejects it AFTER the file has been staged to disk.
    await listener(event, {
      fileName: "notes.txt",
      buffer: Buffer.from("hello orphan cleanup"),
      metadata: { tags: "not-an-array" },
    });

    // The rejection was reported.
    const completed = sent.filter((s) => s.channel === SAVE_TEMP_FILE_COMPLETE);
    expect(completed).toHaveLength(1);
    const body = completed[0].payload as {
      status: boolean;
      msg: string;
      data: { tempFilePath: string; databaseError: string };
    };
    expect(body.status).toBe(false);
    expect(body.msg).toMatch(/Invalid upload metadata/i);
    expect(body.data.tempFilePath).toBe("");

    // The staged upload must NOT linger on disk.
    expect(stagedFiles()).toEqual([]);
  });
});
