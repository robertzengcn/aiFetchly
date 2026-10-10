/**
 * Shared test helper: an injectable request double for
 * PluginHttpDownloadService so fetcher suites (GitHub archive/asset, URL
 * zip) can drive the REAL transport off-network (git-free GitHub plugin
 * installation design §18.1). Extracted from pluginHttpDownloadService.test.
 */
import type { PluginHttpRequestFunction } from "@/service/pluginSources/PluginHttpDownloadService";

export type PluginHttpResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body?: Buffer;
  errorAfterChunks?: number;
};

export function makeRequestDouble(
  plan: (url: URL, hop: number) => PluginHttpResponse | { redirect: string }
): PluginHttpRequestFunction {
  const hops = new Map<string, number>();
  return (url, _headers, callback) => {
    const hop = (hops.get(url.toString()) ?? 0) + 1;
    hops.set(url.toString(), hop);
    const planned = plan(url, hop);
    const listeners = {
      data: [] as ((chunk: Buffer) => void)[],
      end: [] as (() => void)[],
      error: [] as ((e: Error) => void)[],
    };
    const res = {
      statusCode: "redirect" in planned ? 302 : planned.statusCode,
      headers:
        "redirect" in planned ? { location: planned.redirect } : planned.headers,
      onData: (l: (chunk: Buffer) => void) => {
        listeners.data.push(l);
      },
      onEnd: (l: () => void) => {
        listeners.end.push(l);
      },
      onError: (l: (e: Error) => void) => {
        listeners.error.push(l);
      },
      destroy: () => {
        /* test double */
      },
    };
    callback(res);
    if (!("redirect" in planned)) {
      const body = planned.body ?? Buffer.alloc(0);
      if (body.length > 0) {
        listeners.data.forEach((l) => l(body));
      }
      if (planned.errorAfterChunks !== undefined) {
        listeners.error.forEach((l) => l(new Error("boom")));
      } else {
        listeners.end.forEach((l) => l());
      }
    }
    return {
      destroy: () => {
        /* noop */
      },
      onError: (l) => {
        listeners.error.push(l);
      },
    };
  };
}
