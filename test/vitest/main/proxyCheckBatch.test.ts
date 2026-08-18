import { describe, it, expect, vi } from "vitest";
import { ProxyController } from "@/controller/proxy-controller";
import type { ProxyCheckres } from "@/entityTypes/proxyType";

interface InternalProxyApi {
  getProxyDetail: (id: number) => Promise<{
    status: boolean;
    code?: number;
    msg?: string;
    data?: { id: number; host: string; port: string; protocol: string };
  }>;
  getProxiesByIds: (
    ids: number[]
  ) => Promise<
    Array<{ id: number; host: string; port: string; protocol: string }>
  >;
}

interface InternalProxyCheckDb {
  updateProxyCheck: (id: number, status: number) => Promise<void>;
  updateGooglePassStatus: (id: number, status: number | null) => Promise<void>;
}

function makeControllerWith(overrides: {
  proxyApi?: Partial<InternalProxyApi>;
  checkProxy?: (
    proxy: { host: string },
    timeout?: number
  ) => Promise<ProxyCheckres>;
  checkGooglePass?: (
    proxy: { host: string },
    timeout?: number
  ) => Promise<boolean>;
}): ProxyController {
  const controller = new ProxyController();
  const internals = controller as unknown as {
    proxyapi: InternalProxyApi;
    proxyCheckdb: InternalProxyCheckDb;
  };
  internals.proxyapi = {
    getProxyDetail:
      overrides.proxyApi?.getProxyDetail ??
      (async (id) => ({
        status: true,
        code: 200,
        msg: "ok",
        data: { id, host: `h-${id}`, port: "8080", protocol: "http" },
      })),
    getProxiesByIds:
      overrides.proxyApi?.getProxiesByIds ??
      (async (ids: number[]) =>
        ids.map((id) => ({
          id,
          host: `h-${id}`,
          port: "8080",
          protocol: "http",
        }))),
  };
  internals.proxyCheckdb = {
    updateProxyCheck: vi.fn(async () => undefined),
    updateGooglePassStatus: vi.fn(async () => undefined),
  };
  if (overrides.checkProxy) {
    controller.checkProxy = overrides.checkProxy;
  }
  if (overrides.checkGooglePass) {
    controller.checkGooglePass = overrides.checkGooglePass;
  }
  return controller;
}

describe("ProxyController.checkProxyBatch", () => {
  it("awaits all checks before returning and emits progress per proxy", async () => {
    const order: number[] = [];
    const checkProxy = vi.fn(async (proxy: { host: string }) => {
      order.push(Number(proxy.host.split("-")[1]));
      return { status: true, msg: "", data: true } as ProxyCheckres;
    });
    const checkGooglePass = vi.fn(async () => true);
    const controller = makeControllerWith({ checkProxy, checkGooglePass });

    const progress: number[] = [];
    const result = await controller.checkProxyBatch({
      proxyIds: [1, 2, 3],
      mode: "both",
      timeoutMs: 1000,
      concurrency: 2,
      onProgress: (p) => progress.push(p.proxyId),
    });

    expect(result.total).toBe(3);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.basic === "pass")).toBe(true);
    expect(result.results.every((r) => r.googlePass === "pass")).toBe(true);
    expect(progress).toHaveLength(3);
    expect(checkGooglePass).toHaveBeenCalledTimes(3);
  });

  it("continues after one proxy fails and records its failure", async () => {
    const checkProxy = vi.fn(async (proxy: { host: string }) => {
      const id = Number(proxy.host.split("-")[1]);
      if (id === 2) {
        throw new Error("boom");
      }
      return { status: true, msg: "", data: true } as ProxyCheckres;
    });
    const checkGooglePass = vi.fn(async () => true);
    const controller = makeControllerWith({ checkProxy, checkGooglePass });

    const result = await controller.checkProxyBatch({
      proxyIds: [1, 2, 3],
      mode: "both",
      timeoutMs: 1000,
      concurrency: 3,
    });

    expect(result.results).toHaveLength(3);
    const failed = result.results.find((r) => r.proxyId === 2);
    expect(failed?.basic).toBe("failure");
    expect(failed?.error).toContain("boom");
    // The failing proxy must not have triggered a Google check.
    expect(checkGooglePass).toHaveBeenCalledTimes(2);
  });

  it("does not run Google checks in basic mode", async () => {
    const checkGooglePass = vi.fn(async () => true);
    const controller = makeControllerWith({
      checkProxy: vi.fn(async () => ({ status: true, msg: "", data: true })),
      checkGooglePass,
    });

    const result = await controller.checkProxyBatch({
      proxyIds: [1, 2],
      mode: "basic",
      timeoutMs: 1000,
      concurrency: 2,
    });

    expect(checkGooglePass).not.toHaveBeenCalled();
    expect(result.results.every((r) => r.googlePass === undefined)).toBe(true);
  });

  it("records a setup error for a proxy missing protocol", async () => {
    const controller = makeControllerWith({
      proxyApi: {
        getProxiesByIds: async (ids) =>
          ids.map((id) => ({ id, host: "h", port: "80", protocol: "" })),
      },
      checkProxy: vi.fn(async () => ({ status: true, msg: "", data: true })),
    });

    const result = await controller.checkProxyBatch({
      proxyIds: [5],
      mode: "basic",
      timeoutMs: 1000,
      concurrency: 1,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].error).toBeDefined();
  });
});
