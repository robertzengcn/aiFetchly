import type {
  AIUserMemoryCreateInput,
  AIUserMemoryUpdateInput,
  AIUserMemorySearchInput,
  AIUserMemoryView,
  AIMemoryConsolidationRunView,
} from "@/entityTypes/aiUserMemoryTypes";
import type { CommonMessage } from "@/entityTypes/commonType";

/**
 * Renderer-facing wrapper for the AI user memory IPC channels.
 *
 * The preload exposes a single `window.api.invoke(channel, data)` function
 * with an allowlist. This wrapper hides JSON.stringify and channel constants
 * so call sites stay typed.
 */

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
  LIST: "ai:user-memory:list",
  CREATE: "ai:user-memory:create",
  UPDATE: "ai:user-memory:update",
  ARCHIVE: "ai:user-memory:archive",
  DELETE: "ai:user-memory:delete",
  RUN_AUTO_DREAM: "ai:user-memory:auto-dream:run",
  AUTO_DREAM_STATUS: "ai:user-memory:auto-dream:status",
} as const;

export const aiUserMemoryApi = {
  list: (input: AIUserMemorySearchInput = {}) =>
    call<AIUserMemoryView[]>(CH.LIST, input),
  create: (input: AIUserMemoryCreateInput) =>
    call<AIUserMemoryView>(CH.CREATE, input),
  update: (input: AIUserMemoryUpdateInput) =>
    call<AIUserMemoryView>(CH.UPDATE, input),
  archive: (memoryId: string) => call<null>(CH.ARCHIVE, JSON.stringify(memoryId)),
  delete: (memoryId: string) =>
    call<number>(CH.DELETE, JSON.stringify(memoryId)),
  runAutoDream: (input: { force?: boolean } = {}) =>
    call<AIMemoryConsolidationRunView>(CH.RUN_AUTO_DREAM, input),
  autoDreamStatus: () => call<unknown>(CH.AUTO_DREAM_STATUS),
};
