"use strict";
import { ipcMain, app, shell, dialog } from "electron";
import * as fs from "fs";
import * as path from "path";
import {
  DIAGNOSTICS_RENDERER_ERROR,
  DIAGNOSTICS_EXPORT_REPORT,
  DIAGNOSTICS_UPLOAD_REPORT,
  DIAGNOSTICS_OPEN_FOLDER,
  DIAGNOSTICS_GET_STATUS,
  DIAGNOSTICS_SET_DEBUG,
  DIAGNOSTICS_CLEAR_LOCAL,
  DIAGNOSTICS_LIST_CRASHES,
} from "@/config/channellist";
import {
  rendererErrorPayloadSchema,
  uploadReportInputSchema,
  setDebugInputSchema,
} from "@/schemas/ipc/diagnostics";
import {
  getCrashReporterFromGlobal,
  CrashReporterService,
  DiagnosticUploadClient,
  type HttpClientLike,
} from "@/modules/diagnostics";
import { CrashLogSink } from "@/modules/diagnostics/CrashLogSink";
import { DiagnosticReportBuilder } from "@/modules/diagnostics/DiagnosticReportBuilder";
import { getDiagnosticsDir } from "@/modules/diagnostics/DiagnosticPaths";
import { recordRendererErrorPayload } from "@/modules/diagnostics/CrashReporterService";
import {
  getOrCreateInstallId,
  newSessionId,
} from "@/modules/diagnostics/DiagnosticIdentity";
import { resolveViteLoginBase } from "@/config/viteLoginUrl";
import { Token } from "@/modules/token";
import { TOKENNAME } from "@/config/usersetting";

// Per-webContents rate limit: max 10 renderer-error IPC/min.
const rendererErrorTimestamps = new Map<number, number[]>();
const RATE_LIMIT_PER_MIN = 10;

/** Local files cleared by the "clear local diagnostics" action. */
const LOCAL_DIAGNOSTIC_FILES = [
  "error.jsonl",
  "crash.jsonl",
  "debug.log",
  "app.log",
] as const;

/**
 * Minimal structural type for the ipcMain.handle event parameter, limited to
 * the `sender.id` field used for per-webContents rate limiting. The test mock
 * for `ipcMain.handle` types the handler args as `unknown[]`, so we narrow here
 * rather than importing `IpcMainInvokeEvent` (which the mock does not export).
 */
type IpcInvokeEvent = { sender: { id: number } };

/** Storage budget (200 MB) returned in the status payload. */
const STORAGE_BUDGET_BYTES = 200 * 1024 * 1024;

/** Resolve the backend base URL via the same helper HttpClient uses. */
function getRemoteBase(): string | null {
  const resolved = resolveViteLoginBase();
  return resolved?.value ?? null;
}

/** Path of the .debug-enabled flag file inside the diagnostics directory. */
function debugFlagPath(): string {
  return path.join(getDiagnosticsDir(), ".debug-enabled");
}

/**
 * Read the current debug-enabled expiry, returning null when the flag is
 * missing or expired. The file contains an ISO timestamp written by
 * {@link writeDebugExpiry}.
 */
function readDebugExpiry(): string | null {
  try {
    const p = debugFlagPath();
    if (!fs.existsSync(p)) return null;
    const v = fs.readFileSync(p, "utf8").trim();
    return v && Date.parse(v) > Date.now() ? v : null;
  } catch {
    return null;
  }
}

/**
 * Enable (write a 24h-from-now expiry) or disable (remove the flag file)
 * verbose debug capture. Never throws.
 */
function writeDebugExpiry(enabled: boolean): void {
  const p = debugFlagPath();
  if (!enabled) {
    try {
      fs.rmSync(p);
    } catch {
      /* ignore — file may not exist */
    }
    return;
  }
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  try {
    fs.writeFileSync(p, expiry);
  } catch {
    /* ignore — best effort */
  }
}

/** Recursively measure the total size in bytes of a directory. */
function measureDir(dir: string): number {
  let total = 0;
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* ignore unreadable files */
        }
      }
    }
  };
  walk(dir);
  return total;
}

/** Best-effort access to the singleton crash reporter installed in background.ts. */
function getSvc(): CrashReporterService | undefined {
  return getCrashReporterFromGlobal();
}

/** Session id from the reporter if available, otherwise generate a fresh one. */
function getSessionId(svc: CrashReporterService | undefined): string {
  return svc ? svc.sessionId : newSessionId();
}

/**
 * Resolve the app version. Real Electron's `app.getVersion()` exists; the test
 * mock does not include it, so we guard with an optional-aware cast rather than
 * `any` (CLAUDE.md forbids `any`). Falls back to "unknown" when unavailable.
 */
