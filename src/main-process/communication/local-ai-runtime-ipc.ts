// src/main-process/communication/local-ai-runtime-ipc.ts
import { app, type BrowserWindow } from "electron";
import { z } from "zod";
import {
  LOCAL_AI_RUNTIME_LIST,
  LOCAL_AI_RUNTIME_STATUS,
  LOCAL_AI_RUNTIME_PREPARE_INSTALL,
  LOCAL_AI_RUNTIME_INSTALL,
  LOCAL_AI_RUNTIME_CANCEL_INSTALL,
  LOCAL_AI_RUNTIME_CHECK_UPDATE,
  LOCAL_AI_RUNTIME_REPAIR,
  LOCAL_AI_RUNTIME_REMOVE,
  LOCAL_AI_RUNTIME_PROGRESS,
} from "@/config/channellist";
import { lazySchema } from "@/utils/lazySchema";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  runtimeStatusInputSchema,
  runtimePrepareInstallInputSchema,
  runtimeInstallInputSchema,
  runtimeCancelInputSchema,
  runtimeCheckUpdateInputSchema,
  runtimeRemoveInputSchema,
} from "@/schemas/ipc/localAiRuntime";
import { LocalAiRuntimeModule } from "@/modules/LocalAiRuntimeModule";
import { LocalAiRuntimePathService } from "@/service/localAiRuntime/LocalAiRuntimePathService";
import { LocalAiRuntimeStateStore } from "@/service/localAiRuntime/LocalAiRuntimeStateStore";
import { LocalAiRuntimeCatalogService } from "@/service/localAiRuntime/LocalAiRuntimeCatalogService";
import { LocalAiRuntimeCompatibilityService } from "@/service/localAiRuntime/LocalAiRuntimeCompatibilityService";
import { LocalAiRuntimeDownloadService } from "@/service/localAiRuntime/LocalAiRuntimeDownloadService";
import { LocalAiRuntimeResolver } from "@/service/localAiRuntime/LocalAiRuntimeResolver";
import { LocalAiRuntimeOperationCoordinator } from "@/service/localAiRuntime/LocalAiRuntimeOperationCoordinator";
import { LocalAiRuntimeHealthService } from "@/service/localAiRuntime/LocalAiRuntimeHealthService";
import { RUNTIME_CATALOG_CACHE_TTL_MS } from "@/service/localAiRuntime/localAiRuntimeConstants";
import { SherpaVoiceWorkerClient } from "@/service/aiChatVoice/SherpaVoiceWorkerClient";
import { LocalEmbeddingWorkerClient } from "@/service/embedding/LocalEmbeddingWorkerClient";
import type { LocalAiRuntimeModule as ModuleType } from "@/modules/LocalAiRuntimeModule";

const noInputSchema = lazySchema(() => z.unknown());

/**
 * Resolve the runtime catalog source (design §11.1 / FR-5):
 *   1. AIFETCHLY_RUNTIME_CATALOG_URL build config
 *   2. ${UPDATESERVER}/runtime/local-ai-runtimes.json
 *   3. (public distributions) a GitHub Release URL
 * Returns "" when none is configured; catalog fetches then fail gracefully and
 * remote features keep working — the base app must start without runtimes.
 */
function resolveCatalogSource(): {
  catalogUrl: string;
  allowedHosts: string[];
} {
  const explicit = process.env.AIFETCHLY_RUNTIME_CATALOG_URL;
  const updateServer = process.env.UPDATESERVER;
  const catalogUrl =
    explicit ||
    (updateServer
      ? `${updateServer.replace(/\/$/, "")}/runtime/local-ai-runtimes.json`
      : "");
  const allowedHosts: string[] = [];
  if (catalogUrl) {
    try {
      allowedHosts.push(new URL(catalogUrl).host);
    } catch {
      // ignore malformed
    }
  }
  // GitHub release asset hosts are served via objects.githubusercontent.com etc.;
  // keep the allowlist permissive (host-validated by TLS) until catalog signing lands.
  return { catalogUrl, allowedHosts };
}

