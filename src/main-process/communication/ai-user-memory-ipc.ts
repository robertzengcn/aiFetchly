import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { AIUserMemoryService } from "@/service/AIUserMemoryService";
import { getSharedAutoDreamService } from "@/service/AIAutoDreamFactory";
import {
  AI_USER_MEMORY_LIST,
  AI_USER_MEMORY_CREATE,
  AI_USER_MEMORY_UPDATE,
  AI_USER_MEMORY_ARCHIVE,
  AI_USER_MEMORY_DELETE,
  AI_USER_MEMORY_RUN_AUTO_DREAM,
  AI_USER_MEMORY_AUTO_DREAM_STATUS,
} from "@/config/channellist";
import type {
  AIUserMemoryCreateInput,
  AIUserMemoryUpdateInput,
  AIUserMemorySearchInput,
} from "@/entityTypes/aiUserMemoryTypes";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { registerAiValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { noInputSchema } from "@/schemas/ipc/_shared/common";

// WS-1 R1.5: input schemas (replacing manual safeParse + field-presence checks).
// `type` is validated as a non-empty string; the service enforces enum membership.
const listSchema = lazySchema(() => z.object({}).passthrough());
const createSchema = lazySchema(() =>
  z
    .object({
      title: z.string().min(1),
      content: z.string().min(1),
      type: z.string().min(1),
    })
    .passthrough()
);
const updateSchema = lazySchema(() =>
  z.object({ memoryId: z.string().min(1) }).passthrough()
);
const memoryIdSchema = lazySchema(() => z.string().min(1));
const runAutoDreamSchema = lazySchema(() =>
  z.object({ force: z.boolean().optional() }).passthrough()
);

let memoryService: AIUserMemoryService | null = null;

function getMemoryService(): AIUserMemoryService {
  if (!memoryService) {
    memoryService = new AIUserMemoryService();
  }
  return memoryService;
}

/**
 * Test-only: drop the cached memory service singleton so the next handler
 * call rebuilds it against freshly installed mocks. Never call from production.
 */
export function _resetAIUserMemorySingletonsForTesting(): void {
  memoryService = null;
}

export function registerAIUserMemoryIpcHandlers(): void {
  // CRUD handlers are Zod-validated + envelope-wrapped (not AI-gated — memory
  // management vs AI generation). Required-field checks moved into the schemas;
  // thrown errors become {status:false,msg} via the wrapper.

  registerValidatedHandler(AI_USER_MEMORY_LIST, listSchema, async (input) => {
    const result = await getMemoryService().list(
      input as unknown as AIUserMemorySearchInput
    );
    return result;
  });

  registerValidatedHandler(AI_USER_MEMORY_CREATE, createSchema, async (input) => {
    const result = await getMemoryService().createManualMemory(
      input as unknown as AIUserMemoryCreateInput
    );
    return result;
  });

  registerValidatedHandler(AI_USER_MEMORY_UPDATE, updateSchema, async (input) => {
    const result = await getMemoryService().update(
      input as unknown as AIUserMemoryUpdateInput
    );
    return result;
  });

  registerValidatedHandler(AI_USER_MEMORY_ARCHIVE, memoryIdSchema, async (memoryId) => {
    await getMemoryService().archive(memoryId);
    return null;
  });

  registerValidatedHandler(AI_USER_MEMORY_DELETE, memoryIdSchema, async (memoryId) => {
    const n = await getMemoryService().delete(memoryId);
    return n;
  });

  // RUN_AUTO_DREAM is AI-gated (it invokes the AI auto-dream service).
  registerAiValidatedHandler(
    AI_USER_MEMORY_RUN_AUTO_DREAM,
    runAutoDreamSchema,
    async (input) => {
      const result = await getSharedAutoDreamService().runNow({
        force: input.force === true,
        reason: "manual_ipc",
      });
      return result;
    }
  );

  registerValidatedHandler(
    AI_USER_MEMORY_AUTO_DREAM_STATUS,
    noInputSchema,
    async () => {
      const result = await getSharedAutoDreamService().getStatus();
      return result;
    }
  );
}
