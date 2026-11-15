/**
 * SystemOneDecisionClient (N01; technical design §9.3).
 *
 * The USER-NATIVE decision route: POSTs typed decision questions directly
 * to an EXPLICITLY configured profile endpoint with its own selected
 * credential. The native protocol is never inferred — a profile exists
 * only when the user configured one (settings `mode: "native_profile"`
 * with a complete profile record), and `apiKeyRef: "none"` is INERT: the
 * client refuses rather than sending an unauthenticated request.
 *
 * Response validation mirrors the shared strict envelope (normalizeWireResult
 * with native distribution allowed — this IS a native route when configured).
 */
import type {
  BrowserDecisionCapabilities,
  BrowserDecisionClient,
  BrowserDecisionInput,
  BrowserDecisionResult,
} from "@/entityTypes/browserDecisionTypes";
import { normalizeWireResult } from "@/service/browserDecision/DecisionClients";

export interface NativeProfile {
  readonly displayName: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKeyRef: "chat" | "none";
}

export interface SystemOneEndpoints {
  /** Submit a typed decision question; returns the raw native envelope. */
  readonly postQuestion: (
    endpoint: string,
    body: unknown,
    signal: AbortSignal
  ) => Promise<unknown>;
}

export class SystemOneDecisionClient implements BrowserDecisionClient {
  constructor(
    private readonly profile: NativeProfile,
    private readonly endpoints: SystemOneEndpoints,
    private readonly getConfigKey?: () => string | null
  ) {
    if (profile.apiKeyRef === "none") {
      // N01: an inert profile never produces a doomed run — the client is
      // unusable until the user selects a credential for this endpoint.
      throw new Error("native_profile_incomplete");
    }
  }

  private frozenConfigKey: string | null = null;

  public freezeRoute(configKey: string | null): void {
    this.frozenConfigKey = configKey;
  }

  private configChanged(): boolean {
    return (
      this.getConfigKey !== undefined &&
      this.frozenConfigKey !== null &&
      this.getConfigKey() !== this.frozenConfigKey
    );
  }

  public async getCapabilities(signal: AbortSignal): Promise<BrowserDecisionCapabilities> {
    void signal;
    return {
      advertised: true,
      operations: [],
      supportsStructuredJsonSchema: false,
      supportsForcedToolDecision: false,
      supportsJsonObject: false,
      // The profile IS the explicit native route (design §9.3).
      nativeDecision: true,
      maxCandidates: 120,
      deadlineDefaultMs: 3_000,
      deadlineHardMs: 10_000,
      cacheable: true,
    };
  }

  public async decide(
    input: BrowserDecisionInput,
    signal: AbortSignal
  ): Promise<BrowserDecisionResult> {
    if (signal.aborted) {
      return { status: "provider_error", reason_code: "request_aborted" };
    }
    if (this.configChanged()) {
      return { status: "provider_error", reason_code: "provider_config_changed" };
    }
    // V03/D-FR-02: the config watch ABORTS the in-flight call when the
    // provider configuration changes mid-request (mirrors the chat
    // client's polling abort).
    const attemptController = new AbortController();
    const onOuterAbort = (): void => attemptController.abort();
    signal.addEventListener("abort", onOuterAbort, { once: true });
    const configWatch = this.getConfigKey
      ? setInterval(() => {
          if (this.configChanged()) {
            attemptController.abort();
          }
        }, 500)
      : null;
    let raw: unknown;
    try {
      raw = await this.endpoints.postQuestion(
        this.profile.baseUrl,
        {
          model: this.profile.model,
          question: input,
        },
        attemptController.signal
      );
    } finally {
      if (configWatch !== null) {
        clearInterval(configWatch);
      }
      signal.removeEventListener("abort", onOuterAbort);
    }
    if (signal.aborted) {
      return { status: "provider_error", reason_code: "request_aborted" };
    }
    if (this.configChanged()) {
      return {
        status: "provider_error",
        reason_code: "provider_config_changed",
      };
    }
    // Native distribution IS allowed here — the profile is an explicit
    // native route (design §9.1: source-tagged uncertainty).
    try {
      return normalizeWireResult(raw, { allowNativeDistribution: true });
    } catch {
      return { status: "provider_error", reason_code: "native_request_failed" };
    }
  }
}
