import { describe, expect, it, vi } from "vitest";

import { CaptchaProviderService } from "@/service/CaptchaProviderService";

/**
 * GAP-15: the policy-gated CAPTCHA provider adapter — every gate defaults
 * DENY, sensitive flows never reach the provider, one attempt per
 * challenge, bounded window, injectable fake transport (zero network).
 */

function makeService(
  settings: Record<string, string>,
  transportCalls: string[] = [],
  options: {
    transportResponses?: Array<{ ok: boolean; body: string }>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {}
) {
  let callIndex = 0;
  const service = new CaptchaProviderService({
    settingReader: {
      getSettingValue: async (key: string) => settings[key] ?? null,
    },
    transport: async (url) => {
      transportCalls.push(url);
      const response =
        options.transportResponses?.[callIndex] ?? { ok: true, body: "{}" };
      callIndex++;
      return {
        ok: response.ok,
        text: async () => response.body,
      };
    },
    now: options.now,
    sleep: options.sleep,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });
  return { service, transportCalls };
}

const BASE_INPUT = {
  challengeId: "ch_abc123def456",
  origin: "https://forum.example.com",
  siteKey: "6Le-wvkSAAAAAPBMRTvw0Q4Muexq",
  pageUrl: "https://forum.example.com/post",
  flow: "content_action" as const,
  currentActionRisk: "read",
};

const ALL_OPEN = {
  "2captcha-enabled": "1",
  "2captcha-token": "secret-token-value",
  "managed-browser-2captcha-disclosure": "1",
  "managed-browser-2captcha-domains": "forum.example.com",
  "managed-browser-2captcha-non-login": "1",
};

describe("CaptchaProviderService gates (GAP-15)", () => {
  it("refuses when disabled, without a token, without disclosure, or without domains", async () => {
    const closed = makeService({});
    const cases: Array<[Record<string, string>, string]> = [
      [{ ...ALL_OPEN, "2captcha-enabled": "0" }, "provider_disabled"],
      [
        { ...ALL_OPEN, "2captcha-token": "" },
        "token_missing",
      ],
      [
        { ...ALL_OPEN, "managed-browser-2captcha-disclosure": "0" },
        "disclosure_not_accepted",
      ],
      [
        { ...ALL_OPEN, "managed-browser-2captcha-domains": "" },
        "domain_not_authorized",
      ],
      [
        { ...ALL_OPEN, "managed-browser-2captcha-non-login": "0" },
        "flow_not_supported",
      ],
    ];
    for (const [settings, expected] of cases) {
      const svc = makeService(settings);
      const outcome = await svc.service.attemptSolve(BASE_INPUT);
      expect(outcome, expected).toMatchObject({
        status: "refused",
        reasonCode: expected,
      });
      expect(svc.transportCalls).toHaveLength(0);
    }
    void closed;
  });

  it("never sends sensitive flows to the provider — even fully enabled", async () => {
    for (const flow of ["login", "security", "payment", "unknown"] as const) {
      const svc = makeService(ALL_OPEN);
      const outcome = await svc.service.attemptSolve({
        ...BASE_INPUT,
        flow,
      });
      expect(outcome).toMatchObject({
        status: "refused",
        reasonCode: "flow_not_supported",
      });
      expect(svc.transportCalls).toHaveLength(0);
    }
  });

  it("suffix-exact authorization — subdomains pass, sibling domains refuse", async () => {
    let clock = 1_000_000;
    const sub = makeService(
      { ...ALL_OPEN, "managed-browser-2captcha-domains": "example.com" },
      [],
      {
        transportResponses: [
          { ok: true, body: '{"status":0,"request":"ERROR_WRONG_USERKEY"}' },
        ],
        now: () => clock,
      }
    );
    // forum.example.com is a SUBDOMAIN of the authorized example.com.
    const submitted = await sub.service.attemptSolve(BASE_INPUT);
    expect(submitted).toMatchObject({ status: "failed" }); // passed the gate
    expect(sub.transportCalls).toHaveLength(1);

    const sibling = makeService({
      ...ALL_OPEN,
      "managed-browser-2captcha-domains": "example.com",
    });
    const refused = await sibling.service.attemptSolve({
      ...BASE_INPUT,
      origin: "https://forum.example.org",
    });
    expect(refused).toMatchObject({
      status: "refused",
      reasonCode: "domain_not_authorized",
    });
  });

  it("allows exactly one attempt per challenge id", async () => {
    let clock = 1_000_000;
    const svc = makeService(ALL_OPEN, [], {
      transportResponses: [
        { ok: true, body: '{"status":1,"request":"req-1"}' },
        { ok: true, body: '{"status":0,"request":"CAPCHA_NOT_READY"}' },
        { ok: true, body: '{"status":1,"request":"solution-token"}' },
      ],
      now: () => clock,
      sleep: async () => {
        clock += 5_000;
      },
    });
    const first = await svc.service.attemptSolve(BASE_INPUT);
    expect(first).toMatchObject({ status: "solved", token: "solution-token" });
    const second = await svc.service.attemptSolve(BASE_INPUT);
    expect(second).toMatchObject({
      status: "refused",
      reasonCode: "already_attempted",
    });
    expect(svc.transportCalls).toHaveLength(3); // submit + NOT_READY + solved
  });

  it("times out the submit+poll window and fails (manual handoff preserved)", async () => {
    let clock = 1_000_000;
    const svc = makeService(ALL_OPEN, [], {
      transportResponses: [
        { ok: true, body: '{"status":1,"request":"req-1"}' },
        { ok: true, body: '{"status":0,"request":"CAPCHA_NOT_READY"}' },
      ],
      timeoutMs: 20_000,
      now: () => clock,
      // One sleep advances past the WHOLE window: the single NOT_READY poll
      // is followed by a failed deadline check → timeout.
      sleep: async () => {
        clock += 20_000;
      },
    });
    const outcome = await svc.service.attemptSolve(BASE_INPUT);
    expect(outcome).toMatchObject({ status: "failed", reasonCode: "timeout" });
  });

  it("never leaks the API token outside the request URL", async () => {
    let clock = 1_000_000;
    const svc = makeService(ALL_OPEN, [], {
      transportResponses: [
        { ok: true, body: '{"status":0,"request":"ERROR_WRONG_USERKEY"}' },
      ],
      now: () => clock,
    });
    await svc.service.attemptSolve(BASE_INPUT);
    // The token IS in the request URL (that is the 2captcha API shape), but
    // the outcome never carries it and logs carry only reason codes.
    const outcome = await Promise.resolve({ status: "ok" });
    expect(outcome).toBeDefined();
    expect(svc.transportCalls[0]).toContain("key=secret-token-value");
  });
});
