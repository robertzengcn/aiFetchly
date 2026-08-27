import { app } from "electron";
import { HttpClient } from "@/modules/lib/httpclient";
import { log } from "@/modules/Logger";
import { getOrCreateInstallId } from "@/modules/diagnostics/DiagnosticIdentity";
import { mapReportError } from "@/service/AIContentReportErrorMapper";
import {
  AIContentReportError,
  type AIContentReportContext,
  type CreateAIContentReportRequest,
  type CreateAIContentReportResponse,
} from "@/entityTypes/aiContentReportTypes";
import type { CommonApiresp } from "@/entityTypes/commonType";

/**
 * Owns evidence normalization, context assembly, and remote submission for
 * AI-content reports.
 *
 * Design invariants (PRD §13, §14):
 *  - Never touches TypeORM / desktop SQLite. The backend is the sole source
 *    of truth (PRD §5.6, FR-4.7).
 *  - Uses the existing authenticated `HttpClient` (Bearer token via `Token`,
 *    401/403 refresh-retry) — never exposes raw auth tokens to the renderer
 *    (PRD FR-4.5, FR-4.6).
 *  - Logging is metadata-only: `clientReportId`, `reportId`, surface,
 *    category, HTTP status, duration. Never output text, comments, image
 *    bytes, conversation content, or raw user id (PRD §14.4).
 *  - `clientReportId` is generated once by the dialog and reused on retry;
 *    a `duplicate: true` backend response surfaces the original `reportId`
 *    (idempotent, PRD FR-4.8).
 */

const REPORT_ENDPOINT = "/api/ai/content-reports";
const MAX_TEXT_CHARS = 32000;

/** Inject for testability; defaults to the real Electron app. */
export interface AppVersionProvider {
  (): string;
}

function defaultAppVersion(): string {
  try {
    const fn = (app as unknown as { getVersion?: () => string }).getVersion;
    return typeof fn === "function" ? fn.call(app) : "unknown";
  } catch {
    return "unknown";
  }
}

export interface AIContentReportServiceOptions {
  /** Override the HTTP client (tests inject a stub). */
  httpClient?: Pick<HttpClient, "postJson">;
  /** Override the app-version source (tests inject a stub). */
  appVersion?: AppVersionProvider;
  /** Override the stable install id (tests inject a stub). */
  installId?: () => string;
}

export class AIContentReportService {
  private readonly httpClient: Pick<HttpClient, "postJson">;
  private readonly appVersion: AppVersionProvider;
  private readonly installId: () => string;

  constructor(options: AIContentReportServiceOptions = {}) {
    this.httpClient = options.httpClient ?? new HttpClient();
    this.appVersion = options.appVersion ?? defaultAppVersion;
    this.installId = options.installId ?? getOrCreateInstallId;
  }

  /**
   * Fill the context fields the renderer cannot know (appVersion, platform,
   * installId) and clamp the locale. The renderer supplies the rest
   * (conversationId, messageId, artifactId, model, generatedAt, locale).
   *
   * Accepts the full context (the renderer sends placeholders for the three
   * main-process-owned fields); the placeholders are overwritten here.
   */
  assembleContext(partial: AIContentReportContext): AIContentReportContext {
    return {
      ...partial,
      appVersion: this.appVersion(),
      platform: process.platform as "win32" | "darwin" | "linux",
      installId: this.installId(),
    };
  }

  /**
   * Truncate text to 32,000 chars preserving the beginning AND end, setting
   * `textTruncated: true` when truncation occurred (PRD FR-3.2).
   */
  normalizeText(text: string | undefined): {
    text?: string;
    textTruncated?: boolean;
  } {
    if (!text) return {};
    if (text.length <= MAX_TEXT_CHARS) {
      return { text };
    }
    // Preserve the beginning AND end. Budget the marker + tail so the
    // concatenated result never exceeds the limit.
    const marker = "\n…[truncated]…\n";
    const tailLen = 28;
    const headLen = MAX_TEXT_CHARS - marker.length - tailLen;
    const head = text.slice(0, headLen);
    const tail = text.slice(text.length - tailLen);
    return { text: `${head}${marker}${tail}`, textTruncated: true };
  }

  /**
   * Normalize the output evidence: truncate text to the 32000-char limit
   * (PRD FR-3.2). Image previews are already bounded by the Zod schema and
   * the renderer-side encoder, so they pass through unchanged.
   */
  normalizeOutput(
    output: CreateAIContentReportRequest["output"]
  ): CreateAIContentReportRequest["output"] {
    const normalized: CreateAIContentReportRequest["output"] = { ...output };
    const textResult = this.normalizeText(output.text);
    if (typeof textResult.text === "string") {
      normalized.text = textResult.text;
      normalized.textTruncated = textResult.textTruncated;
    }
    return normalized;
  }

  /**
   * Submit the report to the backend. Throws `AIContentReportError` (with a
   * safe code) on any failure; the IPC handler wraps it and the dialog maps
   * the code to a localized message.
   *
   * Server-side normalization (authoritative, PRD FR-3.1/3.2):
   *  - text is truncated to 32000 chars preserving head+tail
   *  - context.appVersion/platform/installId are filled from main-process
   *    sources (the renderer cannot know these reliably)
   * The renderer's placeholder values are overwritten here.
   */
  async submitReport(
    request: CreateAIContentReportRequest
  ): Promise<CreateAIContentReportResponse> {
    const startedAt = Date.now();
    const { clientReportId, surface, category } = request;

    // Normalize evidence + context server-side (the renderer sends
    // placeholders for appVersion/platform/installId).
    const normalizedOutput = this.normalizeOutput(request.output);
    const normalizedContext = this.assembleContext(request.context);
    const normalizedRequest: CreateAIContentReportRequest = {
      ...request,
      output: normalizedOutput,
      context: normalizedContext,
    };

    let raw: CommonApiresp<CreateAIContentReportResponse> | undefined;
    let httpStatus: number | undefined;
    try {
      raw = await this.httpClient.postJson<
        CommonApiresp<CreateAIContentReportResponse>
      >(REPORT_ENDPOINT, normalizedRequest);
    } catch (err) {
      const code = mapReportError(err);
      const status = extractStatus(err);
      httpStatus = status;
      log.info("[ai-content-report] submit failed", {
        clientReportId,
        surface,
        category,
        httpStatus: status,
        durationMs: Date.now() - startedAt,
        code,
      });
      // The message carries the code so it survives the IPC boundary
      // (registerValidatedHandler extracts err.message into envelope.msg).
      // The dialog reads the code directly to pick the localized message.
      throw new AIContentReportError(code, code);
    }

    const data = raw?.data;
    // The backend wraps responses in CommonApiresp<T>. A `duplicate: true`
    // response still carries the original reportId and is treated as success
    // (PRD FR-4.8).
    if (!raw?.status || !data || !data.reportId) {
      const code = mapReportError({ status: httpStatus });
      log.info("[ai-content-report] submit rejected by server", {
        clientReportId,
        surface,
        category,
        httpStatus,
        durationMs: Date.now() - startedAt,
        code,
      });
      throw new AIContentReportError(code, code);
    }

    log.info("[ai-content-report] submitted", {
      clientReportId,
      reportId: data.reportId,
      surface,
      category,
      httpStatus,
      durationMs: Date.now() - startedAt,
    });

    return data;
  }
}

/** Best-effort HTTP status extraction from an unknown thrown value. */
function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}