function getAppVersion(): string {
  try {
    const fn = (app as unknown as { getVersion?: () => string }).getVersion;
    return typeof fn === "function" ? fn.call(app) : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Build a {@link DiagnosticReportBuilder} preconfigured with the current
 * app/version/platform/install/session identity and live breadcrumb/error
 * buffers from the crash reporter (or empty arrays when the reporter is not
 * yet initialised).
 */
function makeBuilder(): DiagnosticReportBuilder {
  const svc = getSvc();
  return new DiagnosticReportBuilder({
    appVersion: getAppVersion(),
    platform: process.platform,
    arch: process.arch,
    installId: getOrCreateInstallId(),
    sessionId: getSessionId(svc),
    breadcrumbs: svc?.getBreadcrumbs() ?? [],
    recentErrors: svc?.getRecentErrors() ?? [],
  });
}

/**
 * Read the auth token from the project's Token service. Returns null when no
 * token is stored, enabling anonymous upload.
 */
function getAuthToken(): string | null {
  try {
    const t = new Token();
    const tok = t.getValue(TOKENNAME);
    return tok && tok.length > 0 ? `Bearer ${tok}` : null;
  } catch {
    return null;
  }
}

/**
 * Minimal fetch-based adapter satisfying {@link HttpClientLike}. The project's
 * main HttpClient is form-data oriented and tightly coupled to the login base
 * URL + token-refresh machinery, which is not appropriate for a one-off JSON
 * POST to the crash-reports endpoint. We therefore inject this small adapter
 * into {@link DiagnosticUploadClient}.
 */
const fetchHttp: HttpClientLike = {
  async post(
    url: string,
    body: unknown,
    config: { headers: Record<string, string>; timeout: number }
  ): Promise<{ status: number; data: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeout);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: config.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let parsed: unknown = undefined;
      const text = await res.text();
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { rawText: text };
        }
      }
      return { status: res.status, data: parsed };
    } finally {
      clearTimeout(timer);
    }
  },
};

/**
 * Register all diagnostics IPC handlers on ipcMain. Idempotent — ipcMain
 * itself guards against duplicate handler registration.
 */
export function registerDiagnosticsIpcHandlers(): void {
  ipcMain.handle(DIAGNOSTICS_RENDERER_ERROR, async (event, raw: unknown) => {
    const parsed = rendererErrorPayloadSchema().parse(raw);
    const wcId = (event as IpcInvokeEvent).sender.id;
    const now = Date.now();
    // Keep only timestamps from the last 60s for this webContents.
    const ts = (rendererErrorTimestamps.get(wcId) ?? []).filter(
      (t) => now - t < 60_000
    );
    ts.push(now);
    rendererErrorTimestamps.set(wcId, ts);
    if (ts.length > RATE_LIMIT_PER_MIN) return;
    const svc = getSvc();
    if (svc) recordRendererErrorPayload(svc, parsed);
  });

  ipcMain.handle(DIAGNOSTICS_EXPORT_REPORT, async (_event, raw: unknown) => {
    // raw may optionally specify a crashId; default to the latest crash.
    const crashId = (raw as { crashId?: string } | null)?.crashId;
    const res = await dialog.showSaveDialog({
      title: "Export diagnostic report",
      defaultPath: `aifetchly-diagnostics-${Date.now()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (res.canceled || !res.filePath) return { path: null };
    const targetId = crashId ?? CrashLogSink.readAll()[0]?.crashId;
    if (!targetId) {
      // No crash record to export; write an empty JSON object placeholder.
      try {
        fs.writeFileSync(res.filePath, "{}");
      } catch {
        /* ignore */
      }
      return { path: res.filePath };
    }
    const pkg = makeBuilder().buildUploadPackage(targetId);
    const body = pkg ? JSON.stringify(pkg, null, 2) : "{}";
    try {
      fs.writeFileSync(res.filePath, body);
    } catch (e) {
      return {
        path: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    return { path: res.filePath };
  });

  ipcMain.handle(DIAGNOSTICS_UPLOAD_REPORT, async (_event, raw: unknown) => {
    const parsed = uploadReportInputSchema().parse(raw);
    const base = getRemoteBase();
    if (!base) {
      return { reportId: null, error: "Backend URL is not configured." };
    }
    const pkg = makeBuilder().buildUploadPackage(parsed.crashId, {
      extended: parsed.includeNativeDump,
    });
    if (!pkg) {
      return { reportId: null, error: "Crash record not found." };
    }
    const client = new DiagnosticUploadClient({
      endpoint: `${base}/api/crash-reports`,
      http: fetchHttp,
      authToken: getAuthToken(),
    });
    return client.upload(pkg);
  });

  ipcMain.handle(DIAGNOSTICS_OPEN_FOLDER, async () => {
    void shell.openPath(getDiagnosticsDir());
  });

  ipcMain.handle(DIAGNOSTICS_GET_STATUS, async () => {
    const dir = getDiagnosticsDir();
    const storageBytes = measureDir(dir);
    const last = CrashLogSink.readAll()[0];
    const debugExpiry = readDebugExpiry();
    return {
      storageBytes,
      budgetBytes: STORAGE_BUDGET_BYTES,
      debugEnabled: debugExpiry !== null,
      debugExpiresAt: debugExpiry,
      lastCrashId: last?.crashId ?? null,
    };
  });

  ipcMain.handle(DIAGNOSTICS_SET_DEBUG, async (_event, raw: unknown) => {
    const parsed = setDebugInputSchema().parse(raw);
    writeDebugExpiry(parsed.enabled);
  });

  ipcMain.handle(DIAGNOSTICS_CLEAR_LOCAL, async () => {
    const dir = getDiagnosticsDir();
    try {
      for (const name of LOCAL_DIAGNOSTIC_FILES) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) fs.rmSync(p);
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    return {};
  });

  ipcMain.handle(DIAGNOSTICS_LIST_CRASHES, async () => {
    return CrashLogSink.readAll()
      .slice(0, 10)
      .map((c) => ({
        crashId: c.crashId,
        timestamp: c.timestamp,
        crashType: c.crashType,
        message: c.message,
      }));
  });
}
