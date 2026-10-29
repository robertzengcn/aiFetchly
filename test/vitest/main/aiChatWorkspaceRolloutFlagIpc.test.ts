import { beforeEach, describe, expect, it, vi } from "vitest";

// Drive the GET/SET flag handlers without Electron: capture registrations.
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
    on: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn as never);
    },
  },
}));

// Token is the only dependency the flag handlers touch, so a mutable map
// stands in for the user settings store. Absent rollout keys behave like
// the shipped defaults (redesign absent → shown; adapters absent → on).
const tokenValues = new Map<string, string>();
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(key: string): string {
      if (tokenValues.has(key)) return tokenValues.get(key)!;
      return "";
    }
    setValue(key: string, value: string): void {
      tokenValues.set(key, value);
    }
  },
}));

import { registerAiChatWorkspaceIpcHandlers } from "@/main-process/communication/ai-chat-workspace-ipc";
import {
  AI_CHAT_WORKSPACE_GET_FLAG,
  AI_CHAT_WORKSPACE_SET_FLAG,
} from "@/config/channellist";
import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";
import {
  AI_CHAT_WORKSPACE_SHARED_ORCHESTRATION,
  AI_CHAT_WORKSPACE_SPECIALIZED_RESULTS,
  AI_CHAT_WORKSPACE_VOICE_MEMORY,
  AI_CHAT_MESSAGE_QUEUE_ENABLED,
  USER_AI_CHAT_WORKSPACE_REDESIGN,
} from "@/config/usersetting";
import {
  isWorkspaceQueueEnabled,
  isWorkspaceSteeringEnabled,
  isWorkspaceRedesignEnabled,
  isWorkspaceSharedOrchestrationEnabled,
  isWorkspaceSpecializedResultsEnabled,
  isWorkspaceVoiceMemoryEnabled,
} from "@/service/AIChatWorkspaceRollout";

type FlagResult = {
  status: boolean;
  msg: string;
  data?: {
    enabled?: boolean;
    explicit?: boolean;
    feature?: string;
    adapters?: {
      sharedOrchestration: boolean;
      specializedResults: boolean;
      voiceMemory: boolean;
    };
  };
};

function invoke(channel: string, payload: unknown): Promise<FlagResult> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`handler not registered: ${channel}`);
  return handler({ sender: { id: 1 } }, payload) as Promise<FlagResult>;
}

beforeEach(() => {
  tokenValues.clear();
  registerAiChatWorkspaceIpcHandlers();
});

/**
 * R8 §2 (PRD §33 / §23.2): the operator rollback drill must show in the
 * workspace action counter — redesign enabled/rollback and adapter
 * enable/disable, labels only.
 */
describe("workspace rollout flag action counts (R8 §2)", () => {
  it("counts a redesign rollback and a re-enable", async () => {
    await invoke(AI_CHAT_WORKSPACE_SET_FLAG, { enabled: false });
    expect(
      aiChatQueueCounters.snapshot()[
        'ai_chat_workspace_action_total{action="redesign_flag",capability="workspace",outcome="rollback"}'
      ]
    ).toBe(1);
    await invoke(AI_CHAT_WORKSPACE_SET_FLAG, { enabled: true });
    expect(
      aiChatQueueCounters.snapshot()[
        'ai_chat_workspace_action_total{action="redesign_flag",capability="workspace",outcome="enabled"}'
      ]
    ).toBe(1);
  });

  it("counts adapter flag toggles", async () => {
    await invoke(AI_CHAT_WORKSPACE_SET_FLAG, {
      feature: "shared_orchestration",
      enabled: false,
    });
    expect(
      aiChatQueueCounters.snapshot()[
        'ai_chat_workspace_action_total{action="adapter_flag",capability="workspace",outcome="disabled"}'
      ]
    ).toBe(1);
    await invoke(AI_CHAT_WORKSPACE_SET_FLAG, {
      feature: "voice_memory",
      enabled: true,
    });
    expect(
      aiChatQueueCounters.snapshot()[
        'ai_chat_workspace_action_total{action="adapter_flag",capability="workspace",outcome="enabled"}'
      ]
    ).toBe(1);
  });
});

/**
 * A02 (design §23.1/§23.2): the rollout flag channel must expose the main
 * shell switch AND the three presentation/dispatch adapters independently,
 * while flipping any of them never touches the durable flags (pending
 * queue, steering) or the identity-critical accessors.
 */
