import { windowInvoke } from "@/views/utils/apirequest";
import {
  AI_CONTENT_REPORT_CREATE,
  AI_CONTENT_REPORT_CAPABILITIES,
} from "@/config/channellist";
import type {
  AIContentReportCapabilities,
  CreateAIContentReportResponse,
  CreateAnyAIContentReportRequest,
} from "@/entityTypes/aiContentReportTypes";

/**
 * Renderer → main IPC wrapper for AI-content-report submission.
 *
 * Mirrors `src/views/api/dashboard.ts`. `windowInvoke` throws the envelope
 * `msg` when the handler returns `status:false`; the dialog catches and maps
 * the message to a localized error code via the report error mapper.
 *
 * NOT AI-gated: the underlying handler uses `registerValidatedHandler`, so
 * this call remains available when hosted AI is disabled (PRD FR-4.4, §14.9).
 */
export async function createAIContentReport(
  request: CreateAnyAIContentReportRequest
): Promise<CreateAIContentReportResponse> {
  return await windowInvoke(AI_CONTENT_REPORT_CREATE, request);
}

/**
 * Fetch the backend's content-report capabilities (design §14). The dialog
 * gates the "Report conversation" UI on `conversationReporting.enabled`.
 * NOT AI-gated: uses `registerValidatedHandler`, works when AI is disabled.
 */
export async function getAIContentReportCapabilities(): Promise<AIContentReportCapabilities> {
  return await windowInvoke(AI_CONTENT_REPORT_CAPABILITIES, {
    schemaVersion: 1,
  });
}
