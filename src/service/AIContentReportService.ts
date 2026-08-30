import { app } from "electron";
import { HttpClient } from "@/modules/lib/httpclient";
import { log } from "@/modules/Logger";
import { getOrCreateInstallId } from "@/modules/diagnostics/DiagnosticIdentity";
import { mapReportError } from "@/service/AIContentReportErrorMapper";
import {
  AIContentReportError,
  type AIContentReportCapabilities,
  type AIContentReportContext,
  type CreateAIContentReportRequest,
  type CreateAIContentReportResponse,
  type CreateAIConversationReportRequest,
  type CreateAnyAIContentReportRequest,
} from "@/entityTypes/aiContentReportTypes";
import { aiContentReportCapabilitiesResponseSchema } from "@/schemas/api/aiContentReport";
import { normalizeConversationTexts } from "@/views/components/aiContentReport/conversationReportText";
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
const CAPABILITIES_ENDPOINT = "/api/ai/content-reports/capabilities";
const MAX_TEXT_CHARS = 32000;
const CAPABILITY_TTL_MS = 5 * 60 * 1000; // 5 minutes (design §15.2)

/** Fail-closed default: conversation reporting stays hidden unless the backend
 * explicitly advertises it (design §15.2). */
const FAIL_CLOSED_CAPABILITIES: AIContentReportCapabilities = {
  acceptedSchemaVersions: [1],
  conversationReporting: {
    enabled: false,
    maxAIItems: 10,
    maxUserItems: 10,
    maxTotalItems: 20,
    maxItemTextChars: 8000,
    maxAggregateTextChars: 32000,
    maxImages: 3,
  },
};

interface CapabilityCacheEntry {
  value: AIContentReportCapabilities;
  expiresAt: number;
}

// Module-level: each IPC call constructs a new service instance, so the cache
// must live at module scope to be shared across calls (design §15.2).
let capabilityCache: CapabilityCacheEntry | null = null;

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
  httpClient?: Pick<HttpClient, "postJson" | "get">;
  /** Override the app-version source (tests inject a stub). */
  appVersion?: AppVersionProvider;
  /** Override the stable install id (tests inject a stub). */
  installId?: () => string;
}

export class AIContentReportService {
  private readonly httpClient: Pick<HttpClient, "postJson" | "get">;
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
   * Fetch conversation-reporting capabilities with a 5-minute main-process
   * cache (design §15.2). Fail-closed to `enabled: false` on network error,
   * schema rejection, or a `status:false` envelope — so the v2 UI never
   * appears when the backend cannot accept conversation reports.
   *
   * NOT AI-gated: uses the plain authenticated `HttpClient` and never touches
   * `USER_AI_ENABLED` (PRD FR-4.4). Failed fetches are NOT cached, so a
   * transient outage heals on the next call.
   */
  async getCapabilities(): Promise<AIContentReportCapabilities> {
    if (capabilityCache && capabilityCache.expiresAt > Date.now()) {
      return capabilityCache.value;
    }
    try {
      const raw = await this.httpClient.get<unknown>(CAPABILITIES_ENDPOINT);
      const parsed = aiContentReportCapabilitiesResponseSchema().safeParse(raw);
      if (!parsed.success || parsed.data.status !== true) {
        log.warn("[ai-content-report] capability response rejected");
        return FAIL_CLOSED_CAPABILITIES;
      }
      const value = parsed.data.data;
      capabilityCache = {
        value,
        expiresAt: Date.now() + CAPABILITY_TTL_MS,
      };
      return value;
    } catch (err) {
      log.warn("[ai-content-report] capability fetch failed", {
        code: mapReportError(err),
      });
      return FAIL_CLOSED_CAPABILITIES;
    }
  }

  /**
   * Dispatch on schemaVersion. v1 → single-output path; v2 → conversation
   * path. Both share HTTP, error mapping, and metadata-only logging.
   */
  async submitReport(
    request: CreateAnyAIContentReportRequest
  ): Promise<CreateAIContentReportResponse> {
    return request.schemaVersion === 2
      ? this.submitVersion2(request)
      : this.submitVersion1(request);
  }