describe("workspace rollout flag channel (A02 §23.1)", () => {
  it("reports shipped defaults: workspace off (unset), adapters on", async () => {
    const res = await invoke(AI_CHAT_WORKSPACE_GET_FLAG, {});
    expect(res.status).toBe(true);
    // Redesign default is OFF with a validated rollback (PRD §33): unset
    // reports enabled=false without an explicit operator choice.
    expect(res.data?.enabled).toBe(false);
    expect(res.data?.explicit).toBe(false);
    expect(res.data?.adapters).toEqual({
      sharedOrchestration: true,
      specializedResults: true,
      voiceMemory: true,
    });
    expect(isWorkspaceQueueEnabled()).toBe(true);
    expect(isWorkspaceSteeringEnabled()).toBe(true);
  });

  it("reports an explicit recorded rollback for the main switch", async () => {
    tokenValues.set(USER_AI_CHAT_WORKSPACE_REDESIGN, "false");
    const res = await invoke(AI_CHAT_WORKSPACE_GET_FLAG, {});
    expect(res.data?.enabled).toBe(false);
    expect(res.data?.explicit).toBe(true);
  });

  it("reports an explicit recorded pin for the main switch", async () => {
    tokenValues.set(USER_AI_CHAT_WORKSPACE_REDESIGN, "true");
    const res = await invoke(AI_CHAT_WORKSPACE_GET_FLAG, {});
    expect(res.data?.enabled).toBe(true);
    expect(res.data?.explicit).toBe(true);
  });

  it("rolls back shared orchestration independently and leaves durable flags untouched", async () => {
    const beforeQueue = isWorkspaceQueueEnabled();
    const beforeRedesign = isWorkspaceRedesignEnabled();

    const res = await invoke(AI_CHAT_WORKSPACE_SET_FLAG, {
      enabled: false,
      feature: "shared_orchestration",
    });
    expect(res.status).toBe(true);
    expect(res.data?.feature).toBe("shared_orchestration");
    expect(tokenValues.get(AI_CHAT_WORKSPACE_SHARED_ORCHESTRATION)).toBe(
      "false"
    );
    expect(isWorkspaceSharedOrchestrationEnabled()).toBe(false);

    // §23.2: presentation rollback must not touch durable machinery.
    expect(tokenValues.has(AI_CHAT_MESSAGE_QUEUE_ENABLED)).toBe(false);
    expect(isWorkspaceQueueEnabled()).toBe(beforeQueue);
    expect(isWorkspaceRedesignEnabled()).toBe(beforeRedesign);

    const get = await invoke(AI_CHAT_WORKSPACE_GET_FLAG, {});
    expect(get.data?.adapters?.sharedOrchestration).toBe(false);
    expect(get.data?.adapters?.specializedResults).toBe(true);
    expect(get.data?.adapters?.voiceMemory).toBe(true);
  });

  it("rolls back specialized results independently", async () => {
    const res = await invoke(AI_CHAT_WORKSPACE_SET_FLAG, {
      enabled: false,
      feature: "specialized_results",
    });
    expect(res.status).toBe(true);
    expect(isWorkspaceSpecializedResultsEnabled()).toBe(false);
    expect(isWorkspaceSharedOrchestrationEnabled()).toBe(true);
    expect(isWorkspaceVoiceMemoryEnabled()).toBe(true);
  });

  it("rolls back voice/memory independently", async () => {
    const res = await invoke(AI_CHAT_WORKSPACE_SET_FLAG, {
      enabled: false,
      feature: "voice_memory",
    });
    expect(res.status).toBe(true);
    expect(isWorkspaceVoiceMemoryEnabled()).toBe(false);
    expect(isWorkspaceSpecializedResultsEnabled()).toBe(true);
    expect(isWorkspaceSharedOrchestrationEnabled()).toBe(true);
  });

  it("re-enables an adapter explicitly", async () => {
    tokenValues.set(AI_CHAT_WORKSPACE_VOICE_MEMORY, "false");
    expect(isWorkspaceVoiceMemoryEnabled()).toBe(false);
    const res = await invoke(AI_CHAT_WORKSPACE_SET_FLAG, {
      enabled: true,
      feature: "voice_memory",
    });
    expect(res.status).toBe(true);
    expect(tokenValues.get(AI_CHAT_WORKSPACE_VOICE_MEMORY)).toBe("true");
    expect(isWorkspaceVoiceMemoryEnabled()).toBe(true);
  });

  it("still stores the main workspace switch under the classic key", async () => {
    const res = await invoke(AI_CHAT_WORKSPACE_SET_FLAG, {
      enabled: false,
      feature: "redesign",
    });
    expect(res.status).toBe(true);
    expect(tokenValues.get(USER_AI_CHAT_WORKSPACE_REDESIGN)).toBe("false");
    expect(isWorkspaceRedesignEnabled()).toBe(false);
  });

  it("rejects unknown feature names instead of guessing", async () => {
    const res = await invoke(AI_CHAT_WORKSPACE_SET_FLAG, {
      enabled: false,
      feature: "not_a_feature",
    });
    expect(res.status).toBe(false);
    expect(res.msg).toBe("Invalid flag request");
    // Nothing was persisted.
    expect(tokenValues.size).toBe(0);
  });

  it("rejects malformed bodies", async () => {
    const bad = await invoke(AI_CHAT_WORKSPACE_SET_FLAG, {
      feature: "voice_memory",
    });
    expect(bad.status).toBe(false);
    expect(bad.msg).toBe("Invalid flag request");
    const badGet = await invoke(AI_CHAT_WORKSPACE_GET_FLAG, undefined);
    expect(badGet.status).toBe(false);
    expect(badGet.msg).toBe("Invalid flag request");
    const badType = await invoke(AI_CHAT_WORKSPACE_SET_FLAG, {
      enabled: "yes",
      feature: "voice_memory",
    });
    expect(badType.status).toBe(false);
    expect(badType.msg).toBe("Invalid flag request");
  });
});
