import { describe, it, expect } from "vitest";
import {
  DnsMailRouteResolver,
  type DnsMailRouteAdapter,
  type MxRecord,
} from "@/service/contact-verification/DnsMailRouteResolver";

/** Build a fake adapter with per-method scripted responses. */
function makeAdapter(opts: {
  mx?: (domain: string) => Promise<readonly MxRecord[]> | Promise<never>;
  a4?: (domain: string) => Promise<readonly string[]> | Promise<never>;
  a6?: (domain: string) => Promise<readonly string[]> | Promise<never>;
}): DnsMailRouteAdapter {
  const defaultA4 = (): Promise<readonly string[]> =>
    Promise.resolve(["1.2.3.4"]);
  const defaultA6 = (): Promise<readonly string[]> => Promise.resolve([]);
  return {
    resolveMx: opts.mx ?? (() => Promise.resolve([])),
    resolve4: opts.a4 ?? defaultA4,
    resolve6: opts.a6 ?? defaultA6,
  };
}

function dnsError(code: string, message = code): Error {
  const e = new Error(`${message}: ${code}`);
  Object.assign(e, { code });
  return e;
}

function resolver(adapter: DnsMailRouteAdapter): DnsMailRouteResolver {
  return new DnsMailRouteResolver({ adapter });
}

describe("DnsMailRouteResolver", () => {
  it("returns mx when one or more usable MX records exist", async () => {
    const a = makeAdapter({
      mx: () => Promise.resolve([{ priority: 10, exchange: "mail.x.com" }]),
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("mx");
    expect(r.domainResolves).toBe(true);
  });

  it("returns null_mx for an explicit null MX (exchange === '.')", async () => {
    const a = makeAdapter({
      mx: () => Promise.resolve([{ priority: 0, exchange: "." }]),
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("null_mx");
  });

  it("falls back to A/AAAA (implicit_address) when ENODATA and A exists", async () => {
    const a = makeAdapter({
      mx: () => Promise.reject(dnsError("ENODATA")),
      a4: () => Promise.resolve(["1.2.3.4"]),
      a6: () => Promise.resolve([]),
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("implicit_address");
  });

  it("falls back to AAAA when only IPv6 exists", async () => {
    const a = makeAdapter({
      mx: () => Promise.reject(dnsError("ENODATA")),
      a4: () => Promise.resolve([]),
      a6: () => Promise.resolve(["::1"]),
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("implicit_address");
  });

  it("returns no_route when ENODATA and no A/AAAA", async () => {
    const a = makeAdapter({
      mx: () => Promise.reject(dnsError("ENODATA")),
      a4: () => Promise.resolve([]),
      a6: () => Promise.resolve([]),
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("no_route");
  });

  it("returns nxdomain for ENOTFOUND on MX", async () => {
    const a = makeAdapter({
      mx: () => Promise.reject(dnsError("ENOTFOUND")),
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("nxdomain");
    expect(r.domainResolves).toBe(false);
  });

  it("retries exactly once for a temporary failure, then returns temporary_failure", async () => {
    let calls = 0;
    const a = makeAdapter({
      mx: () => {
        calls += 1;
        return Promise.reject(dnsError("ESERVFAIL"));
      },
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("temporary_failure");
    expect(r.domainResolves).toBe(null);
    expect(r.retryable).toBe(true);
    expect(calls).toBe(2);
  });

  it("does NOT retry NXDOMAIN", async () => {
    let calls = 0;
    const a = makeAdapter({
      mx: () => {
        calls += 1;
        return Promise.reject(dnsError("ENOTFOUND"));
      },
    });
    await resolver(a).resolve("x.com");
    expect(calls).toBe(1);
  });

  it("maps SERVFAIL to temporary_failure", async () => {
    const a = makeAdapter({
      mx: () => Promise.reject(dnsError("SERVFAIL")),
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("temporary_failure");
  });

  it("maps an unknown error code to resolver_failure (NOT nxdomain)", async () => {
    const a = makeAdapter({
      mx: () => Promise.reject(dnsError("EBAISCHEMABOFAN")),
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("resolver_failure");
  });

  it("treats a timeout as a temporary failure (3s ceiling)", async () => {
    // Adapter that never resolves within the test; we simulate a hang and
    // rely on the resolver's internal 3s timeout. To keep the test fast,
    // reject with ETIMEOUT directly (the resolver treats ETIMEOUT as temp).
    let calls = 0;
    const a = makeAdapter({
      mx: () => {
        calls += 1;
        return Promise.reject(dnsError("ETIMEOUT"));
      },
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("temporary_failure");
    expect(calls).toBe(2); // one retry
  });

  it("never casts caught errors to any (uses object.code inspection)", async () => {
    // Non-object error: should map to resolver_failure, not crash.
    const a = makeAdapter({
      mx: () => Promise.reject("string error" as unknown as Error),
    });
    const r = await resolver(a).resolve("x.com");
    expect(r.status).toBe("resolver_failure");
  });
});
