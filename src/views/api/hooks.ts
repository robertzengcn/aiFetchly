/**
 * Renderer-side API for the Hooks management UI. Wraps ipcRenderer
 * calls exposed via the preload bridge.
 */
import type {
  HookDefinition,
  HookEventName,
  HookAuditEntry,
  HookAuditStatus,
  HookSource,
} from "@/entityTypes/hookTypes";

export interface HookListFilter {
  source?: "builtin" | "user" | "all";
  includeSession?: boolean;
  eventName?: HookEventName;
}

export interface HookAuditFilter {
  hookId?: string;
  eventName?: HookEventName;
  status?: HookAuditStatus;
  limit?: number;
  offset?: number;
  fromTime?: string;
  toTime?: string;
}

export interface NewHookInput {
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

export interface HookConfigRow {
  id: string;
  eventName: string;
  matcher: string | null;
  hookType: string;
  command: string;
  cwd: string | null;
  timeoutMs: number;
  failureMode: string;
  statusMessage: string | null;
  envAllowlist: string | null;
  source: string;
  enabled: boolean;
  trusted: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Envelope<T> { status: boolean; data: T; msg: string; }

function api(): { invoke(channel: string, data?: unknown): Promise<unknown> } {
  return (window as unknown as {
    api: { invoke(channel: string, data?: unknown): Promise<unknown> };
  }).api;
}

async function invoke<T>(channel: string, data?: unknown): Promise<T> {
  const env = (await api().invoke(channel, data)) as Envelope<T>;
  if (!env.status) {
    throw new Error(env.msg || `hooks call failed: ${channel}`);
  }
  return env.data;
}

export async function listHooks(filter?: HookListFilter): Promise<HookDefinition[]> {
  return invoke<HookDefinition[]>("hooks:list", filter ?? {});
}

export async function createHook(input: NewHookInput): Promise<HookConfigRow> {
  return invoke<HookConfigRow>("hooks:create", input);
}

export async function updateHook(
  id: string,
  patch: Partial<HookConfigRow>
): Promise<HookConfigRow> {
  return invoke<HookConfigRow>("hooks:update", { id, patch });
}

export async function deleteHook(id: string): Promise<void> {
  await invoke<{ ok: boolean }>("hooks:delete", { id });
}

export async function setHookEnabled(
  id: string,
  enabled: boolean
): Promise<{ id: string; enabled: boolean; source: HookSource }> {
  return invoke("hooks:setEnabled", { id, enabled });
}

export async function setHookTrusted(
  id: string,
  trusted: boolean
): Promise<HookConfigRow> {
  return invoke("hooks:setTrusted", { id, trusted });
}

export async function getHooksGlobalEnable(): Promise<boolean> {
  return invoke<boolean>("hooks:getGlobalEnable");
}

export async function setHooksGlobalEnable(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("hooks:setGlobalEnable", { enabled });
}

export async function listHookAudit(
  filter?: HookAuditFilter
): Promise<{ rows: HookAuditEntry[]; total: number }> {
  return invoke("hooks:listAudit", filter ?? {});
}
