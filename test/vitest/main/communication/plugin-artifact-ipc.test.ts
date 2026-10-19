// B09 regression suite — plugin artifact access is authenticated:
//   1. sender frame must be a trusted app origin, and
//   2. conversation ownership is resolved server-side against host-owned
//      conversation state before any list/preview/export/delete, and
//   3. the store root is derived from the authenticated identity (scoped
//      singleton cache).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ---------------------------------------------------------------- mock electron
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const showSaveDialog = vi.fn(async (_options?: unknown) => ({
  canceled: true,
  filePath: "",
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
  dialog: {
    showSaveDialog: (options: unknown) => showSaveDialog(options),
  },
}));

// ---------------------------------------------------------------- mock identity
let mockUserId = "";
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(key: string): string {
      return key === "user_id" ? mockUserId : "";
    }
  },
}));

// ---------------------------------------------------------------- mock data root
let dataRoot = "";
vi.mock("@/service/SkillEnvironmentManager", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getElectronUserDataPath: () => dataRoot,
}));

// ------------------------------------------------------- mock conversation state
const ownedConversations = new Set<string>();
vi.mock("@/modules/AIChatConversationModule", () => ({
  AIChatConversationModule: class {
    async getConversationProjection(conversationId: string): Promise<unknown> {
      return ownedConversations.has(conversationId)
        ? { conversationId, displayTitle: "t" }
        : null;
    }
  },
}));
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: class {
    async getConversationMessages(conversationId: string): Promise<unknown[]> {
      return ownedConversations.has(`msg:${conversationId}`) ? [{ id: 1 }] : [];
    }
  },
}));

import { registerPluginArtifactIpcHandlers } from "@/main-process/communication/plugin-artifact-ipc";
import { PluginFileArtifactModule } from "@/modules/PluginFileArtifactModule";
import {
  getPluginFileArtifactService,
  resolvePluginArtifactScopeId,
  type PluginArtifactCandidate,
} from "@/service/PluginFileArtifactService";
import {
  PLUGIN_ARTIFACT_LIST,
  PLUGIN_ARTIFACT_PREVIEW,
  PLUGIN_ARTIFACT_EXPORT,
  PLUGIN_ARTIFACT_DELETE,
} from "@/config/channellist";
import type { IpcMainInvokeEvent } from "electron";

const CANDIDATE: PluginArtifactCandidate = {
  version: 1,
  relativePath: "records.json",
  format: "json",
  recordCount: 2,
  complete: true,
};

const TRUSTED_URL = "app://aifetchly/index.html";
const UNTRUSTED_URL = "https://evil.example/index.html";
const OWNED_CONV = "v2-owned-conversation";
const FOREIGN_CONV = "v2-someone-elses-conversation";

function ipcEvent(url: string | undefined): IpcMainInvokeEvent {
  return {
    senderFrame: url === undefined ? undefined : { url },
    sender: {},
  } as unknown as IpcMainInvokeEvent;
}

async function call(
  channel: string,
  event: IpcMainInvokeEvent | undefined,
  payload: unknown
): Promise<{ status: boolean; msg: string; data: unknown }> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`handler missing: ${channel}`);
  const result = (await handler(event, payload)) as {
    status: boolean;
    msg: string;
    data: unknown;
  };
  return result;
}

let userCounter = 0;
/** Activate a unique fake account and register one artifact for a conversation. */
function promoteFixture(conversationId: string): string {
  mockUserId = `user-art-${userCounter++}`;
  const service = getPluginFileArtifactService();
  const executionId = `exec-ipc-${userCounter}`;
  const staging = service.provisionStaging(executionId);
  fs.writeFileSync(
    path.join(staging, "records.json"),
    JSON.stringify({
      schemaVersion: 1,
      records: [{ businessName: "A" }, { businessName: "B" }],
    })
  );
  const { artifacts, errors } = service.promoteCandidates({
    executionId,
    conversationId,
    pluginName: "demo-plugin",
    candidates: [CANDIDATE],
  });
  expect(errors).toEqual([]);
  expect(artifacts).toHaveLength(1);
  return artifacts[0].id;
}

