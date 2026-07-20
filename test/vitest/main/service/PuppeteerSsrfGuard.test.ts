"use strict";
import { describe, test, expect, vi } from "vitest";

// Mock dns so the DNS-rebinding path is deterministic and offline.
vi.mock("dns", () => ({
  promises: {
    lookup: async (host: string) => {
      if (host === "rebind.example")
        return [{ address: "127.0.0.1", family: 4 }];
      if (host === "internal.example")
        return [{ address: "10.0.0.5", family: 4 }];
      if (host === "metadata.example")
        return [{ address: "169.254.169.254", family: 4 }];
      if (host === "good.example")
        return [{ address: "93.184.216.34", family: 4 }];
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    },
  },
}));

import { applySsrfNavigationGuard } from "@/service/PuppeteerSsrfGuard";
import type { Page, HTTPRequest } from "puppeteer";

interface FakeRequest {
  readonly _url: string;
  readonly _resourceType: string;
  aborted: string | null;
  continued: boolean;
}

function makeFakeRequest(
  url: string,
  resourceType = "document"
): FakeRequest & HTTPRequest {
  // State and methods live on the same object so handler mutations
  // (abort/continue) are visible to the test assertions.
  const req = {
    _url: url,
    _resourceType: resourceType,
    aborted: null as string | null,
    continued: false,
    url() {
      return req._url;
    },
    resourceType() {
      return req._resourceType as ReturnType<HTTPRequest["resourceType"]>;
    },
    abort(error?: string) {
      req.aborted = error ?? "failed";
    },
    continue() {
      req.continued = true;
    },
  };
  return req as unknown as FakeRequest & HTTPRequest;
}

async function makePage(): Promise<{
  page: Page;
  dispatch: (req: FakeRequest & HTTPRequest) => Promise<void>;
}> {
  let handler: ((req: HTTPRequest) => Promise<void> | void) | null = null;
  const page = {
    async setRequestInterception(_v: boolean) {
      /* mock */
    },
    on(_event: string, h: (req: HTTPRequest) => Promise<void> | void) {
      handler = h;
    },
  };
  return {
    page: page as unknown as Page,
    dispatch: async (req) => {
      if (handler) await handler(req);
    },
  };
}

async function run(url: string, resourceType?: string) {
  const { page, dispatch } = await makePage();
  await applySsrfNavigationGuard(page);
  const req = makeFakeRequest(url, resourceType);
  await dispatch(req);
  return req;
}

describe("PuppeteerSsrfGuard.applySsrfNavigationGuard", () => {
  test("aborts loopback IP literal", async () => {
    const r = await run("http://127.0.0.1/");
    expect(r.aborted).toBeTruthy();
    expect(r.continued).toBe(false);
  });

  test("aborts localhost hostname", async () => {
    const r = await run("http://localhost/");
    expect(r.aborted).toBeTruthy();
  });

  test("aborts cloud-metadata IP", async () => {
    const r = await run("http://169.254.169.254/latest/meta-data/");
    expect(r.aborted).toBeTruthy();
  });

  test("aborts RFC1918 private range", async () => {
    const r = await run("http://10.0.0.5/");
    expect(r.aborted).toBeTruthy();
  });

  test("aborts 192.168 private range", async () => {
    const r = await run("http://192.168.1.1/admin");
    expect(r.aborted).toBeTruthy();
  });

  test("aborts disallowed scheme (file://)", async () => {
    const r = await run("file:///etc/passwd");
    expect(r.aborted).toBeTruthy();
  });

  test("aborts DNS-rebinding host that resolves to loopback", async () => {
    const r = await run("http://rebind.example/");
    expect(r.aborted).toBeTruthy();
  });

  test("aborts host resolving to RFC1918 range", async () => {
    const r = await run("http://internal.example/");
    expect(r.aborted).toBeTruthy();
  });

  test("aborts host resolving to cloud-metadata range", async () => {
    const r = await run("http://metadata.example/");
    expect(r.aborted).toBeTruthy();
  });

  test("continues a public host that resolves to a public IP", async () => {
    const r = await run("http://good.example/");
    expect(r.continued).toBe(true);
    expect(r.aborted).toBeNull();
  });

  test("continues a public IP literal (not in a blocked range)", async () => {
    const r = await run("http://1.1.1.1/");
    expect(r.continued).toBe(true);
  });

  test("blockResourceTypes aborts matching resource types before DNS", async () => {
    const { page, dispatch } = await makePage();
    await applySsrfNavigationGuard(page, {
      blockResourceTypes: ["stylesheet", "font", "media"],
    });
    const req = makeFakeRequest("http://good.example/", "stylesheet");
    await dispatch(req);
    expect(req.aborted).toBeTruthy();
    expect(req.continued).toBe(false);
  });

  test("blockResourceTypes still allows non-blocked types", async () => {
    const { page, dispatch } = await makePage();
    await applySsrfNavigationGuard(page, {
      blockResourceTypes: ["stylesheet"],
    });
    const req = makeFakeRequest("http://good.example/", "document");
    await dispatch(req);
    expect(req.continued).toBe(true);
  });
});
