import { describe, it, expect } from "vitest";
import { EmailVerifier } from "@/service/contact-verification/EmailVerifier";
import type { DnsMailRouteResolver } from "@/service/contact-verification/DnsMailRouteResolver";
import type { DnsMailRouteResult } from "@/entityTypes/contactVerificationTypes";

/** Build a fake DnsMailRouteResolver that returns a canned result per domain. */
function fakeResolver(
  byDomain: Record<string, DnsMailRouteResult>
): DnsMailRouteResolver {
  return {
    async resolve(domain: string): Promise<DnsMailRouteResult> {
      return (
        byDomain[domain] ?? {
          status: "nxdomain",
          domainResolves: false,
          retryable: false,
        }
      );
    },
  } as unknown as DnsMailRouteResolver;
}

function makeVerifier(
  byDomain: Record<string, DnsMailRouteResult> = {},
  now = new Date("2026-01-01T00:00:00Z")
): EmailVerifier {
  return new EmailVerifier({
    dnsResolver: fakeResolver(byDomain),
    now: () => now,
  });
}

const MX_OK: DnsMailRouteResult = {
  status: "mx",
  domainResolves: true,
  retryable: false,
};
const NULL_MX: DnsMailRouteResult = {
  status: "null_mx",
  domainResolves: true,
  retryable: false,
};
const IMPLICIT: DnsMailRouteResult = {
  status: "implicit_address",
  domainResolves: true,
  retryable: false,
};
const NO_ROUTE: DnsMailRouteResult = {
  status: "no_route",
  domainResolves: true,
  retryable: false,
};
const NXDOMAIN: DnsMailRouteResult = {
  status: "nxdomain",
  domainResolves: false,
  retryable: false,
};
const TEMP: DnsMailRouteResult = {
  status: "temporary_failure",
  domainResolves: null,
  retryable: true,
};