beforeAll(() => {
  dataRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yp-artifact-ipc-")), "userData");
  registerPluginArtifactIpcHandlers();
});

afterAll(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

describe("plugin artifact IPC sender authentication (B09)", () => {
  it("rejects artifact requests from untrusted sender frames on every channel", async () => {
    for (const channel of [
      PLUGIN_ARTIFACT_LIST,
      PLUGIN_ARTIFACT_PREVIEW,
      PLUGIN_ARTIFACT_EXPORT,
      PLUGIN_ARTIFACT_DELETE,
    ]) {
      const result = await call(
        channel,
        ipcEvent(UNTRUSTED_URL),
        JSON.stringify({ conversationId: OWNED_CONV, artifactId: "pa_x" })
      );
      expect(result.status).toBe(false);
      expect(result.msg).toMatch(/untrusted origin/i);
    }
  });

  it("rejects artifact requests with a missing sender frame", async () => {
    const result = await call(
      PLUGIN_ARTIFACT_LIST,
      ipcEvent(undefined),
      JSON.stringify({ conversationId: OWNED_CONV })
    );
    expect(result.status).toBe(false);
    expect(result.msg).toMatch(/untrusted origin/i);
  });

  it("rejects an undefined event entirely", async () => {
    const result = await call(PLUGIN_ARTIFACT_LIST, undefined, JSON.stringify({ conversationId: OWNED_CONV }));
    expect(result.status).toBe(false);
    expect(result.msg).toMatch(/untrusted origin/i);
  });
});

describe("plugin artifact IPC conversation ownership (B09)", () => {
  it("denies list/preview/export/delete for an unknown conversation even with a trusted sender", async () => {
    const id = promoteFixture("v2-never-owned");
    for (const channel of [
      PLUGIN_ARTIFACT_LIST,
      PLUGIN_ARTIFACT_PREVIEW,
      PLUGIN_ARTIFACT_EXPORT,
      PLUGIN_ARTIFACT_DELETE,
    ]) {
      const result = await call(
        channel,
        ipcEvent(TRUSTED_URL),
        JSON.stringify({ conversationId: FOREIGN_CONV, artifactId: id })
      );
      expect(result.status).toBe(false);
      expect(result.msg).toMatch(/Conversation not found/);
    }
  });

  it("serves list/preview/export/delete for an owned conversation and cross-conversation probes return nothing", async () => {
    ownedConversations.add(OWNED_CONV);
    ownedConversations.add("v2-other-owned");
    const id = promoteFixture(OWNED_CONV);

    // list — owned conversation sees the artifact; another OWNED conversation
    // legitimately shares the store but cannot see artifacts of another id.
    const listed = await call(
      PLUGIN_ARTIFACT_LIST,
      ipcEvent(TRUSTED_URL),
      JSON.stringify({ conversationId: OWNED_CONV })
    );
    expect(listed.status).toBe(true);
    const artifacts = listed.data as Array<{ id: string }>;
    expect(artifacts.some((a) => a.id === id)).toBe(true);

    const otherList = await call(
      PLUGIN_ARTIFACT_LIST,
      ipcEvent(TRUSTED_URL),
      JSON.stringify({ conversationId: "v2-other-owned" })
    );
    const otherArtifacts = otherList.data as Array<{ id: string }>;
    expect(otherArtifacts.some((a) => a.id === id)).toBe(false);

    // preview
    const preview = await call(
      PLUGIN_ARTIFACT_PREVIEW,
      ipcEvent(TRUSTED_URL),
      JSON.stringify({ conversationId: OWNED_CONV, artifactId: id })
    );
    expect(preview.status).toBe(true);

    // export — destination never comes from the renderer
    const dest = path.join(dataRoot, "..", "ipc-export-out.json");
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: dest });
    const exported = await call(
      PLUGIN_ARTIFACT_EXPORT,
      ipcEvent(TRUSTED_URL),
      JSON.stringify({ conversationId: OWNED_CONV, artifactId: id })
    );
    expect(exported.status).toBe(true);
    expect(
      (exported.data as { cancelled: boolean; sizeBytes: number }).cancelled
    ).toBe(false);
    expect((exported.data as { sizeBytes: number }).sizeBytes).toBeGreaterThan(0);
    expect(fs.existsSync(dest)).toBe(true);
    fs.unlinkSync(dest);
    showSaveDialog.mockReset();

    // delete
    const deleted = await call(
      PLUGIN_ARTIFACT_DELETE,
      ipcEvent(TRUSTED_URL),
      JSON.stringify({ conversationId: OWNED_CONV, artifactId: id })
    );
    expect(deleted.status).toBe(true);
    expect((deleted.data as { deleted: boolean }).deleted).toBe(true);
    const afterDelete = await call(
      PLUGIN_ARTIFACT_LIST,
      ipcEvent(TRUSTED_URL),
      JSON.stringify({ conversationId: OWNED_CONV })
    );
    expect(
      (afterDelete.data as Array<{ id: string }>).some((a) => a.id === id)
    ).toBe(false);
  });
});

