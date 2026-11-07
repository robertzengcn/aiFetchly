import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getCredentialCardWaitRegistry,
  BrowserCredentialLoginService,
} from "@/service/browserLogin/BrowserCredentialLoginService";

/**
 * PRD A-FR-05/06: the credential card wait registry (single-use,
 * conversation-bound) and the sign-in service's no-account card path
 * (A-AC-05: the submitted password reaches only encrypted storage).
 */

vi.mock("@/modules/ManagedBrowserModule", () => ({
  getDefaultManagedBrowserModule: () => ({
    observe: vi.fn().mockResolvedValue({
      observationId: "obs-live",
      pageRevision: 1,
      url: "https://www.example.test/login",
      origin: "https://www.example.test",
      title: "Example",
      state: "ready",
      elements: [],
      visibleText: "",
      notices: [],
      truncated: false,
    }),
    getStatus: () => ({
      sessionId: "mb_signin0001",
      accountId: 0,
      platformId: 2,
      state: "ready",
      currentOrigin: "https://www.example.test/login",
      ownerConversationId: "conv-1",
    }),
    fillLoginForm: vi.fn().mockResolvedValue({
      outcome: "success",
      reasonCode: null,
      filledFieldStamps: ["user", "pass"],
    }),
    requestHandoff: vi.fn().mockResolvedValue({}),
    bindAccountToSession: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/modules/BrowserSiteModule", () => ({
  getDefaultBrowserSiteModule: () => ({
    matchByUrl: () => ({
      siteId: 42,
      name: "Example",
      registrableDomain: "example.test",
      allowedDomainSuffixes: ["example.test"],
      requiredDomainSuffixes: [],
      loginUrl: "https://www.example.test/login",
      verificationUrl: null,
      loginRecipe: null,
      source: "ai",
      status: "unverified",
    }),
    markVerified: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("@/modules/socialAccountModule", () => {
  return {
    SocialAccountModule: class {
      async getAccountsForSite() {
        return fakeAccounts;
      }
      async isSignInCoolingDown() {
        return fakeCoolingDown();
      }
      async getCredentialForLogin() {
        return fakeCredential;
      }
      async saveSubmittedCredential(input: { username: string; password: string }) {
        savedCredentials.push(input);
        return 777;
      }
      async recordLoginFailure() {
        failures.push("recorded");
      }
      async recordLoginFailureClear() {
        /* no-op */
      }
    },
  };
});

const savedCredentials: Array<{ username: string; password: string }> = [];
const failures: string[] = [];
// F12: per-test fixture state read lazily by the mocked module class.
const fakeAccounts: Array<{ id: number; user: string }> = [];
let fakeCredential: unknown = {
  ok: false as const,
  reason: "credential_unavailable" as const,
};
let fakeCoolingDown: () => boolean | Promise<boolean> = () => false;

describe("credential card wait registry (A-FR-05/06)", () => {
  it("creates a request bound to the conversation and consumes it once", async () => {
    const reg = getCredentialCardWaitRegistry();
    const { request, promise } = reg.create({
      conversationId: "conv-1",
      sessionId: "mb_signin0001",
      siteId: 42,
      siteDomain: "example.test",
      mode: "login",
      prefillUsername: "user@example.test",
    });
    expect(request.prefillUsername).toBe("user@example.test");
    expect(request.siteDomain).toBe("example.test");
    const pending = reg.listForConversation("conv-1");
    expect(pending).toHaveLength(1);

    const submit = reg.consume({ requestId: request.requestId, conversationId: "conv-1" });
    expect(submit).not.toBeNull();
    submit!.resolve({ username: "u", password: "p", save: true, cancelled: false });
    await expect(promise).resolves.toEqual({
      username: "u",
      password: "p",
      save: true,
      cancelled: false,
    });

    // Single use: the same request id no longer resolves.
    expect(
      reg.consume({ requestId: request.requestId, conversationId: "conv-1" })
    ).toBeNull();
  });

  it("rejects a submission from a different conversation", () => {
    const reg = getCredentialCardWaitRegistry();
    const { request } = reg.create({
      conversationId: "conv-2",
      sessionId: "mb_signin0001",
      siteId: 42,
      siteDomain: "example.test",
      mode: "login",
      prefillUsername: null,
    });
    expect(
      reg.consume({ requestId: request.requestId, conversationId: "conv-OTHER" })
    ).toBeNull();
  });
});

describe("BrowserCredentialLoginService no-account path (A-AC-05)", () => {
  it("waits for the card, saves through the encrypted path, and signs in", async () => {
    const reg = getCredentialCardWaitRegistry();
    const service = new BrowserCredentialLoginService();
    const pendingPromise = service.signIn({
      sessionId: "mb_signin0001",
      conversationId: "conv-card",
      intent: "login",
    });
    // Let the service reach the card wait, then submit through the registry.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pending = reg.listForConversation("conv-card");
    expect(pending).toHaveLength(1);
    const consumed = reg.consume({
      requestId: pending[0]!.requestId,
      conversationId: "conv-card",
    });
    consumed!.resolve({
      username: "newuser@example.test",
      password: "sentinel-card-password",
      save: true,
      cancelled: false,
    });
    const result = await pendingPromise;
    expect(result.status).toBe("signed_in");
    expect(result.username).toBe("newuser@example.test");
    // A-AC-05: the password reached the (mocked) encrypted storage path and
    // appears nowhere in the result object.
    expect(savedCredentials).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("sentinel-card-password");
  });

  it("surfaces a cancelled card as handoff_required", async () => {
    const reg = getCredentialCardWaitRegistry();
    const service = new BrowserCredentialLoginService();
    const pendingPromise = service.signIn({
      sessionId: "mb_signin0001",
      conversationId: "conv-cancel",
      intent: "login",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pending = reg.listForConversation("conv-cancel");
    const consumed = reg.consume({
      requestId: pending[0]!.requestId,
      conversationId: "conv-cancel",
    });
    consumed!.resolve({ username: "", password: "", save: false, cancelled: true });
    const result = await pendingPromise;
    expect(result.status).toBe("handoff_required");
    expect(result.reasonCode).toBe("user_cancelled");
    expect(failures).toHaveLength(0);
  });
});

describe("F12 attempt reservation, stop-vs-cancel, refusal reasons", () => {
  beforeEach(() => {
    fakeAccounts.length = 0;
    fakeCredential = { ok: false as const, reason: "credential_unavailable" as const };
    fakeCoolingDown = () => false;
  });

  it("reserves the account BEFORE the awaited cooldown check (no TOCTOU)", async () => {
    fakeAccounts.push({ id: 101, user: "user@example.test" });
    fakeCredential = {
      ok: true as const,
      username: "user@example.test",
      password: "sentinel-f12-password",
    };
    // The cooldown check awaits — a concurrent caller must already see the
    // reservation.
    let coolingChecks = 0;
    fakeCoolingDown = () => {
      coolingChecks++;
      // An awaited (non-settled) cooldown check: the first attempt parks
      // here, so the reservation is genuinely held when the second
      // concurrent call arrives.
      return new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 150)
      );
    };
    const reg = getCredentialCardWaitRegistry();
    const service = new BrowserCredentialLoginService();
    const first = service.signIn({
      sessionId: "mb_signin0001",
      conversationId: "conv-race",
      intent: "login",
      accountId: 101,
    });
    // Give the first attempt time to reserve and reach the cooldown await —
    // poll (bounded) instead of a fixed sleep so CI load cannot flake it.
    for (
      let waited = 0;
      coolingChecks === 0 && waited < 5_000;
      waited += 25
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(coolingChecks).toBeGreaterThan(0);
    // The second concurrent attempt hits the SYNCHRONOUS reservation.
    const second = await service.signIn({
      sessionId: "mb_signin0002",
      conversationId: "conv-race-2",
      intent: "login",
      accountId: 101,
    });
    expect(second.status).toBe("failed");
    expect(second.reasonCode).toBe("cooldown");
    // Let the first attempt finish (username-only card would block; the
    // credential is complete so it fills directly).
    const firstResult = await first;
    expect(firstResult.status).toBe("signed_in");
    void reg;
  });

  it("a domain refusal is a failed sign-in — never a password card", async () => {
    fakeAccounts.push({ id: 101, user: "user@example.test" });
    fakeCredential = { ok: false as const, reason: "domain_mismatch" as const };
    const reg = getCredentialCardWaitRegistry();
    const service = new BrowserCredentialLoginService();
    const result = await service.signIn({
      sessionId: "mb_signin0001",
      conversationId: "conv-domain",
      intent: "login",
      accountId: 101,
    });
    expect(result.status).toBe("failed");
    expect(result.reasonCode).toBe("domain_mismatch");
    // No card was posted for the session.
    expect(reg.listForConversation("conv-domain")).toHaveLength(0);
  });

  it("a STOP during the card wait terminates without opening a handoff", async () => {
    const reg = getCredentialCardWaitRegistry();
    const service = new BrowserCredentialLoginService();
    const controller = new AbortController();
    const pendingPromise = service.signIn({
      sessionId: "mb_signin0001",
      conversationId: "conv-stop",
      intent: "login",
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pending = reg.listForConversation("conv-stop");
    expect(pending).toHaveLength(1);
    controller.abort(); // Stop resolves the card wait as cancelled
    const result = await pendingPromise;
    expect(result.status).toBe("failed");
    expect(result.reasonCode).toBe("cancelled");
    // A Stop never opens the handoff dialog.
    const { getDefaultManagedBrowserModule } = await import(
      "@/modules/ManagedBrowserModule"
    );
    const module = getDefaultManagedBrowserModule() as unknown as {
      requestHandoff: ReturnType<typeof vi.fn>;
    };
    expect(module.requestHandoff).not.toHaveBeenCalled();
  });
});