  /**
   * Submit a version-1 (single-output) report. Throws `AIContentReportError`
   * (with a safe code) on any failure; the IPC handler wraps it and the
   * dialog maps the code to a localized message.
   *
   * Server-side normalization (authoritative, PRD FR-3.1/3.2):
   *  - text is truncated to 32000 chars preserving head+tail
   *  - context.appVersion/platform/installId are filled from main-process
   *    sources (the renderer cannot know these reliably)
   * The renderer's placeholder values are overwritten here.
   */
  private async submitVersion1(
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
      this.emitAnalyticsEvent("ai_content_report_failed", {
        surface,
        appVersion: normalizedContext.appVersion,
        code,
      });
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
      this.emitAnalyticsEvent("ai_content_report_failed", {
        surface,
        appVersion: normalizedContext.appVersion,
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

    this.emitAnalyticsEvent("ai_content_report_submitted", {
      surface,
      contentType: request.contentType,
      category,
      appVersion: normalizedContext.appVersion,
      durationBucket: durationBucket(Date.now() - startedAt),
    });

    return data;
  }

  /**
   * Submit a version-2 (conversation) report. Defense in depth: re-normalize
   * item texts with the same pure utility the renderer used, then assemble
   * the v2 context from main-process sources. The renderer's placeholder
   * values are overwritten here (design §8, §15).
   *
   * Logging is metadata-only: `clientReportId`, `reportId`, surface,
   * category, HTTP status, duration. Never item text, comments, image bytes,
   * conversation content, or identifiers.
   */
  private async submitVersion2(
    request: CreateAIConversationReportRequest
  ): Promise<CreateAIContentReportResponse> {
    const startedAt = Date.now();
    const { clientReportId, surface, category } = request;

    const normalizedItems = this.normalizeConversationItems(request.items);
    const normalizedContext = this.assembleVersion2Context(request.context);
    const normalizedRequest: CreateAIConversationReportRequest = {
      ...request,
      items: normalizedItems,
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
      httpStatus = extractStatus(err);
      log.info("[ai-content-report] submit failed", {
        clientReportId,
        surface,
        category,
        httpStatus,
        durationMs: Date.now() - startedAt,
        code,
        schemaVersion: 2,
      });
      this.emitAnalyticsEvent("ai_content_report_failed", {
        surface,
        appVersion: normalizedContext.appVersion,
        code,
      });
      throw new AIContentReportError(code, code);
    }

    const data = raw?.data;
    if (!raw?.status || !data || !data.reportId) {
      const code = mapReportError({ status: httpStatus });
      log.info("[ai-content-report] submit rejected by server", {
        clientReportId,
        surface,
        category,
        httpStatus,
        durationMs: Date.now() - startedAt,
        code,
        schemaVersion: 2,
      });
      this.emitAnalyticsEvent("ai_content_report_failed", {
        surface,
        appVersion: normalizedContext.appVersion,
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
      schemaVersion: 2,
    });
    this.emitAnalyticsEvent("ai_content_report_submitted", {
      surface,
      category,
      appVersion: normalizedContext.appVersion,
      durationBucket: durationBucket(Date.now() - startedAt),
    });
    return data;
  }

  /**
   * Re-normalize v2 item texts (defense in depth — the renderer already
   * normalized, but the service is the last boundary before HTTP). Image-only
   * and `evidenceUnavailable` items have no text and pass through unchanged.
   */
  private normalizeConversationItems(
    items: CreateAIConversationReportRequest["items"]
  ): CreateAIConversationReportRequest["items"] {
    const inputs = items.map((item) => ({
      itemId: item.itemId,
      text: item.text ?? "",
    }));
    const normalized = normalizeConversationTexts(inputs);
    const byId = new Map(normalized.texts.map((text) => [text.itemId, text]));
    return items.map((item) => {
      if (!item.text) return item;
      const text = byId.get(item.itemId);
      if (!text) return item;
      return {
        ...item,
        text: text.text,
        textTruncated: text.truncated || undefined,
      };
    });
  }

  /**
   * Assemble the v2 context: overwrite appVersion/platform/installId from
   * main-process sources; preserve the renderer-supplied conversationId,
   * counts, aggregateTextTruncated, and locale.
   */
  private assembleVersion2Context(
    partial: CreateAIConversationReportRequest["context"]
  ): CreateAIConversationReportRequest["context"] {
    return {
      ...partial,
      appVersion: this.appVersion(),
      platform: process.platform as "win32" | "darwin" | "linux",
      installId: this.installId(),
    };
  }

  /**
   * Emit an allowed analytics event (PRD §15). Properties are strictly
   * metadata-only — never report text, comments, image bytes, message/
   * conversation identifiers, the report identifier, model prompts, or raw
   * model output. Today this logs at info level; a future analytics sink can
   * subscribe to the `[analytics]` log prefix without changing call sites.
   */
  private emitAnalyticsEvent(
    event: "ai_content_report_submitted" | "ai_content_report_failed",
    props: Record<string, unknown>
  ): void {
    log.info(`[analytics] ${event}`, props);
  }
}

/** Bucket a millisecond duration into a coarse string for analytics (PRD §15). */
function durationBucket(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 5000) return "1-5s";
  if (ms < 30000) return "5-30s";
  return ">30s";
}

/** Best-effort HTTP status extraction from an unknown thrown value. */
function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}
