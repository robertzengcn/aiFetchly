/**
 * PluginHttpDownloadService — the ONE bounded HTTPS transport shared by
 * GitHub archive/asset and generic ZIP acquisition (git-free GitHub plugin
 * installation design §8).
 *
 * Guarantees:
 *   - HTTPS only, certificate verification on, no credentials in v1;
 *   - caller-supplied redirect policy on every hop (never arbitrary hosts),
 *     plus baseline rules: no userinfo, no non-default port, no loops,
 *     at most `maxRedirects` hops, Location resolved with URL semantics;
 *   - sensitive headers (authorization/cookie/proxy-authorization) are
 *     dropped whenever the origin changes (future-auth safety, §8.5);
 *   - one overall deadline across the whole redirect chain + stream;
 *   - streamed downloads: `Content-Length` rejected BEFORE writing when
 *     trustworthy + over-limit, received bytes counted and aborted above
 *     maxBytes even without Content-Length, written to an exclusive
 *     `<dest>.part` renamed only after a complete response;
 *   - every failure/cancel path destroys streams and removes the partial
 *     file; one idempotent completion guard so racing events settle once.
 *
 * The constructor accepts a request-function seam so unit tests inject
 * doubles without touching the network.
 */

import * as fs from "fs";
import * as https from "https";
import * as path from "path";

export interface PluginHttpHeaders {
  readonly [name: string]: string;
}

export interface PluginRedirectContext {
  readonly from: URL;
  readonly to: URL;
  readonly redirectCount: number;
}

export type PluginRedirectPolicy = (context: PluginRedirectContext) => boolean;

export interface PluginHttpDownloadRequest {
  readonly url: URL;
  readonly destinationPath: string;
  readonly headers: PluginHttpHeaders;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly redirectPolicy: PluginRedirectPolicy;
  readonly signal?: AbortSignal;
  readonly onProgress?: (receivedBytes: number, totalBytes?: number) => void;
}

export interface PluginHttpBufferRequest {
  readonly url: URL;
  readonly headers: PluginHttpHeaders;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly redirectPolicy: PluginRedirectPolicy;
  readonly signal?: AbortSignal;
}

export type PluginHttpFailureReason =
  | "aborted"
  | "timeout"
  | "network"
  | "http-status"
  | "too-large"
  | "redirect-missing-location"
  | "redirect-limit"
  | "redirect-loop"
  | "redirect-rejected"
  | "filesystem";

export interface PluginHttpSuccessBase {
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly responseHeaders: Readonly<Record<string, string>>;
}

export type PluginHttpDownloadResult =
  | ({ readonly success: true; readonly bytesWritten: number } & PluginHttpSuccessBase)
  | {
      readonly success: false;
      readonly reason: PluginHttpFailureReason;
      readonly statusCode?: number;
      readonly retryAfterSeconds?: number;
      readonly responseHeaders?: Readonly<Record<string, string>>;
    };

export type PluginHttpBufferResult =
  | ({ readonly success: true; readonly body: Uint8Array } & PluginHttpSuccessBase)
  | {
      readonly success: false;
      readonly reason: PluginHttpFailureReason;
      readonly statusCode?: number;
      readonly retryAfterSeconds?: number;
      readonly responseHeaders?: Readonly<Record<string, string>>;
    };

/** Request-function seam: production uses node https.get. */
export type PluginHttpRequestFunction = (
  url: URL,
  headers: PluginHttpHeaders,
  callback: (res: {
    statusCode?: number;
    headers: Record<string, string | string[] | undefined>;
    onData: (listener: (chunk: Buffer) => void) => void;
    onEnd: (listener: () => void) => void;
    onError: (listener: (e: Error) => void) => void;
    destroy: () => void;
  }) => void
) => { destroy: () => void; onError: (listener: (e: Error) => void) => void };

export const PLUGIN_HTTP_TIMEOUT_MS = 60_000;
export const PLUGIN_HTTP_MAX_REDIRECTS = 5;
export const PLUGIN_GITHUB_METADATA_MAX_BYTES = 1024 * 1024;

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
]);

const sameOrigin = (a: URL, b: URL): boolean =>
  a.protocol === b.protocol && a.host === b.host;

const normalizeHeaders = (
  raw: Record<string, string | string[] | undefined>
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
};

