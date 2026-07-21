import { describe, it, expect, vi } from "vitest";
import { ProxyAiTools } from "@/service/ProxyAiTools";
import type { IProxyApi } from "@/modules/interface/IProxyApi";
import type { ProxyController } from "@/controller/proxy-controller";
import type {
  ProxyListEntity,
  ProxylistResp,
  ProxyEntity,
  SaveProxyResp,
  ImportProxyResp,
} from "@/entityTypes/proxyType";
import type { CommonApiresp } from "@/entityTypes/commonType";
import type { ProxyCheckItemInternal } from "@/entityTypes/proxyAiToolTypes";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

function makeListRecord(
  over: Partial<ProxyListEntity> & { id: number }
): ProxyListEntity {
  return {
    id: over.id,
    host: over.host ?? `host-${over.id}.example.com`,
    port: over.port ?? "8080",
    username: over.username,
    password: over.password,
    protocol: over.protocol ?? "http",
    country_code: over.country_code,
    addtime: over.addtime ?? "2026-07-19",
    checktime: over.checktime,
    status: over.status,
    googlePass: over.googlePass,
    statusName: over.statusName,
    googlePassName: over.googlePassName,
  };
}

function listResp(
  records: ProxyListEntity[],
  total: number
): ProxylistResp["data"] {
  // Controller unwraps the module envelope and returns bare {total, records}.
  return { total, records };
}

interface MakeToolsOpts {
  readonly proxyModule?: Partial<IProxyApi>;
  readonly proxyController?: Partial<ProxyController>;
}

function makeTools(opts: MakeToolsOpts = {}): ProxyAiTools {
  return new ProxyAiTools({
    proxyModule: opts.proxyModule as IProxyApi | undefined,
    proxyController: opts.proxyController as ProxyController | undefined,
  });
}

