/**
 * Tests for PluginHttpDownloadService (git-free GitHub plugin installation
 * design §18.1): bounded streaming, redirect safety, deadline, abort, and
 * cleanup — all through an injected request double, never the network.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PluginHttpDownloadService,
  allowlistRedirectPolicy,
  type PluginHttpRequestFunction,
} from "@/service/pluginSources/PluginHttpDownloadService";

type Response = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body?: Buffer;
  errorAfterChunks?: number;
};

function makeRequestDouble(
  plan: (url: URL, hop: number) => Response | { redirect: string }
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
      headers: "redirect" in planned ? { location: planned.redirect } : planned.headers,
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

const BASE = {
  headers: {},
  maxBytes: 1024 * 1024,
  timeoutMs: 5_000,
  maxRedirects: 5,
  redirectPolicy: allowlistRedirectPolicy(["a.test", "b.test"]),
};

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phd-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("PluginHttpDownloadService.downloadToFile", () => {
  it("streams a successful body to the destination (no .part residue)", async () => {
    const body = Buffer.from("PK".repeat(64));
    const svc = new PluginHttpDownloadService(
      makeRequestDouble(() => ({
        statusCode: 200,
        headers: { "content-length": String(body.length) },
        body,
      }))
    );
    const dest = path.join(tmp, "a.zip");
    const result = await svc.downloadToFile({ ...BASE, url: new URL("https://a.test/x"), destinationPath: dest });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.bytesWritten).toBe(body.length);
    expect(fs.readFileSync(dest).equals(body)).toBe(true);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it("rejects a declared Content-Length over the limit before writing", async () => {
    const body = Buffer.alloc(2048);
    const svc = new PluginHttpDownloadService(
      makeRequestDouble(() => ({
        statusCode: 200,
        headers: { "content-length": String(body.length) },
        body,
      }))
    );
    const dest = path.join(tmp, "b.zip");
    const result = await svc.downloadToFile({
      ...BASE,
      maxBytes: 1024,
      url: new URL("https://a.test/x"),
      destinationPath: dest,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("too-large");
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it("aborts a chunked body whose accumulated bytes exceed the limit", async () => {
    const svc = new PluginHttpDownloadService(
      makeRequestDouble(() => ({
        statusCode: 200,
        headers: {},
        body: Buffer.alloc(4096),
      }))
    );
    const dest = path.join(tmp, "c.zip");
    const result = await svc.downloadToFile({
      ...BASE,
      maxBytes: 1024,
      url: new URL("https://a.test/x"),
      destinationPath: dest,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("too-large");
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it("follows an allowed HTTPS redirect within the same policy", async () => {
    const body = Buffer.from("ok");
    const svc = new PluginHttpDownloadService(
      makeRequestDouble((url) =>
        url.host === "a.test"
          ? { redirect: "https://b.test/actual" }
          : { statusCode: 200, headers: {}, body }
      )
    );
    const dest = path.join(tmp, "d.zip");
    const result = await svc.downloadToFile({
      ...BASE,
      url: new URL("https://a.test/x"),
      destinationPath: dest,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.finalUrl).toBe("https://b.test/actual");
  });

  it("rejects a redirect to plain HTTP, userinfo, non-default ports, and off-policy hosts", async () => {
    const cases: { redirect: string; reason: string }[] = [
      { redirect: "http://b.test/x", reason: "redirect-rejected" },
      { redirect: "https://user:pw@b.test/x", reason: "redirect-rejected" },
      { redirect: "https://b.test:8443/x", reason: "redirect-rejected" },
      { redirect: "https://evil.test/x", reason: "redirect-rejected" },
      { redirect: "", reason: "redirect-missing-location" },
    ];
    for (const c of cases) {
      const svc = new PluginHttpDownloadService(
        makeRequestDouble(() =>
          c.redirect === "" ? { statusCode: 302, headers: {}, body: Buffer.alloc(0) } : { redirect: c.redirect }
        )
      );
      const result = await svc.downloadToFile({
        ...BASE,
        url: new URL("https://a.test/x"),
        destinationPath: path.join(tmp, "r.zip"),
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe(c.reason);
    }
  });

  it("rejects redirect loops and over-limit chains", async () => {
    const loop = new PluginHttpDownloadService(
      makeRequestDouble((url) => ({ redirect: url.toString() }))
    );
    const r1 = await loop.downloadToFile({
      ...BASE,
      url: new URL("https://a.test/loop"),
      destinationPath: path.join(tmp, "l.zip"),
    });
    expect(r1.success).toBe(false);
    if (!r1.success) expect(r1.reason).toBe("redirect-loop");

    let hop = 0;
    const chain = new PluginHttpDownloadService(
      makeRequestDouble((url) => {
        hop += 1;
        return { redirect: `${url.toString()}-${hop}` };
      })
    );
    const r2 = await chain.downloadToFile({
      ...BASE,
      url: new URL("https://a.test/chain"),
      destinationPath: path.join(tmp, "c2.zip"),
    });
    expect(r2.success).toBe(false);
    if (!r2.success) expect(r2.reason).toBe("redirect-limit");
  });

  it("aborts before the request when the signal is already fired", async () => {
    let called = false;
    const svc = new PluginHttpDownloadService(
      makeRequestDouble(() => {
        called = true;
        return { statusCode: 200, headers: {}, body: Buffer.from("x") };
      })
    );
    const controller = new AbortController();
    controller.abort();
    const result = await svc.downloadToFile({
      ...BASE,
      url: new URL("https://a.test/x"),
      destinationPath: path.join(tmp, "ab.zip"),
      signal: controller.signal,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("aborted");
    expect(called).toBe(false);
  });

  it("maps non-2xx terminal statuses with Retry-After", async () => {
    const svc = new PluginHttpDownloadService(
      makeRequestDouble(() => ({
        statusCode: 429,
        headers: { "retry-after": "42" },
        body: Buffer.alloc(0),
      }))
    );
    const result = await svc.downloadToFile({
      ...BASE,
      url: new URL("https://a.test/x"),
      destinationPath: path.join(tmp, "s.zip"),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("http-status");
    expect(result.statusCode).toBe(429);
    expect(result.retryAfterSeconds).toBe(42);
  });
});

describe("PluginHttpDownloadService.getBuffer", () => {
  it("collects a bounded metadata body", async () => {
    const body = Buffer.from(JSON.stringify({ sha: "a".repeat(40) }));
    const svc = new PluginHttpDownloadService(
      makeRequestDouble(() => ({ statusCode: 200, headers: {}, body }))
    );
    const result = await svc.getBuffer({ ...BASE, url: new URL("https://a.test/commits/x") });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Buffer.from(result.body).toString("utf8")).toContain("sha");
  });

  it("rejects an oversized metadata body", async () => {
    const svc = new PluginHttpDownloadService(
      makeRequestDouble(() => ({ statusCode: 200, headers: {}, body: Buffer.alloc(4096) }))
    );
    const result = await svc.getBuffer({
      ...BASE,
      maxBytes: 1024,
      url: new URL("https://a.test/commits/x"),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("too-large");
  });
});
