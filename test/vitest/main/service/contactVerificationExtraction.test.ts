import { describe, it, expect } from "vitest";
import {
  serializeContactVerificationResult,
  type ContactVerificationInternalResult,
} from "@/service/ContactVerificationAiTools";
import { ContactVerificationService } from "@/service/contact-verification/ContactVerificationService";
import { ContactVerificationCache } from "@/service/contact-verification/ContactVerificationCache";
import type { DnsMailRouteResolver } from "@/service/contact-verification/DnsMailRouteResolver";
import type { DnsMailRouteResult } from "@/entityTypes/contactVerificationTypes";

const NXDOMAIN: DnsMailRouteResult = {
  status: "nxdomain",
  domainResolves: false,
  retryable: false,
};

function fakeResolver(
  byDomain: Record<string, DnsMailRouteResult>
): DnsMailRouteResolver {
  return {
    async resolve(domain: string) {
      return byDomain[domain] ?? NXDOMAIN;
    },
  } as unknown as DnsMailRouteResolver;
}

function makeService(
  byDomain: Record<string, DnsMailRouteResult> = {}
): ContactVerificationService {
  return new ContactVerificationService({
    dnsResolver: fakeResolver(byDomain),
    cache: new ContactVerificationCache(() => new Date(0)),
    now: () => new Date(0),
  });
}

describe("extraction verification composition", () => {
  it("serializes an email-only verification result to the snake_case contract", async () => {
    const service = makeService();
    const internal = await service.verify({
      contacts: [{ emails: ["someone@example.com"] }],
    });
    const snake = serializeContactVerificationResult(internal);
    expect(snake.verification_performed).toBe(true);
    expect(snake.verification_depth).toBe("standard");
    expect(snake).toHaveProperty("limitations");
    expect(snake).toHaveProperty("summary");
    const contacts = (snake.contacts as unknown[])[0] as {
      emails: Array<{ status: string; checks: Record<string, unknown> }>;
    };
    // someone@example.com is a placeholder local part -> invalid
    expect(contacts.emails[0].status).toBe("invalid");
    expect(contacts.emails[0].checks).toHaveProperty("mail_routing");
  });

  it("serializes a phone-only result and preserves ambiguous national numbers", async () => {
    const service = makeService();
    const internal = await service.verify({
      contacts: [{ phones: ["020 7946 0958"] }],
    });
    const snake = serializeContactVerificationResult(internal);
    const contacts = (snake.contacts as unknown[])[0] as {
      phones: Array<{ status: string; normalized?: string }>;
    };
    expect(contacts.phones[0].status).toBe("ambiguous_region");
    expect(contacts.phones[0].normalized).toBeUndefined();
  });

  it("a result with no contacts still serializes (verification_required=false path)", async () => {
    const service = makeService();
    const internal: ContactVerificationInternalResult = await service.verify({
      contacts: [{ emails: [] as string[], phones: [] as string[] }],
    });
    const snake = serializeContactVerificationResult(internal);
    expect(snake.success).toBe(true);
    expect((snake.summary as { input_emails: number }).input_emails).toBe(0);
  });

  it("never normalizes a national phone from a campaign-country hint (extraction has no evidence)", async () => {
    // Simulates the extraction-composition path: no countryEvidence is
    // passed, so a national US-format number stays ambiguous_region.
    const service = makeService();
    const internal = await service.verify({
      contacts: [{ phones: ["(415) 555-2671"] }],
    });
    const snake = serializeContactVerificationResult(internal);
    const contacts = (snake.contacts as unknown[])[0] as {
      phones: Array<{ status: string; normalized?: string }>;
    };
    expect(contacts.phones[0].status).toBe("ambiguous_region");
    expect(contacts.phones[0].normalized).toBeUndefined();
  });
});