describe("PluginFileArtifactModule conversation verification", () => {
  it("delegates when the injected lookup owns the conversation", async () => {
    const service = new PluginFileArtifactModule(
      getPluginFileArtifactService("scope-module-a"),
      async () => true
    );
    // Unknown conversation with a TRUE lookup still resolves — the local db
    // fallback is bypassed when an explicit lookup exists.
    await expect(
      (async () => {
        await service.listForConversation("conv-any");
        return true;
      })()
    ).resolves.toBe(true);
  });

  it("rejects when the injected lookup denies the conversation", async () => {
    const service = new PluginFileArtifactModule(
      getPluginFileArtifactService("scope-module-b"),
      async () => false
    );
    await expect(service.delete("conv-x", "pa_y")).rejects.toThrow(
      /Conversation not found/
    );
  });

  it("cleans malformed conversation ids before any lookup", async () => {
    const service = new PluginFileArtifactModule(
      getPluginFileArtifactService("scope-module-c"),
      async () => true
    );
    await expect(service.preview("", "pa_y")).rejects.toThrow(/Invalid conversation id/);
    await expect(
      service.preview(`c${"x".repeat(201)}`, "pa_y")
    ).rejects.toThrow(/Invalid conversation id/);
  });
});

describe("authenticated scope derivation (B09)", () => {
  it("derives an anonymous scope when no user id exists, and a stable hashed scope otherwise", () => {
    mockUserId = "";
    expect(resolvePluginArtifactScopeId()).toBe("anonymous");
    mockUserId = "user-scope-A";
    const a1 = resolvePluginArtifactScopeId();
    const a2 = resolvePluginArtifactScopeId();
    expect(a1).toBe(a2);
    expect(a1.startsWith("u_")).toBe(true);
    expect(a1.length).toBe(18);
    mockUserId = "user-scope-B";
    const b = resolvePluginArtifactScopeId();
    expect(b).not.toBe(a1);
  });

  it("caches one scoped service per identity and isolates roots between identities", () => {
    mockUserId = "user-scope-A";
    const first = getPluginFileArtifactService();
    const second = getPluginFileArtifactService();
    expect(first).toBe(second);
    expect(first.stagingDir("exec-x")).toContain(resolvePluginArtifactScopeId());

    mockUserId = "user-scope-B";
    const other = getPluginFileArtifactService();
    expect(other).not.toBe(first);
    expect(other.stagingDir("exec-x")).not.toBe(first.stagingDir("exec-x"));
  });

  it("only explicitly provided scopes override resolution", () => {
    mockUserId = "user-others";
    const explicit = getPluginFileArtifactService("explicit-scope");
    expect(explicit.stagingDir("exec-y")).toContain(path.join("plugin-artifacts", "explicit-scope"));
  });
});
