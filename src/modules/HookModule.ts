import { BaseModule } from "./baseModule";
import { HookModel, NewHookRow, HookPatch } from "@/model/Hook.model";
import { HookConfigEntity } from "@/entity/HookConfig.entity";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";
import { Token } from "@/modules/token";
import { USER_HOOKS_BUILTIN_OVERRIDES } from "@/config/usersetting";
import { HOOK_LIMITS } from "@/entityTypes/hookTypes";
import type {
  CommandHookDefinition,
  HookEventName,
} from "@/entityTypes/hookTypes";

export interface CreateHookInput {
  id: string;
  eventName: HookEventName;
  matcher?: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  failureMode?: "warn" | "block";
  statusMessage?: string;
  envAllowlist?: string[];
  enabled?: boolean;
  trusted?: boolean;
}

/**
 * Business logic for user-configured hooks. Owns the bridge between
 * the persisted HookConfig table and the in-memory HookRegistry /
 * HookCommandTrustService.
 *
 * Main-process only. IPC handlers call this module; they never touch
 * the model layer directly.
 */
export class HookModule extends BaseModule {
  private readonly model: HookModel;

  constructor() {
    super();
    this.model = new HookModel(this.dbpath);
  }

  async create(input: CreateHookInput): Promise<HookConfigEntity> {
    this.validate(input);
    const row: NewHookRow = {
      id: input.id,
      eventName: input.eventName,
      matcher: input.matcher ?? null,
      hookType: "command",
      command: input.command,
      cwd: input.cwd ?? null,
      timeoutMs: input.timeoutMs ?? HOOK_LIMITS.defaultCommandTimeoutMs,
      failureMode: input.failureMode ?? "warn",
      statusMessage: input.statusMessage ?? null,
      envAllowlist: input.envAllowlist
        ? JSON.stringify(input.envAllowlist)
        : null,
      source: "user",
      enabled: input.enabled ?? false,
      trusted: input.trusted ?? false,
    };

    const saved = await this.model.create(row);
    await this.reloadUserHooksInRegistry();
    return saved;
  }

  async update(id: string, patch: HookPatch): Promise<HookConfigEntity> {
    if (
      patch.matcher !== undefined &&
      patch.matcher !== null &&
      patch.matcher.length > HOOK_LIMITS.maxMatcherChars
    ) {
      throw new Error(`matcher exceeds ${HOOK_LIMITS.maxMatcherChars} chars`);
    }
    if (
      patch.timeoutMs !== undefined &&
      patch.timeoutMs > HOOK_LIMITS.maxCommandTimeoutMs
    ) {
      throw new Error(`timeoutMs exceeds ${HOOK_LIMITS.maxCommandTimeoutMs}ms`);
    }
    const updated = await this.model.update(id, patch);
    await this.reloadUserHooksInRegistry();
    return updated;
  }

  async deleteById(id: string): Promise<void> {
    const existing = await this.model.findById(id);
    if (existing?.source !== "user") {
      throw new Error(`Only user hooks can be deleted (id=${id})`);
    }
    await this.model.deleteById(id);
    HookCommandTrustService.setTrusted(id, false);
    await this.reloadUserHooksInRegistry();
  }

  async setEnabled(id: string, enabled: boolean): Promise<HookConfigEntity> {
    return this.update(id, { enabled });
  }

  async setTrusted(id: string, trusted: boolean): Promise<HookConfigEntity> {
    const updated = await this.model.update(id, { trusted });
    HookCommandTrustService.setTrusted(id, trusted);
    await this.reloadUserHooksInRegistry();
    return updated;
  }

  async listUserHooks(): Promise<HookConfigEntity[]> {
    return this.model.listBySource("user");
  }

  async findById(id: string): Promise<HookConfigEntity | null> {
    return this.model.findById(id);
  }

  /**
   * Startup hydration. Reads all user hooks, pushes enabled ones into
   * HookRegistry, and populates HookCommandTrustService cache from
   * the trusted column.
   *
   * Order: apply builtin overrides first (mutates already-registered
   * builtins in place), then replace user hooks.
   */
  async loadUserHooksIntoRegistry(): Promise<void> {
    await this.applyBuiltinOverrides();
    const rows = await this.model.listBySource("user");
    for (const r of rows) {
      if (r.trusted) {
        HookCommandTrustService.setTrusted(r.id, true);
      }
    }
    const defs = rows.filter((r) => r.enabled).map((r) => this.toDefinition(r));
    HookRegistry.replaceUserHooks(defs);
  }

  /**
   * Read the builtin override map from Token and apply it to the
   * already-registered builtins. Builtins register themselves with
   * their code-defined default `enabled` state at app init; this
   * runs afterwards and flips the flag based on user preference.
   *
   * The override map shape: `{ [hookId: string]: { enabled: boolean } }`
   * stored as JSON in Token under USER_HOOKS_BUILTIN_OVERRIDES.
   */
  async applyBuiltinOverrides(): Promise<void> {
    const t = new Token();
    const raw = t.getValue(USER_HOOKS_BUILTIN_OVERRIDES);
    if (!raw) return;

    let map: Record<string, { enabled: boolean }>;
    try {
      map = JSON.parse(raw);
    } catch {
      console.warn("[HookModule] malformed builtin overrides JSON, ignoring");
      return;
    }

    const all = HookRegistry.listAll({ source: "builtin" });
    for (const hook of all) {
      const override = map[hook.id];
      if (!override) continue;
      HookRegistry.setBuiltinEnabled(hook.id, override.enabled);
    }
  }

  async reloadUserHooksInRegistry(): Promise<void> {
    await this.loadUserHooksIntoRegistry();
  }

  async deleteAllUserHooksForTests(): Promise<void> {
    await this.model.deleteAll();
    HookRegistry.replaceUserHooks([]);
  }

  private validate(input: CreateHookInput): void {
    if (!input.id) throw new Error("id is required");
    if (!input.command) throw new Error("command is required");
    if (input.matcher && input.matcher.length > HOOK_LIMITS.maxMatcherChars) {
      throw new Error(`matcher exceeds ${HOOK_LIMITS.maxMatcherChars} chars`);
    }
    if (input.timeoutMs && input.timeoutMs > HOOK_LIMITS.maxCommandTimeoutMs) {
      throw new Error(`timeoutMs exceeds ${HOOK_LIMITS.maxCommandTimeoutMs}ms`);
    }
  }

  private toDefinition(row: HookConfigEntity): CommandHookDefinition {
    return {
      id: row.id,
      eventName: row.eventName as HookEventName,
      matcher: row.matcher ?? undefined,
      source: "user",
      enabled: row.enabled,
      trusted: row.trusted,
      type: "command",
      command: row.command,
      cwd: row.cwd ?? undefined,
      timeoutMs: row.timeoutMs,
      failureMode: row.failureMode as "warn" | "block",
      statusMessage: row.statusMessage ?? undefined,
      envAllowlist: this.parseEnvAllowlist(row.envAllowlist),
    };
  }

  private parseEnvAllowlist(raw: string | null): readonly string[] | undefined {
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn(
          `[HookModule] envAllowlist is not an array, ignoring: ${raw}`
        );
        return undefined;
      }
      return parsed.filter((v): v is string => typeof v === "string");
    } catch (err) {
      console.warn(
        `[HookModule] failed to parse envAllowlist JSON, ignoring: ${raw}`,
        err
      );
      return undefined;
    }
  }
}