const parseRetryAfter = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 86_400) : undefined;
};

interface RedirectDecision {
  readonly next?: URL;
  readonly failure?: PluginHttpFailureReason;
}

function evaluateRedirect(
  current: URL,
  location: string | undefined,
  seen: ReadonlySet<string>,
  redirectCount: number,
  maxRedirects: number,
  policy: PluginRedirectPolicy
): RedirectDecision {
  if (!location || location.length === 0) {
    return { failure: "redirect-missing-location" };
  }
  if (/[\r\n]/.test(location)) {
    return { failure: "redirect-rejected" };
  }
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    return { failure: "redirect-rejected" };
  }
  if (next.protocol !== "https:") return { failure: "redirect-rejected" };
  if (next.username || next.password) return { failure: "redirect-rejected" };
  if (next.port && next.port !== "443") return { failure: "redirect-rejected" };
  const key = next.toString();
  if (seen.has(key)) return { failure: "redirect-loop" };
  if (redirectCount >= maxRedirects) return { failure: "redirect-limit" };
  if (!policy({ from: current, to: next, redirectCount })) {
    return { failure: "redirect-rejected" };
  }
  return { next };
}

/** Baseline allowlist policy helper: only the listed hosts, HTTPS. */
export function allowlistRedirectPolicy(
  allowedHosts: readonly string[]
): PluginRedirectPolicy {
  const allowed = new Set(allowedHosts);
  return ({ to }) => to.protocol === "https:" && allowed.has(to.host);
}

export class PluginHttpDownloadService {
  constructor(private readonly request: PluginHttpRequestFunction = defaultRequest) {}

  /** Stream a (large) body to destinationPath via an exclusive .part file. */
  downloadToFile(req: PluginHttpDownloadRequest): Promise<PluginHttpDownloadResult> {
    return this.run(req, "file", req.destinationPath) as Promise<PluginHttpDownloadResult>;
  }

  /** Collect a small body (metadata JSON) into a bounded buffer. */
  getBuffer(req: PluginHttpBufferRequest): Promise<PluginHttpBufferResult> {
    return this.run(req, "buffer", "") as Promise<PluginHttpBufferResult>;
  }

  private run(
    req: PluginHttpDownloadRequest | PluginHttpBufferRequest,
    mode: "file" | "buffer",
    destinationPath: string
  ): Promise<PluginHttpDownloadResult | PluginHttpBufferResult> {
    const partPath = mode === "file" ? `${destinationPath}.part` : "";
    return new Promise((resolve) => {
      let settled = false;
      let bytesWritten = 0;
      let fd: number | null = null;
      const chunks: Buffer[] = [];
      const seen = new Set<string>([req.url.toString()]);
      const deadline = setTimeout(() => finish({ reason: "timeout" }), req.timeoutMs);
      const abortListener = (): void => finish({ reason: "aborted" });
      req.signal?.addEventListener("abort", abortListener, { once: true });
      let currentReq: {
        destroy: () => void;
        onError: (listener: (e: Error) => void) => void;
      } | null = null;

      const cleanup = (): void => {
        clearTimeout(deadline);
        req.signal?.removeEventListener("abort", abortListener);
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {
            /* already closed */
          }
          fd = null;
        }
        currentReq?.destroy();
      };

      const finishFailure = (
        reason: PluginHttpFailureReason,
        statusCode?: number,
        responseHeaders?: Record<string, string>,
        retryAfterSeconds?: number
      ): void => {
        cleanup();
        if (partPath) {
          try {
            fs.rmSync(partPath, { force: true });
          } catch {
            /* best-effort */
          }
        }
        resolve({
          success: false,
          reason,
          ...(statusCode !== undefined ? { statusCode } : {}),
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
          ...(responseHeaders ? { responseHeaders } : {}),
        });
      };

      const finish = (outcome: { reason: PluginHttpFailureReason }): void => {
        if (settled) return;
        settled = true;
        finishFailure(outcome.reason);
      };

      const finishSuccess = (
        statusCode: number,
        responseHeaders: Record<string, string>,
        finalUrl: string
      ): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (mode === "buffer") {
          resolve({
            success: true,
            body: Buffer.concat(chunks),
            statusCode,
            responseHeaders,
            finalUrl,
          });
          return;
        }
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {
            /* ignore */
          }
          fd = null;
        }
        try {
          fs.renameSync(partPath, destinationPath);
        } catch (err) {
          finishFailure(
            "filesystem",
            undefined,
            undefined,
            undefined
          );
          void err;
          return;
        }
        resolve({
          success: true,
          bytesWritten,
          statusCode,
          responseHeaders,
          finalUrl,
        });
      };

