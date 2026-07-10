import type {
  AIWorkspaceMemoryCreateInput,
  AIWorkspaceMemoryUpdateInput,
  AIWorkspaceMemorySearchInput,
  AIWorkspaceMemoryView,
  AIWorkspaceAutoDreamStatusView,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import type { CommonMessage } from "@/entityTypes/commonType";

interface ApiShape {
  invoke(
    channel: string,
    data?: string | Record<string, unknown> | unknown
  ): Promise<CommonMessage<unknown>>;
}

function api(): ApiShape {
  const w = window as unknown as {
    api?: ApiShape;
  };
  if (!w.api || typeof w.api.invoke !== "function") {
    throw new Error("window.api is not exposed by preload");
  }
  return w.api;
}

function toData(input: unknown): string {
  if (input === undefined) return "";
  if (typeof input === "string") return input;
  return JSON.stringify(input);
}

async function call<T>(
  channel: string,
  input?: unknown
): Promise<CommonMessage<T>> {
  return (await api().invoke(channel, toData(input))) as CommonMessage<T>;
}

// Channel constants kept local to this wrapper to avoid coupling the
// renderer import graph to the main-process channellist module.
const CH = {
  LIST: "ai:workspace-memory:list",
  CREATE: "ai:workspace-memory:create",
  UPDATE: "ai:workspace-memory:update",
  ARCHIVE: "ai:workspace-memory:archive",
  DELETE: "ai:workspace-memory:delete",
  RUN_AUTO_DREAM: "ai:workspace-memory:auto-dream:run",
  AUTO_DREAM_STATUS: "ai:workspace-memory:auto-dream:status",
} as const;

export const workspaceMemoryApi = {
  list: (input: AIWorkspaceMemorySearchInput) =>
    call<AIWorkspaceMemoryView[]>(CH.LIST, input),
  create: (input: AIWorkspaceMemoryCreateInput) =>
    call<AIWorkspaceMemoryView>(CH.CREATE, input),
  update: (input: AIWorkspaceMemoryUpdateInput) =>
    call<AIWorkspaceMemoryView>(CH.UPDATE, input),
  archive: (input: { conversationId: string; memoryId: string }) =>
    call<null>(CH.ARCHIVE, input),
  delete: (input: { conversationId: string; memoryId: string }) =>
    call<number>(CH.DELETE, input),
  runAutoDream: (input: { conversationId: string; force?: boolean } = {
    conversationId: "",
  }) => call<unknown>(CH.RUN_AUTO_DREAM, input),
  autoDreamStatus: () => call<AIWorkspaceAutoDreamStatusView>(CH.AUTO_DREAM_STATUS),
};