export function createLocalAiRuntimeModule(
  getWindow: () => BrowserWindow | null
): ModuleType {
  const paths = new LocalAiRuntimePathService(app.getPath("userData"));
  const state = new LocalAiRuntimeStateStore(paths);
  const { catalogUrl, allowedHosts } = resolveCatalogSource();
  const catalog = new LocalAiRuntimeCatalogService(
    { catalogUrl, allowedHosts, cacheTtlMs: RUNTIME_CATALOG_CACHE_TTL_MS },
    state
  );
  const compatibility = new LocalAiRuntimeCompatibilityService();
  // Downloads use the catalog entries' URLs (e.g. GitHub release hosts), which
  // differ from the catalog host. The validated catalog IS the trust root, so
  // allowlisting the catalog host for downloads would wrongly reject every
  // archive. HTTPS-per-hop + no-credentials is still enforced by the downloader.
  const download = new LocalAiRuntimeDownloadService({
    enforceHttps: true,
    allowedHosts: [],
  });
  // The project narrows Electron's `app` type; read the version defensively.
  const appInfo = app as {
    getName(): string;
    getPath(p: string): string;
    getVersion?(): string;
  };
  const target = {
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron ?? "",
    nodeModuleAbi: String(process.versions.modules ?? ""),
    appVersion: appInfo.getVersion?.() ?? "0.0.0",
  };
  const resolver = new LocalAiRuntimeResolver(paths, state, target);
  const coordinator = new LocalAiRuntimeOperationCoordinator();
  const health = new LocalAiRuntimeHealthService();
  const runtimeModule = new LocalAiRuntimeModule({
    paths,
    state,
    catalog,
    compatibility,
    download,
    resolver,
    coordinator,
    health,
    target,
    publishProgress: (progress) => {
      const win = getWindow();
      const safeWin = win as {
        isDestroyed(): boolean;
        webContents: { send(channel: string, data: unknown): void };
      } | null;
      if (safeWin && !safeWin.isDestroyed()) {
        safeWin.webContents.send(LOCAL_AI_RUNTIME_PROGRESS, progress);
      }
    },
  });

  // Composition (design §13.1): wire downloaded-runtime resolution into the
  // voice + embedding worker client singletons so inference loads from the
  // active runtime. Voice uses the runtime root (scoped sherpa createRequire);
  // embedding forks the runtime's worker.js entry point. Both fall back to the
  // bundled packages when no runtime is installed (FR-17). Guarded so a failure
  // to obtain a singleton (e.g. in a non-main process context) never blocks the
  // runtime manager itself.
  installWorkerRuntimeResolvers(runtimeModule);

  return runtimeModule;
}

/**
 * Install the LocalAiRuntimeModule-backed resolvers on the voice + embedding
 * worker client singletons. Idempotent and best-effort.
 */
function installWorkerRuntimeResolvers(runtimeModule: ModuleType): void {
  // Voice: resolve the active voice-sherpa runtime root.
  try {
    SherpaVoiceWorkerClient.getInstance().setRuntimeRootResolver(async () => {
      const resolved = await runtimeModule.resolveForUse("voice-sherpa");
      return resolved?.runtimeRoot ?? null;
    });
  } catch (error) {
    console.warn(
      "[local-ai-runtime] Could not install voice runtime resolver:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // Embedding: resolve the active embedding-xenova worker entry path.
  try {
    LocalEmbeddingWorkerClient.getInstance().setWorkerPathResolver(async () => {
      const resolved = await runtimeModule.resolveForUse("embedding-xenova");
      return resolved?.entryPath ?? null;
    });
  } catch (error) {
    console.warn(
      "[local-ai-runtime] Could not install embedding runtime resolver:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Register local AI runtime IPC handlers. These are component-management
 * operations, not hosted AI requests, so they use registerValidatedHandler
 * (design §20.3) — no AI-enabled gate. A module factory may be injected for
 * tests; the default builds the production composition.
 */
export function registerLocalAiRuntimeIpcHandlers(
  getWindow: () => BrowserWindow | null,
  moduleFactory?: (getWindow: () => BrowserWindow | null) => ModuleType
): void {
  let moduleCache: ModuleType | null = null;
  const getModule = (): ModuleType => {
    if (!moduleCache) {
      moduleCache = moduleFactory
        ? moduleFactory(getWindow)
        : createLocalAiRuntimeModule(getWindow);
    }
    return moduleCache;
  };

  registerValidatedHandler(LOCAL_AI_RUNTIME_LIST, noInputSchema, async () => {
    return getModule().listStatuses();
  });

  registerValidatedHandler(
    LOCAL_AI_RUNTIME_STATUS,
    runtimeStatusInputSchema,
    async (input) => {
      return getModule().getStatus(input.runtimeId);
    }
  );

  registerValidatedHandler(
    LOCAL_AI_RUNTIME_PREPARE_INSTALL,
    runtimePrepareInstallInputSchema,
    async (input) => getModule().prepareInstall(input.runtimeId)
  );

  registerValidatedHandler(
    LOCAL_AI_RUNTIME_INSTALL,
    runtimeInstallInputSchema,
    async (input) => {
      return getModule().install(input);
    }
  );

  registerValidatedHandler(
    LOCAL_AI_RUNTIME_CANCEL_INSTALL,
    runtimeCancelInputSchema,
    async (input) => {
      return { cancelled: getModule().cancelInstall(input.operationId) };
    }
  );

  registerValidatedHandler(
    LOCAL_AI_RUNTIME_CHECK_UPDATE,
    runtimeCheckUpdateInputSchema,
    async (input) => {
      return getModule().checkForUpdate(input.runtimeId);
    }
  );

  registerValidatedHandler(
    LOCAL_AI_RUNTIME_REPAIR,
    runtimeStatusInputSchema,
    async (input) => {
      return getModule().repair(input.runtimeId);
    }
  );

  registerValidatedHandler(
    LOCAL_AI_RUNTIME_REMOVE,
    runtimeRemoveInputSchema,
    async (input) => {
      await getModule().remove({
        runtimeId: input.runtimeId,
        removeModels: input.removeModels ?? false,
      });
      return { removed: true };
    }
  );
}