describe("ProxyAiTools.listProxies", () => {
  it("returns redacted summaries for the requested page", async () => {
    const getProxylist = vi.fn(async () =>
      listResp(
        [
          makeListRecord({ id: 1, password: "secret-1", username: "u1" }),
          makeListRecord({ id: 2, password: "secret-2" }),
        ],
        2
      )
    );
    const tools = makeTools({ proxyController: { getProxylist } });

    const result = await tools.listProxies({ page: 0, size: 10 });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.proxies).toHaveLength(2);
    expect(result.proxies[0]).toMatchObject({ id: 1, hasPassword: true });
    expect(result.proxies[0]).not.toHaveProperty("password");
    expect(result.proxies[0]).not.toHaveProperty("pass");
    expect(JSON.stringify(result)).not.toContain("secret-1");
    // 0-based page is converted to 1-based for the controller/model layer.
    expect(getProxylist).toHaveBeenCalledWith(1, 10, "");
    expect(result.credentialsRedacted).toBe(true);
  });

  it("filters by status via bounded scan and paginates the filtered set", async () => {
    const records: ProxyListEntity[] = [
      makeListRecord({ id: 1, status: 2, checktime: "2026-07-19" }), // failure
      makeListRecord({ id: 2, status: 1, checktime: "2026-07-19" }), // pass
      makeListRecord({ id: 3, status: 1, checktime: "2026-07-19" }), // pass
      makeListRecord({ id: 4, status: 1 }), // unknown (no checktime)
    ];
    const getProxylist = vi.fn(async (_p: number, size: number) =>
      listResp(records.slice(0, size), records.length)
    );
    const tools = makeTools({ proxyController: { getProxylist } });

    const result = await tools.listProxies({
      status: "failure",
      page: 0,
      size: 10,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.total).toBe(1);
    expect(result.proxies).toHaveLength(1);
    expect(result.proxies[0].id).toBe(1);
    expect(result.proxies[0].status).toBe("failure");
  });

  it("surfaces controller failure as a tool error", async () => {
    const tools = makeTools({
      proxyController: {
        getProxylist: vi.fn(async () => {
          // Controller throws on module error (it unwraps the envelope).
          throw new Error("db locked");
        }),
      },
    });
    const result = await tools.listProxies({});
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("UNSUPPORTED_OPERATION");
  });

  it("surfaces truncated=true when a status-filter scan errors mid-pagination", async () => {
    // Page 1 returns a full page (100) with total=500 so the scan must fetch
    // page 2; page 2 throws, simulating a transient DB error mid-scan. The
    // tool must NOT silently return the partial set as a complete success.
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeListRecord({
        id: i + 1,
        status: i < 3 ? 2 : 1, // 3 failures among 100
        checktime: "2026-07-19",
      })
    );
    const getProxylist = vi.fn(async (page: number) => {
      if (page === 1) {
        return listResp(page1, 500);
      }
      throw new Error("db locked mid-scan");
    });
    const tools = makeTools({ proxyController: { getProxylist } });

    const result = await tools.listProxies({
      status: "failure",
      page: 0,
      size: 10,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(3);
    expect(result.proxies).toHaveLength(3);
  });
});

describe("ProxyAiTools.getProxy", () => {
  it("returns a redacted detail and never echoes pass", async () => {
    const detail: CommonApiresp<ProxyEntity> = {
      status: true,
      code: 200,
      msg: "Success",
      data: {
        id: 54,
        host: "proxy.example.com",
        port: "1080",
        user: "demo",
        pass: "topsecret",
        protocol: "socks5",
        country_code: "US",
      },
    };
    const tools = makeTools({
      proxyModule: { getProxyDetail: vi.fn(async () => detail) },
    });

    const result = await tools.getProxy({ proxy_id: 54 });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.proxy).toMatchObject({
      id: 54,
      host: "proxy.example.com",
      username: "demo",
      hasPassword: true,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("topsecret");
    expect(result.proxy).not.toHaveProperty("pass");
  });

  it("returns PROXY_NOT_FOUND when the id does not exist", async () => {
    const tools = makeTools({
      proxyModule: {
        getProxyDetail: vi.fn(async () => ({
          status: false,
          code: 404,
          msg: "Proxy not found",
        })),
      },
    });
    const result = await tools.getProxy({ proxy_id: 999 });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("PROXY_NOT_FOUND");
  });

  it("rejects non-positive proxy_id", async () => {
    const tools = makeTools({
      proxyModule: {
        getProxyDetail: vi.fn(async () => ({
          status: true,
          code: 200,
          msg: "ok",
        })),
      },
    });
    const result = await tools.getProxy({ proxy_id: 0 });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("INVALID_INPUT");
  });
});

const okSave = (id: number): SaveProxyResp => ({
  status: true,
  code: 200,
  msg: "ok",
  data: { id },
});

describe("ProxyAiTools.createProxy", () => {
  it("creates a proxy and returns a redacted summary", async () => {
    const saveProxy = vi.fn(async () => okSave(54));
    const getProxyDetail = vi.fn(async () => ({
      status: true,
      code: 200,
      msg: "ok",
      data: {
        id: 54,
        host: "proxy.example.com",
        port: "1080",
        user: "demo",
        pass: "topsecret",
        protocol: "socks5",
        country_code: "US",
      } as ProxyEntity,
    }));
    const tools = makeTools({ proxyModule: { saveProxy, getProxyDetail } });

    const result = await tools.createProxy({
      host: "proxy.example.com",
      port: 1080,
      protocol: "socks5",
      user: "demo",
      pass: "topsecret",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.created).toBe(true);
    expect(result.proxy.id).toBe(54);
    expect(result.proxy.hasPassword).toBe(true);
    expect(JSON.stringify(result)).not.toContain("topsecret");
    // saved entity passed to module uses normalized string port
    expect(saveProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "proxy.example.com",
        port: "1080",
        protocol: "socks5",
      })
    );
  });

  it("rejects invalid protocol via schema", async () => {
    const tools = makeTools({ proxyModule: { saveProxy: vi.fn() } });
    const result = await tools.createProxy({
      host: "h",
      port: 80,
      protocol: "vpn",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("INVALID_INPUT");
  });

  it("returns DUPLICATE_PROXY on a 409 from saveProxy", async () => {
    const tools = makeTools({
      proxyModule: {
        saveProxy: vi.fn(async () => ({
          status: false,
          code: 409,
          msg: "exists",
          data: { id: 0 },
        })),
      },
    });
    const result = await tools.createProxy({
      host: "h",
      port: 80,
      protocol: "http",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("DUPLICATE_PROXY");
  });
});

describe("ProxyAiTools.updateProxy", () => {
  const current = (): CommonApiresp<ProxyEntity> => ({
    status: true,
    code: 200,
    msg: "ok",
    data: {
      id: 54,
      host: "proxy.example.com",
      port: "1080",
      user: "demo",
      pass: "oldpass",
      protocol: "socks5",
      country_code: "US",
    },
  });

  it("rejects an empty patch", async () => {
    const tools = makeTools({ proxyModule: { getProxyDetail: vi.fn() } });
    const result = await tools.updateProxy({ proxy_id: 54 });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("INVALID_INPUT");
  });

  it("returns PROXY_NOT_FOUND when the id is missing", async () => {
    const tools = makeTools({
      proxyModule: {
        getProxyDetail: vi.fn(async () => ({
          status: false,
          code: 404,
          msg: "no",
        })),
      },
    });
    const result = await tools.updateProxy({ proxy_id: 54, port: 1081 });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("PROXY_NOT_FOUND");
  });

  it("returns EXPECTED_PROXY_MISMATCH on host mismatch", async () => {
    const saveProxy = vi.fn();
    const tools = makeTools({
      proxyModule: { getProxyDetail: vi.fn(async () => current()), saveProxy },
    });
    const result = await tools.updateProxy({
      proxy_id: 54,
      port: 1081,
      expected_host: "wrong.example.com",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("EXPECTED_PROXY_MISMATCH");
    expect(saveProxy).not.toHaveBeenCalled();
  });

  it("updates fields and reports changedFields", async () => {
    const saveProxy = vi.fn(async () => okSave(54));
    const getProxyDetail = vi.fn(async () => current());
    const tools = makeTools({ proxyModule: { saveProxy, getProxyDetail } });

    const result = await tools.updateProxy({ proxy_id: 54, port: 1081 });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.updated).toBe(true);
    expect(result.changedFields).toEqual(["port"]);
    expect(saveProxy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 54, port: "1081" })
    );
  });

  it("clears the password when pass is null", async () => {
    const saveProxy = vi.fn(async () => okSave(54));
    const getProxyDetail = vi.fn(async () => current());
    const tools = makeTools({ proxyModule: { saveProxy, getProxyDetail } });

    const result = await tools.updateProxy({ proxy_id: 54, pass: null });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.changedFields).toContain("pass");
    expect(saveProxy).toHaveBeenCalledWith(
      expect.objectContaining({ pass: null })
    );
  });
});

describe("ProxyAiTools.deleteProxy", () => {
  it("returns EXPECTED_PROXY_MISMATCH on port mismatch and does not delete", async () => {
    const deleteProxyWithCheck = vi.fn();
    const tools = makeTools({
      proxyModule: {
        getProxyDetail: vi.fn(async () => ({
          status: true,
          code: 200,
          msg: "ok",
          data: { id: 9, host: "h", port: "8080", protocol: "http" },
        })),
      },
      proxyController: { deleteProxyWithCheck },
    });
    const result = await tools.deleteProxy({
      proxy_id: 9,
      expected_port: 9999,
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("EXPECTED_PROXY_MISMATCH");
    expect(deleteProxyWithCheck).not.toHaveBeenCalled();
  });

  it("returns PROXY_NOT_FOUND for a missing id", async () => {
    const tools = makeTools({
      proxyModule: {
        getProxyDetail: vi.fn(async () => ({
          status: false,
          code: 404,
          msg: "no",
        })),
      },
      proxyController: { deleteProxyWithCheck: vi.fn() },
    });
    const result = await tools.deleteProxy({ proxy_id: 99 });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("PROXY_NOT_FOUND");
  });

  it("deletes via the controller and returns a redacted summary", async () => {
    const deleteProxyWithCheck = vi.fn(async () => true);
    const tools = makeTools({
      proxyModule: {
        getProxyDetail: vi.fn(async () => ({
          status: true,
          code: 200,
          msg: "ok",
          data: {
            id: 9,
            host: "h",
            port: "8080",
            pass: "pw",
            protocol: "http",
          },
        })),
      },
      proxyController: { deleteProxyWithCheck },
    });
    const result = await tools.deleteProxy({ proxy_id: 9 });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.deleted).toBe(true);
    expect(result.proxy.hasPassword).toBe(true);
    expect(result.proxy).not.toHaveProperty("pass");
    expect(deleteProxyWithCheck).toHaveBeenCalledWith(9);
  });
});

describe("ProxyAiTools.importProxies", () => {
  it("reports per-row invalid rows and imports valid ones (skip policy)", async () => {
    const importProxy = vi.fn(
      async () =>
        ({
          status: true,
          code: 200,
          msg: "ok",
          data: true,
        } as ImportProxyResp)
    );
    const getProxiesByHostPortPairs = vi
      .fn()
      .mockResolvedValueOnce([] as ProxyEntity[]) // existing check: nothing
      .mockResolvedValueOnce([
        { id: 1, host: "1.1.1.1", port: "80" },
      ] as ProxyEntity[]); // reload after import
    const tools = makeTools({
      proxyModule: { importProxy, getProxiesByHostPortPairs },
    });

    const result = await tools.importProxies({
      proxies: [
        { host: "1.1.1.1", port: 80, protocol: "http" },
        { host: "bad", port: 0, protocol: "http" },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.importedCount).toBe(1);
    expect(result.invalidCount).toBe(1);
    expect(result.invalidRows?.[0].index).toBe(1);
  });

  it("skips existing duplicates and reports the skipped count", async () => {
    const importProxy = vi.fn(
      async () =>
        ({
          status: true,
          code: 200,
          msg: "ok",
          data: true,
        } as ImportProxyResp)
    );
    const getProxiesByHostPortPairs = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 7, host: "1.1.1.1", port: "80" },
      ] as ProxyEntity[]) // existing check: 1.1.1.1 already exists
      .mockResolvedValueOnce([
        { id: 8, host: "2.2.2.2", port: "80" },
      ] as ProxyEntity[]); // reload after import
    const tools = makeTools({
      proxyModule: { importProxy, getProxiesByHostPortPairs },
    });

    const result = await tools.importProxies({
      proxies: [
        { host: "1.1.1.1", port: 80, protocol: "http" },
        { host: "2.2.2.2", port: 80, protocol: "http" },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.importedCount).toBe(1);
    expect(result.skippedDuplicateCount).toBe(1);
  });

  it("rejects the whole call when duplicatePolicy is fail and a duplicate exists", async () => {
    const getProxiesByHostPortPairs = vi.fn(
      async () => [{ id: 7, host: "1.1.1.1", port: "80" }] as ProxyEntity[]
    );
    const importProxy = vi.fn();
    const tools = makeTools({
      proxyModule: { importProxy, getProxiesByHostPortPairs },
    });

    const result = await tools.importProxies({
      proxies: [{ host: "1.1.1.1", port: 80, protocol: "http" }],
      duplicatePolicy: "fail",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("IMPORT_FAILED");
    expect(importProxy).not.toHaveBeenCalled();
  });
});

describe("ProxyAiTools.checkProxies", () => {
  function makeCheckDeps(opts: {
    count?: number;
    detail?: (id: number) => ProxyEntity | null;
    batch?: readonly ProxyCheckItemInternal[];
  }) {
    const getProxycount = vi.fn(async () => opts.count ?? 0);
    const getProxyDetail = vi.fn(async (id: number) => {
      const data = opts.detail
        ? opts.detail(id)
        : ({
            id,
            host: `h-${id}`,
            port: "8080",
            protocol: "http",
          } as ProxyEntity);
      return data
        ? ({
            status: true,
            code: 200,
            msg: "ok",
            data,
          } as CommonApiresp<ProxyEntity>)
        : { status: false, code: 404, msg: "no" };
    });
    const results = opts.batch ?? [];
    const checkProxyBatch = vi.fn(async () => ({
      total: results.length,
      checked: results.length,
      results,
    }));
    return {
      proxyModule: { getProxycount, getProxyDetail },
      proxyController: { checkProxyBatch },
      checkProxyBatch,
    };
  }

  it("rejects when no target selector is provided", async () => {
    const deps = makeCheckDeps({});
    const tools = makeTools(deps);
    const result = await tools.checkProxies({ mode: "basic" });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("INVALID_INPUT");
  });

  it("rejects when multiple selectors are provided", async () => {
    const deps = makeCheckDeps({});
    const tools = makeTools(deps);
    const result = await tools.checkProxies({
      proxy_ids: [1],
      check_all: true,
      mode: "basic",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("INVALID_INPUT");
  });

  it("returns UNSUPPORTED_OPERATION when basic mode exceeds 20 ids", async () => {
    const deps = makeCheckDeps({});
    const tools = makeTools(deps);
    const result = await tools.checkProxies({
      proxy_ids: Array.from({ length: 21 }, (_, i) => i + 1),
      mode: "basic",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("UNSUPPORTED_OPERATION");
    expect(deps.checkProxyBatch).not.toHaveBeenCalled();
  });

  it("runs a small synchronous check and aggregates redacted results", async () => {
    const deps = makeCheckDeps({
      batch: [
        { proxyId: 10, basic: "pass", googlePass: "pass" },
        { proxyId: 11, basic: "failure", error: "timeout" },
      ],
    });
    const tools = makeTools(deps);
    const result = await tools.checkProxies({
      proxy_ids: [10, 11],
      mode: "both",
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.checkedCount).toBe(2);
    expect(result.basicPassCount).toBe(1);
    expect(result.basicFailCount).toBe(1);
    expect(result.googlePassCount).toBe(1);
    expect(result.results[0].proxy.hasPassword).toBe(false);
    expect(deps.checkProxyBatch).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "both", proxyIds: [10, 11] })
    );
  });

  it("emits progress events via context", async () => {
    const deps = makeCheckDeps({
      batch: [{ proxyId: 1, basic: "pass" }],
    });
    const tools = makeTools(deps);
    const events: string[] = [];
    const context = {
      conversationId: "c",
      toolCallId: "t",
      emitProgress: (e: { phase: string }) => events.push(e.phase),
    } as unknown as SkillExecutionContext;
    await tools.checkProxies({ proxy_ids: [1], mode: "basic" }, context);
    expect(events).toContain("running");
    expect(events).toContain("finalizing");
  });

  it("returns UNSUPPORTED_OPERATION when the filters scan is truncated by an error", async () => {
    // Page 1 returns a full page (100) with total=500 and only 2 failures; page
    // 2 throws. Without the fix the tool silently proceeds to check the 2
    // partial-data failures; with the fix it refuses (targets unreliable).
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeListRecord({
        id: i + 1,
        status: i < 2 ? 2 : 1, // 2 failures among 100
        checktime: "2026-07-19",
      })
    );
    const getProxylist = vi.fn(async (page: number) => {
      if (page === 1) {
        return listResp(page1, 500);
      }
      throw new Error("db locked mid-scan");
    });
    const checkProxyBatch = vi.fn(async () => ({
      total: 0,
      checked: 0,
      results: [],
    }));
    const tools = makeTools({
      proxyModule: {
        getProxycount: vi.fn(async () => 0),
        getProxyDetail: vi.fn(async (id: number) => ({
          status: true,
          code: 200,
          msg: "ok",
          data: {
            id,
            host: `h-${id}`,
            port: "8080",
            protocol: "http",
          } as ProxyEntity,
        })),
      },
      proxyController: { getProxylist, checkProxyBatch },
    });

    const result = await tools.checkProxies({
      filters: { status: "failure" },
      mode: "basic",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("UNSUPPORTED_OPERATION");
    expect(checkProxyBatch).not.toHaveBeenCalled();
  });
});

describe("ProxyAiTools.removeFailedProxies", () => {
  function makeRemoveDeps(opts: {
    candidateIds: number[];
    detail?: (id: number) => ProxyEntity | null;
    deleteOk?: (id: number) => boolean;
  }) {
    const getFailedProxyCandidateIds = vi.fn(async () => opts.candidateIds);
    const deleteProxyWithCheck = vi.fn(async (id: number) =>
      opts.deleteOk ? opts.deleteOk(id) : true
    );
    const getProxyDetail = vi.fn(async (id: number) => {
      const data = opts.detail
        ? opts.detail(id)
        : ({
            id,
            host: `h-${id}`,
            port: "8080",
            protocol: "http",
          } as ProxyEntity);
      return data
        ? ({
            status: true,
            code: 200,
            msg: "ok",
            data,
          } as CommonApiresp<ProxyEntity>)
        : { status: false, code: 404, msg: "no" };
    });
    return {
      proxyModule: { getProxyDetail },
      proxyController: { getFailedProxyCandidateIds, deleteProxyWithCheck },
      deleteProxyWithCheck,
      getFailedProxyCandidateIds,
    };
  }

  it("dry run lists candidates without deleting", async () => {
    const deps = makeRemoveDeps({ candidateIds: [10, 11, 12] });
    const tools = makeTools(deps);
    const result = await tools.removeFailedProxies({ dry_run: true });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.dryRun).toBe(true);
    expect(result.candidateCount).toBe(3);
    expect(result.deletedCount).toBe(0);
    expect(result.proxies).toHaveLength(3);
    expect(deps.deleteProxyWithCheck).not.toHaveBeenCalled();
  });

  it("deletes candidates up to max_delete when not a dry run", async () => {
    const deps = makeRemoveDeps({ candidateIds: [10, 11, 12] });
    const tools = makeTools(deps);
    const result = await tools.removeFailedProxies({
      dry_run: false,
      max_delete: 2,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.dryRun).toBe(false);
    expect(result.candidateCount).toBe(3);
    expect(result.deletedCount).toBe(2);
    expect(deps.deleteProxyWithCheck).toHaveBeenCalledTimes(2);
  });
});