      const hop = (url: URL, headers: PluginHttpHeaders, redirectCount: number): void => {
        if (settled) return;
        currentReq = this.request(url, headers, (res) => {
          if (settled) {
            res.destroy();
            return;
          }
          const status = res.statusCode ?? 0;
          const responseHeaders = normalizeHeaders(res.headers);
          if (status >= 300 && status < 400) {
            const decision = evaluateRedirect(
              url,
              res.headers.location as string | undefined,
              seen,
              redirectCount,
              req.maxRedirects,
              req.redirectPolicy
            );
            res.destroy();
            if (decision.failure) {
              finishFailure(decision.failure, status, responseHeaders);
              return;
            }
            const next = decision.next!;
            seen.add(next.toString());
            const nextHeaders: PluginHttpHeaders = sameOrigin(url, next)
              ? headers
              : Object.fromEntries(
                  Object.entries(headers).filter(
                    ([name]) => !SENSITIVE_HEADER_NAMES.has(name.toLowerCase())
                  )
                );
            hop(next, nextHeaders, redirectCount + 1);
            return;
          }
          if (status < 200 || status >= 300) {
            res.destroy();
            finishFailure(
              "http-status",
              status,
              responseHeaders,
              parseRetryAfter(responseHeaders["retry-after"])
            );
            return;
          }
          const declaredLength = Number.parseInt(
            responseHeaders["content-length"] ?? "",
            10
          );
          if (Number.isFinite(declaredLength) && declaredLength > req.maxBytes) {
            res.destroy();
            finishFailure("too-large", status, responseHeaders);
            return;
          }
          if (mode === "file") {
            try {
              fd = fs.openSync(partPath, "wx");
            } catch (err) {
              res.destroy();
              void err;
              finishFailure("filesystem");
              return;
            }
          }
          res.onData((chunk) => {
            if (settled || !chunk) return;
            bytesWritten += chunk.length;
            if (bytesWritten > req.maxBytes) {
              finishFailure("too-large", status, responseHeaders);
              return;
            }
            if (mode === "file") {
              try {
                fs.writeSync(fd!, chunk);
              } catch (err) {
                void err;
                finishFailure("filesystem");
                return;
              }
            } else {
              chunks.push(chunk);
            }
            if ("onProgress" in req && req.onProgress) {
              req.onProgress(bytesWritten, Number.isFinite(declaredLength) ? declaredLength : undefined);
            }
          });
          res.onEnd(() => {
            if (settled) return;
            finishSuccess(status, responseHeaders, url.toString());
          });
          res.onError((e) => {
            void e;
            if (!settled) finishFailure("network");
          });
        });
        currentReq.onError((e) => {
          void e;
          if (!settled) finishFailure("network");
        });
      };

      if (req.signal?.aborted) {
        finish({ reason: "aborted" });
        return;
      }
      hop(req.url, req.headers, 0);
    });
  }
}

function defaultRequest(
  url: URL,
  headers: PluginHttpHeaders,
  callback: Parameters<PluginHttpRequestFunction>[2]
): ReturnType<PluginHttpRequestFunction> {
  return https.get(
    url,
    {
      headers: { ...headers, "accept-encoding": "identity" },
    },
    (res) => {
      callback({
        statusCode: res.statusCode,
        headers: res.headers as Record<string, string | string[] | undefined>,
        onData: (listener) => {
          res.on("data", (chunk: Buffer) => listener(chunk));
        },
        onEnd: (listener) => {
          res.on("end", listener);
        },
        onError: (listener) => {
          res.on("error", listener);
        },
        destroy: () => res.destroy(),
      });
    }
  ) as unknown as ReturnType<PluginHttpRequestFunction>;
}

/** Convenience: unique temp file path next to a prefix dir (design §10.4). */
export function tempFilePath(dir: string, name: string): string {
  return path.join(
    dir,
    `${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}
