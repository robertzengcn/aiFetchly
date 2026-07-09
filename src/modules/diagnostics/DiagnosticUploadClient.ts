"use strict";
import type { DiagnosticReportPackage } from "./DiagnosticSchemas";
import { projectToWirePayload } from "./CrashReportWireSchema";

/**
 * Minimal HTTP client interface so callers can inject axios, fetch, or a mock.
 * The client only needs a single POST method that returns a status code and
 * parsed body.
 */
export interface HttpClientLike {
  post(
    url: string,
    body: unknown,
    config: { headers: Record<string, string>; timeout: number }
  ): Promise<{ status: number; data: unknown }>;
}

export interface UploadClientConfig {
  endpoint: string;
  http: HttpClientLike;
  /** Optional bearer token added as the Authorization header when set. */
  authToken?: string | null;
  /** Request timeout in milliseconds. Defaults to 15s. */
  timeoutMs?: number;
}

export interface UploadResult {
  reportId: string | null;
  error?: string;
}

/**
 * Posts a DiagnosticReportPackage to the backend crash-reports endpoint.
 *
 * Backend contract:
 *   - 200 + `{ status: true, reportId }` on success.
 *   - 429 when the caller is being rate limited.
 *   - 413 when the payload is too large.
 *
 * All errors are caught and surfaced as {@link UploadResult.error} rather than
 * thrown, so callers can safely `await upload()` without a try/catch.
 */
export class DiagnosticUploadClient {
  constructor(private readonly cfg: UploadClientConfig) {}

  async upload(pkg: DiagnosticReportPackage): Promise<UploadResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.cfg.authToken) {
      headers["Authorization"] = this.cfg.authToken;
    }

    try {
      // Project the rich internal package down to the backend's strict wire
      // contract before posting. The server decodes with
      // DisallowUnknownFields and rejects unknown fields with HTTP 400.
      const wirePayload = projectToWirePayload(pkg);
      const res = await this.cfg.http.post(this.cfg.endpoint, wirePayload, {
        headers,
        timeout: this.cfg.timeoutMs ?? 15_000,
      });
      const body = res.data as
        | { status?: boolean; reportId?: string; msg?: string }
        | undefined;

      if (res.status === 200 && body?.status === true && body.reportId) {
        return { reportId: body.reportId };
      }
      if (res.status === 429) {
        return {
          reportId: null,
          error: `Rate limit exceeded: ${body?.msg ?? "try again later"}`,
        };
      }
      if (res.status === 413) {
        return { reportId: null, error: "Report payload too large." };
      }
      return {
        reportId: null,
        error: body?.msg ?? `Server returned status ${res.status}`,
      };
    } catch (err) {
      return {
        reportId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
