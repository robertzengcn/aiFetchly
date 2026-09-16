import { log } from "@/modules/Logger";
import type { ShutdownParticipant } from "@/main-process/lifecycle/ShutdownCoordinator";
import type { ShutdownReport } from "@/main-process/lifecycle/ShutdownCoordinator";

/**
 * ShutdownParticipants — composition of the existing cleanup owners into
 * coordinator participants (technical design §3, §6; inventory §2).
 *
 * Principles (design §3 "ShutdownParticipants"):
 *  - Compose EXISTING owners; do not instantiate unused services at
 *    shutdown. Owner modules are imported dynamically inside stop()/
 *    finalize() so early-startup shutdowns (single-instance loser, empty
 *    participant set — §12) never construct services, and unit tests can
 *    mock each owner independently.
 *  - freeze() is synchronous: the global spawn gate (bound to the
 *    lifecycle service) already blocks new spawns; participants additionally
 *    stop accepting dispatch here where an owner exposes a sync pause.
 *
 * v1 inventory coverage (design §2 families):
 *  - tool jobs (ToolJobRegistry.shutdown)
 *  - managed browsers (ManagedBrowserSupervisor.shutdownAll + cache
 *    clear-on-exit + maintenance scheduler stop)
 *  - contact extraction worker (registry-tracked, kill + observed exit)
 *  - schedulers (ScheduleManager.handleAppShutdown + Chat V2 scheduler)
 *  - marketing WebSocket + token auto-refresh
 *  - workspace watcher (graceful command, 2s wait, SIGKILL)
 *  - Yellow Pages process manager (terminateAllProcesses)
 *  - diagnostics retention, dev browser bridge, pending desktop auth,
 *    log cleanup, startup marker (finalize, design §11)
 * Remaining families (MCP stdio servers, shell/hook descendants, skill/
 * python/embedding/voice workers, installers/downloads) rely on the
 * owned-process registry + force phase until per-family graceful adapters
 * are added — documented in docs/prd/application-exit-and-system-tray-*.md.
 */

/** Callbacks for resources owned by background.ts module scope. */
export interface BackgroundShutdownDeps {
  /** Stop the Chat V2 interval scheduler singleton (background.ts owns it). */
  readonly stopChatScheduler: () => Promise<void>;
  /** Stop the dev browser bridge if it started (no-op in production). */
  readonly stopDevBrowserBridge: () => Promise<void>;
  /** Stop the diagnostics retention timer (sync). */
  readonly stopDiagnosticsRetention: () => void;
  /** Clear any in-flight desktop-auth handoff. */
  readonly clearPendingDesktopAuth: () => void;
  /** Stop periodic log cleanup. */
  readonly stopLogCleanup: () => void;
  /**
   * Remove the clean-startup marker AFTER the cleanup outcome is known
   * (design §11 — moved away from the beginning of before-quit). Any
   * coordinated exit is NOT a crash, so the marker comes off regardless;
   * the persisted report distinguishes clean from forced for the next
   * launch (AC-15).
   */
  readonly clearStartupMarker: () => void;
  /** Persist the privacy-safe shutdown report (FR-09). */
  readonly writeShutdownReport: (report: ShutdownReport) => void;
  /** True once a user database path exists (guards scheduler shutdown). */
  readonly hasUserData: () => boolean;
}

/** Budget-aware graceful browser supervision budget (ms cap). */
const MANAGED_BROWSER_BUDGET_CAP_MS = 5_000;
/** How long to wait for observed contact-worker exit in the graceful phase. */
const CONTACT_WORKER_OBSERVE_MS = 2_000;

