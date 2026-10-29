import { log } from "@/modules/Logger";
import { isOriginAuthorized } from "@/service/CaptchaResolutionPolicy";
import { CAPTCHA_PROVIDER_DISCLOSURE_VERSION } from "@/service/CaptchaResolutionPolicy";

/**
 * Policy-gated CAPTCHA provider adapter (design §18.3, GAP-15).
 *
 * MAIN-PROCESS ONLY. The pure decision ladder (CaptchaResolutionPolicy)
 * decides WHEN a provider may be consulted; this service performs the
 * gated, request-scoped call. Hard invariants:
 *  - social/login/security/payment/unknown flows are NEVER sent to a
 *    provider — they always stay in manual handoff;
 *  - domains are suffix-exact authorized (default: NONE authorized);
 *  - the disclosure consent version must be explicitly accepted;
 *  - exactly ONE provider attempt per challenge id;
 *  - bounded submit+poll window with cancellation;
 *  - the API token lives in the encrypted Token store — never in a
 *    setting row, log, event, or tool result;
 *  - ANY failure preserves the same browser for manual handoff.
 *
 * The transport is injectable so tests run against a fake provider with
 * zero network.
 */

/**
 * Setting rows for the provider gates. The master toggle and the API token
 * REUSE the pre-existing 2captcha rows (settings group `2captcha-group`);
 * the three managed-browser gates below are new and default DENY.
 */
export const MANAGED_BROWSER_2CAPTCHA_SETTING_KEYS = {
  enabled: "2captcha-enabled",
  token: "2captcha-token",
  disclosureAccepted: "managed-browser-2captcha-disclosure",
  authorizedDomains: "managed-browser-2captcha-domains",
  nonLoginChallengesAllowed: "managed-browser-2captcha-non-login",
} as const;

export interface CaptchaProviderConfig {
  readonly enabled: boolean;
  readonly tokenPresent: boolean;
  readonly disclosureVersionAccepted: string | null;
  readonly authorizedDomains: readonly string[];
  readonly nonLoginChallengesAllowed: boolean;
}

export type CaptchaProviderRefusal =
  | "provider_disabled"
  | "token_missing"
  | "disclosure_not_accepted"
  | "domain_not_authorized"
  | "flow_not_supported"
  | "already_attempted"
  | "risk_requires_handoff";

export type CaptchaSolveOutcome =
  | { readonly status: "refused"; readonly reasonCode: CaptchaProviderRefusal }
  | { readonly status: "failed"; readonly reasonCode: string }
  | { readonly status: "solved"; readonly token: string };

/** Injectable transport (tests fake it; production uses fetch). */
export type CaptchaProviderTransport = (
  url: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal: AbortSignal;
  }
) => Promise<{ readonly ok: boolean; readonly text: () => Promise<string> }>;

export interface CaptchaProviderDeps {
  readonly transport?: CaptchaProviderTransport;
  readonly settingReader?: { getSettingValue(key: string): Promise<string | null> };
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Bounded overall window for submit + polling. */
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

interface SubmitResponse {
  readonly status: number;
  readonly request: string;
}

export class CaptchaProviderService {
  private readonly transport: CaptchaProviderTransport;
  private readonly settingReader: {
    getSettingValue(key: string): Promise<string | null>;
  };
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  /** challengeId → attempted (single-attempt enforcement). */
  private readonly attempted = new Set<string>();

  public constructor(deps: CaptchaProviderDeps = {}) {
    this.transport =
      deps.transport ?? ((url, init) => fetch(url, init as RequestInit));
    this.settingReader =
      deps.settingReader ?? defaultSettingReader();
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /** The gate configuration the policy ladder consumes. */
  public async getConfig(): Promise<CaptchaProviderConfig> {
    const [enabledRaw, tokenRaw, disclosureRaw, domainsRaw, nonLoginRaw] =
      await Promise.all([
        this.settingReader.getSettingValue(
          MANAGED_BROWSER_2CAPTCHA_SETTING_KEYS.enabled
        ),
        this.settingReader.getSettingValue(
          MANAGED_BROWSER_2CAPTCHA_SETTING_KEYS.token
        ),
        this.settingReader.getSettingValue(
          MANAGED_BROWSER_2CAPTCHA_SETTING_KEYS.disclosureAccepted
        ),
        this.settingReader.getSettingValue(
          MANAGED_BROWSER_2CAPTCHA_SETTING_KEYS.authorizedDomains
        ),
        this.settingReader.getSettingValue(
          MANAGED_BROWSER_2CAPTCHA_SETTING_KEYS.nonLoginChallengesAllowed
        ),
      ]);
    return {
      enabled: enabledRaw === "1",
      tokenPresent: (tokenRaw ?? "").trim().length > 0,
      disclosureVersionAccepted:
        disclosureRaw === "1" ? CAPTCHA_PROVIDER_DISCLOSURE_VERSION : null,
      authorizedDomains: (domainsRaw ?? "")
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0),
      nonLoginChallengesAllowed: nonLoginRaw === "1",
    };
  }

