import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  createAnyAIContentReportSchema,
  getAIContentReportCapabilitiesSchema,
} from "@/schemas/ipc/aiContentReport";
import { AIContentReportService } from "@/service/AIContentReportService";
import {
  AI_CONTENT_REPORT_CAPABILITIES,
  AI_CONTENT_REPORT_CREATE,
} from "@/config/channellist";

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
  registerValidatedHandler(
    AI_CONTENT_REPORT_CREATE,
    createAnyAIContentReportSchema,
    async (input) => {
      const service = new AIContentReportService();
      return service.submitReport(input);
    }
  );

  registerValidatedHandler(
    AI_CONTENT_REPORT_CAPABILITIES,
    getAIContentReportCapabilitiesSchema,
    async () => {
      const service = new AIContentReportService();
      return service.getCapabilities();
    }
  );
}
