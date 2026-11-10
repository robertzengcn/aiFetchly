import {
  registerValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  createAnyAIContentReportSchema,
  getAIContentReportCapabilitiesSchema,
} from "@/schemas/ipc/aiContentReport";
import { AIContentReportService } from "@/service/AIContentReportService";
import {
  AI_CONTENT_REPORT_CAPABILITIES,
  AI_CONTENT_REPORT_CREATE,
} from "@/config/channellist";
// G01 (design §18): bounded report capability action counters.
import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";

/**
 * Register the AI-content-report IPC handlers (design §13).
 *
 * CRITICAL (PRD FR-4.4, §14.9): BOTH handlers use `registerValidatedHandler`,
 * NOT `registerAiValidatedHandler`. Reporting is a safety/support function and
 * must remain available when `USER_AI_ENABLED !== "true"`, after a
 * subscription expires, or when the selected model is unavailable. It must
 * never consume AI credits or call an AI model.
 *
 * The wrapper:
 *  1. safeParses the renderer payload against the Zod schema (boundary
 *     validation — PRD FR-4.3) and returns status:false without executing
 *     on validation failure.
 *  2. delegates to {@link AIContentReportService} which performs evidence
 *     normalization and the authenticated HTTP POST.
 *  3. wraps the result in the standard `{ status, msg, data }` envelope.
 *
 * The create handler validates against the v1/v2 union (design §12) and the
 * service dispatches on `schemaVersion`. The capabilities handler returns the
 * cached (5-minute TTL) or fail-closed capability envelope.
 *
 * The handlers never touch TypeORM / desktop SQLite (PRD §5.6, §13.2) and
 * never expose raw auth tokens to the renderer (PRD FR-4.6).
 */
export function registerAIContentReportIpcHandlers(): void {
  // G01 (design §18 / PRD §20): reporting dialog opened, submitted, failed,
  // and capability-unavailable counts. Bounded labels only — the payloads
  // are already redacted upstream and never enter counters.

  registerValidatedHandler(
    AI_CONTENT_REPORT_CREATE,
    createAnyAIContentReportSchema,
    async (input) => {
      const service = new AIContentReportService();
      try {
        // G01 (design §18 / PRD §20): report submitted / duplicate counts —
        // the typed response only has enum outcome fields; counters never
        // see report payloads.
        const result = await service.submitReport(input);
        aiChatQueueCounters.recordWorkspaceAction(
          "report",
          "submit",
          result.duplicate ? "duplicate" : "ok"
        );
        return result;
      } catch (err) {
        aiChatQueueCounters.recordWorkspaceAction("report", "submit", "error");
        throw err;
      }
    }
  );

  registerValidatedHandler(
    AI_CONTENT_REPORT_CAPABILITIES,
    getAIContentReportCapabilitiesSchema,
    async () => {
      const service = new AIContentReportService();
      // G01 (design §18 / PRD §20): capability-available vs fail-closed
      // counts (enabled flag only — no payload surfaces into counters).
      const result = await service.getCapabilities();
      aiChatQueueCounters.recordWorkspaceAction(
        "report",
        "capabilities",
        result.conversationReporting.enabled ? "available" : "unavailable"
      );
      return result;
    }
  );
}
