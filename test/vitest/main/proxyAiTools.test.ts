import { describe, it, expect, vi } from "vitest";
import { ProxyAiTools } from "@/service/ProxyAiTools";
import type { IProxyApi } from "@/modules/interface/IProxyApi";
import type { ProxyController } from "@/controller/proxy-controller";
import type { ProxyListEntity } from "@/entityTypes/proxyType";
import type {
  ProxylistResp,
  ProxyEntity,
} from "@/entityTypes/proxyType";
import type { CommonApiresp } from "@/entityTypes/commonType";

function makeListRecord(
  over: Partial<ProxyListEntity> & { id: number },
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

function listResp(records: ProxyListEntity[], total: number): ProxylistResp {
  return { status: true, msg: "Success", data: { total, records } };
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
        2,
      ),
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
      listResp(records.slice(0, size), records.length),
    );
    const tools = makeTools({ proxyController: { getProxylist } });

    const result = await tools.listProxies({ status: "failure", page: 0, size: 10 });

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
        getProxylist: vi.fn(async () => ({
          status: false,
          msg: "db locked",
          data: { total: 0, records: [] },
        })),
      },
    });
    const result = await tools.listProxies({});
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("UNSUPPORTED_OPERATION");
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
      proxyModule: { getProxyDetail: vi.fn(async () => ({ status: true, code: 200, msg: "ok" })) },
    });
    const result = await tools.getProxy({ proxy_id: 0 });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("INVALID_INPUT");
  });
});
