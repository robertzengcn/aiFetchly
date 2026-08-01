// src/main-process/communication/slash-command-ipc.ts
// Phase 13 (Plan 03b) — slash-command + AiFetchly-config IPC handlers.
//
// TRS-05 Strategy A (CRITICAL):
//   ALL four invoke handlers below use the non-AI-gated validation wrapper.
//   NONE of them use the AI-gated wrapper variant. Rationale:
//     - list/status/reload are not AI-serving (they return metadata only).
//     - dispatch of a built-in (local) command returns show_result — no
//       AI call is made, so there is nothing to gate.
//     - dispatch of a prompt-type command returns submit_prompt; the renderer
//       then submits that prompt through the EXISTING AI_CHAT_V2_STREAM
//       channel, which is gated by the PROVIDER-AWARE Chat V2 availability
//       check (canUseChat() in ai-chat-v2-ipc.ts handleStream) — run FIRST,
//       fail-closed, before the request is parsed. Hosted-provider chat
//       requires hosted entitlement; local-provider chat requires a valid
//       local-provider config. No strict hosted-only USER_AI_ENABLED gate is
//       applied to prompt slash commands (decision: provider-aware).
//   Verified at src/main-process/communication/ai-chat-v2-ipc.ts handleStream
//   (canUseChat() runs first and rejects before JSON.parse).
//
// Acceptance grep (TRS-05): the AI-gated wrapper literal MUST NOT appear
// anywhere in this file — verified by a 0-hit grep gate in the plan.

import type { BrowserWindow } from "electron";
import { z } from "zod";
import { registerValidatedHandler } from "./_shared/registerValidatedHandler";
import { lazySchema } from "@/utils/lazySchema";
import { SlashCommandModule } from "@/modules/SlashCommandModule";
import { WorkspaceSlashCommandScopeResolver } from "@/service/slashCommands/SlashCommandScopeResolver";
import { registerBuiltInSlashCommands } from "@/service/slashCommands/builtinSlashCommands";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import {
  SLASH_COMMAND_LIST,
  SLASH_COMMAND_DISPATCH,
  AIFETCHLY_CONFIG_RELOAD,
  AIFETCHLY_CONFIG_STATUS,
  AIFETCHLY_CONFIG_CHANGED,
} from "@/config/channellist";

// --- Schemas (lazySchema-cached per the project's existing pattern) ----------

const listRequestSchema = lazySchema(() =>
  z.object({
    conversationId: z.string().optional(),
    query: z.string().optional(),
  })
);

const dispatchRequestSchema = lazySchema(() =>
  z.object({
    conversationId: z.string(),
    rawInput: z.string(),
  })
);

const reloadRequestSchema = lazySchema(() =>
  z.object({
    conversationId: z.string().optional(),
  })
);

const statusRequestSchema = lazySchema(() =>
  z.object({
    conversationId: z.string().optional(),
  })
);

// --- Handler registration ---------------------------------------------------

/**
 * Register the four phase-13 slash-command/config invoke handlers + the
 * built-in slash commands on the singleton CommandRegistry. Owns ALL
 * slash-command setup so callers (background.ts / index.ts) only need to
 * invoke this once.
 *
 * The fifth channel, AIFETCHLY_CONFIG_CHANGED, is a main->renderer EVENT
 * sent via win.webContents.send after a successful reload — NOT an invoke
 * handler. Payload carries counts + diff metadata only (no raw file bodies
 * — T-13-Leak mitigation).
 *
 * @param win The BrowserWindow used to emit main->renderer events. The
 *            handler guards against the window being destroyed before
 *            sending so a late reload during shutdown never throws.
 */
export function registerSlashCommandHandlers(win: BrowserWindow): void {
  // 1. Register built-ins on the singleton CommandRegistry. Idempotent —
  //    the registry's id-based replace semantics mean re-calling this
  //    during HMR / multiple windows does not duplicate commands.
  const manager = getAIFetchlyConfigManager();
  registerBuiltInSlashCommands(manager.getCommandRegistry());
  // Workspace-aware scope resolver shared by list + dispatch so they agree on
  // exactly which commands a conversation may see (FR-1..FR-3).
  const scopeResolver = new WorkspaceSlashCommandScopeResolver();

  // 2. list — SlashCommandView[] ranked by query (CMD-07), scoped to the
  //    conversation's approved workspace (FR-1).
  registerValidatedHandler(
    SLASH_COMMAND_LIST,
    listRequestSchema,
    async (input) => {
      const module = new SlashCommandModule(undefined, manager, scopeResolver);
      return module.listCommands(input);
    }
  );

  // 3. dispatch — CMD-04 discriminated union. Built-in (local) commands
  //    return show_result; prompt-type commands return submit_prompt and
  //    the renderer submits via AI_CHAT_V2_STREAM, which is gated downstream
  //    by the provider-aware Chat V2 availability check (canUseChat()) —
  //    TRS-05 Strategy A. Scoped resolution (FR-2) ensures a workspace
  //    command cannot be dispatched from the wrong conversation.
  registerValidatedHandler(
    SLASH_COMMAND_DISPATCH,
    dispatchRequestSchema,
    async (input) => {
      const module = new SlashCommandModule(undefined, manager, scopeResolver);
      return module.dispatch(input);
    }
  );

  // 4. reload — force rescan + emit AIFETCHLY_CONFIG_CHANGED on success.
  //    On failure the handler returns status:false and NO event is sent
  //    (fail-closed — the renderer never sees a phantom refresh).
  registerValidatedHandler(
    AIFETCHLY_CONFIG_RELOAD,
    reloadRequestSchema,
    async () => {
      const module = new SlashCommandModule(undefined, manager);
      const summary = await module.reloadConfig();
      emitConfigChanged(win, { source: "user", summary });
      return summary;
    }
  );

  // 5. status — synchronous-ish read of manager.getStatus() (DX-02).
  registerValidatedHandler(
    AIFETCHLY_CONFIG_STATUS,
    statusRequestSchema,
    async () => {
      const module = new SlashCommandModule(undefined, manager);
      return module.getStatus();
    }
  );
}

/**
 * Emit AIFETCHLY_CONFIG_CHANGED to the renderer. Guards against the
 * window's webContents being destroyed between the reload starting and
 * finishing.
 *
 * Payload is a JSON-stringified object carrying counts + diff metadata
 * only — never raw file bodies or prompt content (T-13-Leak mitigation).
 */
function emitConfigChanged(
  win: BrowserWindow,
  payload: { source: string; summary: unknown }
): void {
  if (!win) return;
  const contents = win.webContents;
  if (!contents) return;
  // Defensive: real Electron's webContents has isDestroyed(); test mocks
  // may not. Guard the typeof so a missing method never throws during
  // shutdown / mid-reload window destruction.
  if (
    typeof (contents as unknown as { isDestroyed?: () => boolean })
      .isDestroyed === "function" &&
    (contents as unknown as { isDestroyed: () => boolean }).isDestroyed()
  ) {
    return;
  }
  contents.send(AIFETCHLY_CONFIG_CHANGED, JSON.stringify(payload));
}
