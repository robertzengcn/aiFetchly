/**
 * Regression for "GitHub archive acquisition failed: currentReq.onError is
 * not a function" (plugin:community:install handler error).
 *
 * The default HTTPS transport must adapt Node's ClientRequest (`.on('error')`,
 * `.destroy()`) to the `{ destroy, onError }` seam `run()` consumes. This
 * drives the REAL default request path with a mocked `https.get` — no
 * network — so a seam-shape regression fails here instead of at install time.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("https", () => ({
  get: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as https from "https";
import {
  PluginHttpDownloadService,
  allowlistRedirectPolicy,
} from "@/service/pluginSources/PluginHttpDownloadService";

const mockedGet = https.get as unknown as {
  mockImplementation: (impl: (...args: unknown[]) => unknown) => void;
  mock: { calls: unknown[][] };
};

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phd-default-"));
});
afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("PluginHttpDownloadService default HTTPS transport", () => {
  it("downloads via https.get without requiring onError on the raw request", async () => {
    const body = Buffer.from("PK-default-transport");
    // Node-like ClientRequest: EventEmitter surface only — deliberately NO
    // `.onError` method, matching the real `https.get` return value.
    const fakeReq = {
      on: vi.fn((_event: string, _listener: (e: Error) => void) => undefined),
      destroy: vi.fn(() => undefined),
    };
    mockedGet.mockImplementation(
      (_url: unknown, _opts: unknown, callback?: unknown): unknown => {
        const cb = callback as (res: unknown) => void;
        const resListeners = {
          data: [] as ((chunk: Buffer) => void)[],
          end: [] as (() => void)[],
          error: [] as ((e: Error) => void)[],
        };
        // Defer so run() has assigned currentReq before events fire.
        queueMicrotask(() => {
          cb({
            statusCode: 200,
            headers: { "content-length": String(body.length) },
            on: (event: string, listener: (...args: never[]) => void) => {
              if (event === "data")
                resListeners.data.push(listener as (chunk: Buffer) => void);
              if (event === "end")
                resListeners.end.push(listener as () => void);
              if (event === "error")
                resListeners.error.push(listener as (e: Error) => void);
            },
          });
          // defaultRequest translates res.on(...) into the onData/onEnd
          // adapter surface; the service registers those synchronously
          // inside cb(), so fire the captured listeners now.
          resListeners.data.forEach((l) => l(body));
          resListeners.end.forEach((l) => l());
        });
        return fakeReq;
      }
    );

    const svc = new PluginHttpDownloadService();
    const dest = path.join(tmp, "default.zip");
    const result = await svc.downloadToFile({
      url: new URL(
        "https://codeload.github.com/owner/repo/zip/refs/heads/main"
      ),
      destinationPath: dest,
      headers: {},
      maxBytes: 1024 * 1024,
      timeoutMs: 5_000,
      maxRedirects: 5,
      redirectPolicy: allowlistRedirectPolicy(["codeload.github.com"]),
    });

    expect(mockedGet.mock.calls).toHaveLength(1);
    // Before the fix this rejects/throws "currentReq.onError is not a
    // function" (surfaced by GitHubPluginFetcher as "GitHub archive
    // acquisition failed: ..."). After the fix it resolves successfully.
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.bytesWritten).toBe(body.length);
    expect(fs.readFileSync(dest).equals(body)).toBe(true);
  });
});
