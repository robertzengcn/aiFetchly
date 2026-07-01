/**
 * Hooks IPC Handlers — Phase 4 management UI.
 *
 * Thin: input shape validation + delegation to HookModule /
 * HookAuditModule. No direct database access, no repository use.
 */
import { ipcMain } from "electron";
import { HookModule } from "@/modules/HookModule";
import { HookAuditModule } from "@/modules/HookAuditModule";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { Token } from "@/modules/token";
import {
  USER_HOOKS_ENABLED,
  USER_HOOKS_BUILTIN_OVERRIDES,
} from "@/config/usersetting";
import {
  HOOKS_LIST,
  HOOKS_CREATE,
  HOOKS_UPDATE,
  HOOKS_DELETE,
  HOOKS_SET_ENABLED,
  HOOKS_SET_TRUSTED,
  HOOKS_GET_GLOBAL_ENABLE,
  HOOKS_SET_GLOBAL_ENABLE,
  HOOKS_LIST_AUDIT,
} from "@/config/channellist";
import type { HookEventName, HookSource } from "@/entityTypes/hookTypes";

interface Envelope<T> {
  status: boolean;
  data: T | null;
  msg: string;
}
function ok<T>(data: T): Envelope<T> {
  return { status: true, data, msg: "" };
}
function fail(msg: string): Envelope<null> {
  return { status: false, data: null, msg };
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function registerHooksIpcHandlers(): void {
  ipcMain.handle(HOOKS_LIST, async (_event, data) => {
    try {
      const filter = isObject(data) ? data : {};
      const source = isString(filter.source)
        ? (filter.source as HookSource | "all")
        : "all";
      const includeSession = filter.includeSession === true;
      const eventName = isString(filter.eventName)
        ? (filter.eventName as HookEventName)
        : undefined;
      const all = HookRegistry.listAll({
        source: source === "all" ? undefined : source,
        includeSession,
        eventName,
      });
      return ok(all);
    } catch (err: unknown) {
      return fail(`hooks:list failed: ${String(err)}`);
    }
  });

  ipcMain.handle(HOOKS_CREATE, async (_event, data) => {
    if (!isObject(data)) return fail("invalid payload");
    try {
      const module = new HookModule();
      const created = await module.create(
        data as unknown as Parameters<typeof module.create>[0]
      );
      return ok(created);
    } catch (err: unknown) {
      return fail(`hooks:create failed: ${String(err)}`);
    }
  });

  ipcMain.handle(HOOKS_UPDATE, async (_event, data) => {
    if (!isObject(data) || !isString(data.id)) return fail("invalid payload");
    try {
      const module = new HookModule();
      const updated = await module.update(
        data.id,
        (isObject(data.patch) ? data.patch : {}) as unknown as Parameters<
          typeof module.update
        >[1]
      );
      return ok(updated);
    } catch (err: unknown) {
      return fail(`hooks:update failed: ${String(err)}`);
    }
  });

  ipcMain.handle(HOOKS_DELETE, async (_event, data) => {
    if (!isObject(data) || !isString(data.id)) return fail("invalid payload");
    try {
      const module = new HookModule();
      await module.deleteById(data.id);
      return ok({ ok: true });
    } catch (err: unknown) {
      return fail(String(err));
    }
  });

  ipcMain.handle(HOOKS_SET_ENABLED, async (_event, data) => {
    if (
      !isObject(data) ||
      !isString(data.id) ||
      typeof data.enabled !== "boolean"
    ) {
      return fail("invalid payload");
    }
    try {
      const module = new HookModule();
      // User hook: DB-backed
      const existing = await module.findById(data.id);
      if (existing) {
        const updated = await module.setEnabled(
          data.id,
          data.enabled as boolean
        );
        return ok({
          id: updated.id,
          enabled: updated.enabled,
          source: updated.source,
        });
      }
      // Builtin: persist override in Token (no DB row)
      const t = new Token();
      const raw = t.getValue(USER_HOOKS_BUILTIN_OVERRIDES);
      let map: Record<string, { enabled: boolean }>;
      try {
        map = raw ? JSON.parse(raw) : {};
      } catch {
        map = {};
      }
      map[data.id] = { enabled: data.enabled as boolean };
      t.setValue(USER_HOOKS_BUILTIN_OVERRIDES, JSON.stringify(map));
      return ok({
        id: data.id,
        enabled: data.enabled as boolean,
        source: "builtin",
      });
    } catch (err: unknown) {
      return fail(String(err));
    }
  });

  ipcMain.handle(HOOKS_SET_TRUSTED, async (_event, data) => {
    if (
      !isObject(data) ||
      !isString(data.id) ||
      typeof data.trusted !== "boolean"
    ) {
      return fail("invalid payload");
    }
    try {
      const module = new HookModule();
      const updated = await module.setTrusted(data.id, data.trusted as boolean);
      return ok(updated);
    } catch (err: unknown) {
      return fail(String(err));
    }
  });

  ipcMain.handle(HOOKS_GET_GLOBAL_ENABLE, async () => {
    try {
      const t = new Token();
      return ok(t.getValue(USER_HOOKS_ENABLED) === "true");
    } catch (err: unknown) {
      return fail(String(err));
    }
  });

  ipcMain.handle(HOOKS_SET_GLOBAL_ENABLE, async (_event, data) => {
    if (!isObject(data) || typeof data.enabled !== "boolean")
      return fail("invalid payload");
    try {
      const t = new Token();
      t.setValue(
        USER_HOOKS_ENABLED,
        (data.enabled as boolean) ? "true" : "false"
      );
      return ok(data.enabled as boolean);
    } catch (err: unknown) {
      return fail(String(err));
    }
  });

  ipcMain.handle(HOOKS_LIST_AUDIT, async (_event, data) => {
    const filter = isObject(data) ? data : {};
    try {
      const module = new HookAuditModule();
      const result = await module.query({
        hookId: isString(filter.hookId) ? filter.hookId : undefined,
        eventName: isString(filter.eventName)
          ? (filter.eventName as HookEventName)
          : undefined,
        status: isString(filter.status) ? filter.status : undefined,
        fromTime:
          typeof filter.fromTime === "string"
            ? new Date(filter.fromTime)
            : undefined,
        toTime:
          typeof filter.toTime === "string"
            ? new Date(filter.toTime)
            : undefined,
        limit: typeof filter.limit === "number" ? filter.limit : 100,
        offset: typeof filter.offset === "number" ? filter.offset : 0,
      });
      return ok(result);
    } catch (err: unknown) {
      return fail(String(err));
    }
  });
}