  /**
   * Request-scoped solve attempt. EVERY refusal keeps the browser in
   * manual handoff — the caller never needs a fallback branch.
   */
  public async attemptSolve(input: {
    readonly challengeId: string;
    readonly origin: string;
    readonly siteKey: string;
    readonly pageUrl: string;
    readonly flow:
      | "login"
      | "security"
      | "payment"
      | "content_action"
      | "read_navigation"
      | "unknown";
    readonly currentActionRisk: string;
    readonly signal?: AbortSignal;
  }): Promise<CaptchaSolveOutcome> {
    const refuse = (
      reasonCode: CaptchaProviderRefusal
    ): CaptchaSolveOutcome => ({ status: "refused", reasonCode });

    if (this.attempted.has(input.challengeId)) {
      return refuse("already_attempted");
    }
    if (
      input.flow === "login" ||
      input.flow === "security" ||
      input.flow === "payment" ||
      input.flow === "unknown"
    ) {
      return refuse("flow_not_supported");
    }
    if (
      input.currentActionRisk === "credential_or_security" ||
      input.currentActionRisk === "consequential_write"
    ) {
      return refuse("risk_requires_handoff");
    }
    const config = await this.getConfig();
    if (!config.enabled) {
      return refuse("provider_disabled");
    }
    if (!config.tokenPresent) {
      return refuse("token_missing");
    }
    if (
      config.disclosureVersionAccepted !== CAPTCHA_PROVIDER_DISCLOSURE_VERSION
    ) {
      return refuse("disclosure_not_accepted");
    }
    if (!config.nonLoginChallengesAllowed) {
      return refuse("flow_not_supported");
    }
    let originHost = input.origin.toLowerCase();
    try {
      originHost = new URL(input.origin).hostname;
    } catch {
      /* keep raw */
    }
    if (!isOriginAuthorized(originHost, config.authorizedDomains)) {
      return refuse("domain_not_authorized");
    }

    this.attempted.add(input.challengeId);
    const apiKey = (await this.settingReader.getSettingValue(
      MANAGED_BROWSER_2CAPTCHA_SETTING_KEYS.token
    )) as string;
    const controller = new AbortController();
    input.signal?.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
    const deadline = this.now() + this.timeoutMs;
    try {
      // Submit (in.php). The API key rides only in the request — never a
      // log line or result.
      const submitUrl =
        `https://2captcha.com/in.php?key=${encodeURIComponent(apiKey)}` +
        `&method=userrecaptcha&googlekey=${encodeURIComponent(input.siteKey)}` +
        `&pageurl=${encodeURIComponent(input.pageUrl)}&json=1`;
      const submit = await this.jsonCall<SubmitResponse>(
        submitUrl,
        controller.signal
      );
      if (submit.status !== 1 || !submit.request) {
        return { status: "failed", reasonCode: "submit_rejected" };
      }
      const requestId = submit.request;
      // Poll (res.php) until solved, failed, or the window closes.
      while (this.now() < deadline) {
        if (controller.signal.aborted || input.signal?.aborted) {
          return { status: "failed", reasonCode: "cancelled" };
        }
        await this.sleep(this.pollIntervalMs);
        const pollUrl =
          `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}` +
          `&action=get&id=${encodeURIComponent(requestId)}&json=1`;
        const poll = await this.jsonCall<SubmitResponse>(
          pollUrl,
          controller.signal
        );
        if (poll.status === 1 && poll.request) {
          return { status: "solved", token: poll.request };
        }
        if (poll.request === "CAPCHA_NOT_READY") {
          continue;
        }
        return { status: "failed", reasonCode: "solve_rejected" };
      }
      return { status: "failed", reasonCode: "timeout" };
    } catch (error) {
      // Any transport error → failure; the browser stays in handoff.
      log.warn(
        `[CaptchaProvider] solve failed: ${
          error instanceof Error ? error.name : "unknown"
        }`
      );
      return { status: "failed", reasonCode: "transport_error" };
    }
  }

  private async jsonCall<T>(
    url: string,
    signal: AbortSignal
  ): Promise<T> {
    const response = await this.transport(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new Error(`http_${response.ok}`);
    }
    return JSON.parse(await response.text()) as T;
  }
}

function defaultSettingReader(): {
  getSettingValue(key: string): Promise<string | null>;
} {
  // Lazy: keeps this module importable in unit tests without a DB.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SystemSettingModule: Ssm } = require("@/modules/SystemSettingModule") as {
    SystemSettingModule: new () => {
      getSettingValue(key: string): Promise<string | null>;
    };
  };
  const reader = new Ssm();
  return { getSettingValue: (key) => reader.getSettingValue(key) };
}

let defaultProvider: CaptchaProviderService | null = null;

export function getDefaultCaptchaProviderService(): CaptchaProviderService {
  if (!defaultProvider) {
    defaultProvider = new CaptchaProviderService();
  }
  return defaultProvider;
}
