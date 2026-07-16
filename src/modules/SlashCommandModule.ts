// src/modules/SlashCommandModule.ts
// Three-layer Module (CLAUDE.md) sitting between the IPC handler layer
// (src/main-process/communication/slash-command-ipc.ts) and the slash
// command services (registry + dispatcher + config manager).
//
// Per CLAUDE.md:
//   - IPC handlers NEVER touch the database directly; they call Modules.
//   - Modules extend BaseModule (for DB-backed Modules) — this Module
//     has NO DB access (phase 13 is file-backed + in-memory) and so does
//     NOT extend BaseModule, but still follows the same single-purpose
//     Module pattern. No TypeORM imports (verified by grep gate).
//
// Phase-13 scope: listCommands / dispatch / reloadConfig / getStatus.
// All four delegate to the registry + dispatcher + manager trio.

import type {
  SlashCommandDispatchRequest,
  SlashCommandDispatchResponse,
  SlashCommandListResponse,
  SlashCommandView,
} from "@/entityTypes/slashCommandTypes";
import {
  CommandRegistry,
  rankSuggestions,
} from "@/service/slashCommands/CommandRegistry";
import { SlashCommandDispatcher } from "@/service/slashCommands/SlashCommandDispatcher";
import {
  nonWorkspaceSlashCommandScopeResolver,
  type SlashCommandScopeResolver,
} from "@/service/slashCommands/SlashCommandScopeResolver";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import type {
  AIFetchlyConfigManager,
  AIFetchlyConfigReloadSummary,
  AIFetchlyConfigStatus,
} from "@/service/aifetchlyConfig/AIFetchlyConfigManager";

/** Optional filters accepted by {@link SlashCommandModule.listCommands}. */
export interface SlashCommandListRequest {
  readonly conversationId?: string;
  readonly query?: string;
}

/** Optional context accepted by status/reload. */
export interface SlashCommandContextRequest {
  readonly conversationId?: string;
}

/**
 * SlashCommandModule — coordinates the CommandRegistry, SlashCommandDispatcher,
 * and AIFetchlyConfigManager for the IPC layer.
 *
 * Constructed per-request by the IPC handler. Cheap to construct (no I/O
 * on the constructor). All public methods are async for forward-compat
 * (phase 14+ may add async trust-resolution before listing/dispatching).
 */
export class SlashCommandModule {
  private readonly registry: CommandRegistry;
  private readonly dispatcher: SlashCommandDispatcher;
  private readonly manager: AIFetchlyConfigManager;
  private readonly scopeResolver: SlashCommandScopeResolver;

  constructor(
    registry?: CommandRegistry,
    manager?: AIFetchlyConfigManager,
    scopeResolver: SlashCommandScopeResolver = nonWorkspaceSlashCommandScopeResolver
  ) {
    // Resolve the collaborators. Production callers (the IPC layer) pass
    // the singleton manager + its registry + the workspace-aware scope
    // resolver; tests pass fresh instances and rely on the DB-free default
    // resolver unless they explicitly inject one.
    this.manager = manager ?? getAIFetchlyConfigManager();
    this.registry = registry ?? this.manager.getCommandRegistry();
    this.dispatcher = new SlashCommandDispatcher(this.registry, this.manager);
    this.scopeResolver = scopeResolver;
  }

  /**
   * List commands as renderer-safe views, ranked by query (CMD-07). The views
   * are scoped to the conversation's approved workspace first (FR-1), so a
   * workspace command never appears in a chat that did not select that
   * workspace. Empty query returns all scoped commands in registry order.
   * Diagnostics array is empty in phase 13 (no per-command diagnostics yet).
   */
  async listCommands(
    req: SlashCommandListRequest
  ): Promise<SlashCommandListResponse> {
    const { commandScope } = await this.scopeResolver.resolve(
      req.conversationId
    );
    const all = this.registry.listScopedViews(commandScope);
    const query = (req.query ?? "").trim();
    const ranked: SlashCommandView[] =
      query.length === 0 ? [...all] : rankSuggestions(query, all);
    return {
      status: true,
      commands: ranked,
      diagnostics: [],
      msg: "",
    };
  }

  /** Dispatch a single composer submission (CMD-04 / CMD-08), scoped (FR-2). */
  async dispatch(
    req: SlashCommandDispatchRequest
  ): Promise<SlashCommandDispatchResponse> {
    const { commandScope } = await this.scopeResolver.resolve(
      req.conversationId
    );
    return this.dispatcher.dispatch(req, { scope: commandScope });
  }

  /**
   * Force a config rescan (DX-02 + success criterion 3). Takes no
   * parameters in phase 13 (forward-compat: phase 14+ workspace trust
   * resolution may add a conversationId context arg).
   */
  async reloadConfig(): Promise<AIFetchlyConfigReloadSummary> {
    return this.manager.reload();
  }

  /**
   * Read the current config status (DX-02). Same forward-compat note as
   * {@link reloadConfig} re: a future conversationId context arg.
   */
  async getStatus(): Promise<AIFetchlyConfigStatus> {
    return this.manager.getStatus();
  }
}
