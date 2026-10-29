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

vi.mock("http", () => ({
  get: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as https from "https";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as http from "http";
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

const E2E_KEY = "AIFETCHLY_E2E";
const ROOT_KEY = "AIFETCHLY_E2E_ROOT";

/** Shared mock-implementation shape: Node-like ClientRequest + deferred res. */
function installServingMock(
  target: { mockImplementation: (impl: (...args: unknown[]) => unknown) => void },
  body: Buffer
): void {
  target.mockImplementation(
    (_url: unknown, _opts: unknown, callback?: unknown): unknown => {
      const resListeners = {
        data: [] as ((chunk: Buffer) => void)[],
        end: [] as (() => void)[],
        error: [] as ((e: Error) => void)[],
      };
      queueMicrotask(() => {
        (callback as (res: unknown) => void)({
          statusCode: 200,
          headers: { "content-length": String(body.length) },
          on: (event: string, listener: (...args: never[]) => void) => {
            if (event === "data") resListeners.data.push(listener as (chunk: Buffer) => void);
            if (event === "end") resListeners.end.push(listener as () => void);
            if (event === "error") resListeners.error.push(listener as (e: Error) => void);
          },
        });
        resListeners.data.forEach((l) => l(body));
        resListeners.end.forEach((l) => l());
      });
      return {
        on: vi.fn((_event: string, _listener: (e: Error) => void) => undefined),
        destroy: vi.fn(() => undefined),
      };
    }
  );
}

describe("PluginHttpDownloadService default transport E2E loopback exception", () => {
  const originalE2E = process.env[E2E_KEY];
  const originalRoot = process.env[ROOT_KEY];

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (originalE2E === undefined) delete process.env[E2E_KEY];
    else process.env[E2E_KEY] = originalE2E;
    if (originalRoot === undefined) delete process.env[ROOT_KEY];
    else process.env[ROOT_KEY] = originalRoot;
  });

  it("fetches the launcher-gated loopback http zip URL over the http transport", async () => {
    process.env[E2E_KEY] = "1";
    process.env[ROOT_KEY] = "/tmp/aifetchly-e2e/worker";
    const body = Buffer.from("PK-loopback-e2e");
    installServingMock(http.get as unknown as Parameters<typeof installServingMock>[0], body);

    const svc = new PluginHttpDownloadService();
    const dest = path.join(tmp, "loopback.zip");
    const result = await svc.downloadToFile({
      url: new URL("http://127.0.0.1:3999/zips/fixture.zip"),
      destinationPath: dest,
      headers: {},
      maxBytes: 1024 * 1024,
      timeoutMs: 5_000,
      maxRedirects: 5,
      redirectPolicy: () => false,
    });

    expect((http.get as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1);
    expect(mockedGet.mock.calls).toHaveLength(0);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.bytesWritten).toBe(body.length);
    expect(fs.readFileSync(dest).equals(body)).toBe(true);
  });

  it("keeps plain http targets on the https transport without the E2E gate", async () => {
    delete process.env[E2E_KEY];
    process.env[ROOT_KEY] = "/tmp/aifetchly-e2e/worker";
    installServingMock(
      mockedGet as unknown as Parameters<typeof installServingMock>[0],
      Buffer.from("ignored")
    );

    const svc = new PluginHttpDownloadService();
    const dest = path.join(tmp, "reject.zip");
    await svc.downloadToFile({
      url: new URL("http://127.0.0.1:3999/zips/fixture.zip"),
      destinationPath: dest,
      headers: {},
      maxBytes: 1024 * 1024,
      timeoutMs: 5_000,
      maxRedirects: 5,
      redirectPolicy: () => false,
    });

    // Production invariant: the http URL is handed to the https transport,
    // which throws TypeError: Protocol "http:" not supported — the same
    // failure surface as before the E2E exception existed.
    expect((http.get as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(0);
    expect(mockedGet.mock.calls).toHaveLength(1);
    expect((mockedGet.mock.calls[0][0] as URL).protocol).toBe("http:");
  });
});