export function createShutdownParticipants(
  deps: BackgroundShutdownDeps
): ShutdownParticipant[] {
  const toolJobs: ShutdownParticipant = {
    id: "tool-jobs",
    freeze: () => {
      // Dispatch freeze happens via the spawn gate + job-registry gate.
    },
    stop: async () => {
      const { getDefaultToolJobRegistry } = await import(
        "@/service/ToolJobRegistry"
      );
      getDefaultToolJobRegistry().shutdown();
    },
    finalize: async () => undefined,
  };

  const managedBrowsers: ShutdownParticipant = {
    id: "managed-browsers",
    freeze: () => undefined,
    stop: async (context) => {
      const { getDefaultManagedBrowserSupervisor } = await import(
        "@/service/ManagedBrowserSupervisor"
      );
      const { getDefaultManagedBrowserCacheMaintenanceScheduler } =
        await import("@/service/ManagedBrowserCacheMaintenanceScheduler");
      getDefaultManagedBrowserCacheMaintenanceScheduler().stop();
      const supervisor = getDefaultManagedBrowserSupervisor();
      if (supervisor.listSessions().length > 0) {
        await supervisor.shutdownAll(
          Math.min(MANAGED_BROWSER_BUDGET_CAP_MS, context.remainingMs())
        );
        log.info("Managed browser supervisor shutdown completed");
      }
    },
    finalize: async () => {
      // Clear-on-exit preference (FR-CACHE-014) runs AFTER sessions stopped.
      const { ManagedBrowserSettingsModule } = await import(
        "@/modules/ManagedBrowserSettingsModule"
      );
      const { getDefaultManagedBrowserCacheModule } = await import(
        "@/modules/ManagedBrowserCacheModule"
      );
      const settings = await new ManagedBrowserSettingsModule().getEffectiveSettings();
      if (settings.clearCacheOnExit) {
        await getDefaultManagedBrowserCacheModule().queueAllForShutdown();
      }
    },
  };

  const contactExtraction: ShutdownParticipant = {
    id: "contact-extraction",
    freeze: () => undefined,
    stop: async (context) => {
      const { cleanupContactExtractionWorker } = await import(
        "@/main-process/communication/contactExtraction-ipc"
      );
      // Send the termination signal and wait for OBSERVED exit within a
      // bounded slice; survivors are force-verified in the force phase.
      const budget = Math.min(
        CONTACT_WORKER_OBSERVE_MS,
        Math.max(0, context.remainingMs())
      );
      await cleanupContactExtractionWorker(budget);
    },
    finalize: async () => undefined,
  };

  const schedulers: ShutdownParticipant = {
    id: "schedulers",
    freeze: () => undefined,
    stop: async () => {
      // Token auto-refresh timer stops first so no refresh races shutdown.
      const { TokenRefreshService } = await import("@/modules/tokenRefresh");
      TokenRefreshService.stopAutoRefresh();
      if (!deps.hasUserData()) return;
      const { ScheduleManager } = await import("@/modules/ScheduleManager");
      await ScheduleManager.getInstance().handleAppShutdown();
      await deps.stopChatScheduler();
      log.info("Schedulers shutdown completed");
    },
    finalize: async () => undefined,
  };

  const marketingWebSocket: ShutdownParticipant = {
    id: "marketing-websocket",
    freeze: () => undefined,
    stop: async () => {
      const { cleanupWebSocketConnection } = await import(
        "@/main-process/communication/websocket-ipc"
      );
      cleanupWebSocketConnection();
      log.info("WebSocket connection cleanup completed");
    },
    finalize: async () => undefined,
  };

  const workspaceWatch: ShutdownParticipant = {
    id: "workspace-watch",
    freeze: () => undefined,
    stop: async () => {
      const { getWorkspaceWatchManager } = await import(
        "@/service/workspaceWatch/WorkspaceWatchManagerSingleton"
      );
      const watcherManager = getWorkspaceWatchManager();
      if (watcherManager) {
        await watcherManager.shutdown();
        log.info("WorkspaceWatchManager shutdown completed");
      }
    },
    finalize: async () => undefined,
  };

  const yellowPages: ShutdownParticipant = {
    id: "yellow-pages",
    freeze: () => undefined,
    stop: async () => {
      const { YellowPagesProcessManager } = await import(
        "@/modules/YellowPagesProcessManager"
      );
      await YellowPagesProcessManager.getInstance().terminateAllProcesses();
      log.info("Yellow Pages processes terminated");
    },
    finalize: async () => undefined,
  };

  const appResources: ShutdownParticipant = {
    id: "app-resources",
    freeze: () => undefined,
    stop: async () => {
      // Dev bridge stop is async but must not wait on dead sockets.
      await deps.stopDevBrowserBridge();
    },
    finalize: async () => {
      // Final housekeeping only AFTER cleanup outcome is known (§11):
      // pending auth, retention timer, log cleanup, startup marker.
      deps.clearPendingDesktopAuth();
      deps.stopDiagnosticsRetention();
      deps.stopLogCleanup();
    },
  };

  return [
    toolJobs,
    managedBrowsers,
    contactExtraction,
    schedulers,
    marketingWebSocket,
    workspaceWatch,
    yellowPages,
    appResources,
  ];
}

/**
 * Report-aware wrapper: attach the clean-shutdown marker decision to the
 * coordinator's report. background.ts registers this via onReport.
 */
export function reportSinkAdapter(
  deps: BackgroundShutdownDeps
): (report: ShutdownReport) => void {
  return (report) => {
    try {
      deps.writeShutdownReport(report);
      // Marker removal only on a verified clean shutdown; forced/incomplete
      // exits keep the marker so the next launch can distinguish them from
      // a crash without calling them clean (AC-15, design §11).
      deps.clearStartupMarker();
    } catch (err) {
      log.error(
        "[shutdown] report sink failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
  };
}
