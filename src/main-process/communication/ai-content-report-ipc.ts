import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { createAIContentReportSchema } from "@/schemas/ipc/aiContentReport";
import { AIContentReportService } from "@/service/AIContentReportService";
import { AI_CONTENT_REPORT_CREATE } from "@/config/channellist";

/**
 * Register the AI-content-report IPC handler.
 *
 * CRITICAL (PRD FR-4.4, §14.9): this uses `registerValidatedHandler`, NOT
 * `registerAiValidatedHandler`. Reporting is a safety/support function and
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
 * The handler never touches TypeORM / desktop SQLite (PRD §5.6, §13.2) and
 * never exposes raw auth tokens to the renderer (PRD FR-4.6).
 */
export function registerAIContentReportIpcHandlers(): void {
  registerValidatedHandler(
    AI_CONTENT_REPORT_CREATE,
    createAIContentReportSchema,
    async (input) => {
      const service = new AIContentReportService();
      return service.submitReport(input);
    }
  );
}