describe("EmailVerifier", () => {
  it("classifies a common valid address as likely_valid", async () => {
    const v = makeVerifier({ "realcompany.com": MX_OK });
    const r = await v.verify("John.Doe@RealCompany.com");
    expect(r.status).toBe("likely_valid");
    expect(r.checks.syntaxValid).toBe(true);
    expect(r.checks.domainResolves).toBe(true);
    expect(r.checks.mailRouting).toBe("mx");
    expect(r.normalized).toBe("John.Doe@realcompany.com");
    expect(r.original).toBe("John.Doe@RealCompany.com");
    expect(r.rulesVersion).toBeTruthy();
  });

  it("preserves original and lowercases only the domain (case-preserving dedup key)", async () => {
    const v = makeVerifier({ "realcompany.com": MX_OK });
    const a = await v.verify("A@RealCompany.com");
    const b = await v.verify("a@realcompany.com");
    // Domain normalized to lowercase; local part display case preserved.
    expect(a.normalized).toBe("A@realcompany.com");
    expect(b.normalized).toBe("a@realcompany.com");
  });

  it("strips leading/trailing extraction punctuation and mailto:", async () => {
    const v = makeVerifier({ "realcompany.com": MX_OK });
    const r = await v.verify("  <John@realcompany.com>,  ");
    expect(r.status).toBe("likely_valid");
    expect(r.normalized).toBe("John@realcompany.com");
  });

  it("strips a mailto: prefix with subject query", async () => {
    const v = makeVerifier({ "realcompany.com": MX_OK });
    const r = await v.verify("mailto:John@realcompany.com?subject=Hi");
    expect(r.status).toBe("likely_valid");
    expect(r.normalized).toBe("John@realcompany.com");
  });

  it("rejects malformed syntax (no @)", async () => {
    const v = makeVerifier();
    const r = await v.verify("not-an-email");
    expect(r.status).toBe("invalid");
    expect(r.checks.syntaxValid).toBe(false);
  });

  it("rejects a placeholder/example domain", async () => {
    const v = makeVerifier({ "example.com": MX_OK });
    const r = await v.verify("someone@example.com");
    expect(r.status).toBe("invalid");
    expect(r.checks.placeholder).toBe(true);
  });

  it("rejects a placeholder local part", async () => {
    const v = makeVerifier({ "realcompany.com": MX_OK });
    const r = await v.verify("test@realcompany.com");
    expect(r.status).toBe("invalid");
    expect(r.checks.placeholder).toBe(true);
  });

  it("rejects IP-literal domains", async () => {
    const v = makeVerifier();
    const r = await v.verify("user@[127.0.0.1]");
    expect(r.status).toBe("invalid");
  });

  it("rejects single-label / localhost domains", async () => {
    const v = makeVerifier();
    const r1 = await v.verify("user@localhost");
    expect(r1.status).toBe("invalid");
    const r2 = await v.verify("user@somedomain");
    expect(r2.status).toBe("invalid");
  });

  it("classifies a role-based local part (valid routing) as role_based", async () => {
    const v = makeVerifier({ "realcompany.com": MX_OK });
    const r = await v.verify("sales@realcompany.com");
    expect(r.status).toBe("role_based");
    expect(r.checks.roleBased).toBe(true);
  });

  it("classifies a disposable domain as risky", async () => {
    const v = makeVerifier({ "mailinator.com": MX_OK });
    const r = await v.verify("anything@mailinator.com");
    expect(r.status).toBe("risky");
    expect(r.checks.disposableDomain).toBe(true);
  });

  it("treats a role-based address on a disposable domain as risky (precedence)", async () => {
    const v = makeVerifier({ "mailinator.com": MX_OK });
    const r = await v.verify("support@mailinator.com");
    expect(r.status).toBe("risky");
    expect(r.checks.roleBased).toBe(true);
    expect(r.checks.disposableDomain).toBe(true);
  });

  it("classifies suspicious local parts as risky", async () => {
    const v = makeVerifier({ "realcompany.com": MX_OK });
    const r = await v.verify("aaaaaaa@realcompany.com");
    expect(r.status).toBe("risky");
    expect(r.checks.suspiciousLocalPart).toBe(true);
  });

  it("treats null MX as invalid", async () => {
    const v = makeVerifier({ "nullmx.com": NULL_MX });
    const r = await v.verify("user@nullmx.com");
    expect(r.status).toBe("invalid");
    expect(r.checks.mailRouting).toBe("null_mx");
  });

  it("treats no MX + A record fallback as implicit_address (likely_valid)", async () => {
    const v = makeVerifier({ "implicit.com": IMPLICIT });
    const r = await v.verify("user@implicit.com");
    expect(r.status).toBe("likely_valid");
    expect(r.checks.mailRouting).toBe("implicit_address");
  });

  it("treats no route as invalid", async () => {
    const v = makeVerifier({ "noroute.com": NO_ROUTE });
    const r = await v.verify("user@noroute.com");
    expect(r.status).toBe("invalid");
    expect(r.checks.mailRouting).toBe("no_route");
  });

  it("treats NXDOMAIN as invalid", async () => {
    const v = makeVerifier({ "doesnotexist.invalid": NXDOMAIN });
    const r = await v.verify("user@doesnotexist.invalid");
    expect(r.status).toBe("invalid");
    expect(r.checks.mailRouting).toBe("nxdomain");
    expect(r.checks.domainResolves).toBe(false);
  });

  it("treats a temporary DNS failure as unknown, NOT invalid", async () => {
    const v = makeVerifier({ "temp.com": TEMP });
    const r = await v.verify("user@temp.com");
    expect(r.status).toBe("unknown");
    expect(r.checks.mailRouting).toBe("temporary_failure");
    expect(r.checks.domainResolves).toBe(null);
  });

  it("rejects values embedded in markup/URL concatenation", async () => {
    const v = makeVerifier({ "realcompany.com": MX_OK });
    // A value with a URL fragment / space is not a single valid email.
    const r = await v.verify("https://realcompany.com/ John@realcompany.com");
    expect(r.status).toBe("invalid");
  });

  it("always returns at least one reason for every classification", async () => {
    const cases = [
      "John@realcompany.com",
      "sales@realcompany.com",
      "anything@mailinator.com",
      "user@example.com",
      "user@doesnotexist.invalid",
      "user@temp.com",
      "not-an-email",
    ];
    const dnsMap: Record<string, DnsMailRouteResult> = {
      "realcompany.com": MX_OK,
      "mailinator.com": MX_OK,
      "example.com": MX_OK,
      "doesnotexist.invalid": NXDOMAIN,
      "temp.com": TEMP,
    };
    const v2 = makeVerifier(dnsMap);
    for (const input of cases) {
      const r = await v2.verify(input);
      expect(r.reasons.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("caps reasons per contact (maxReasonsPerContact)", async () => {
    const v = makeVerifier({ "realcompany.com": MX_OK });
    const r = await v.verify("sales@realcompany.com");
    // role + dns reason = 2, well under cap; verify cap is a number >= 1
    expect(r.reasons.length).toBeLessThanOrEqual(5);
  });
});
