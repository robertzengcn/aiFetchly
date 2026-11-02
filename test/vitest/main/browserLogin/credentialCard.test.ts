import { describe, expect, it, vi } from "vitest";
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
        return [];
      }
      async isSignInCoolingDown() {
        return false;
      }
      async getCredentialForLogin() {
        return null;
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
