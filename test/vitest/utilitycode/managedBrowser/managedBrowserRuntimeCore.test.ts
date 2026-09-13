import { describe, expect, it } from "vitest";

import {
  convertCookie,
  convertCookieBatch,
  fromCapturedCookie,
  matchesDomainSuffix,
} from "@/childprocess/managed-browser/cookieTransfer";
import {
  evaluateNavigationTarget,
  isLoopbackHost,
  isPrivateHost,
  sanitizeUrlForReport,
} from "@/childprocess/managed-browser/NavigationPolicy";
import {
  ManagedBrowserRuntime,
  assertCommandAllowed,
  isTransitionAllowed,
} from "@/childprocess/managed-browser/ManagedBrowserRuntime";
import {
  budgetName,
  isLikelySecretKey,
  isLikelySecretValue,
  redactSecrets,
  summarizeInputValue,
  toSafeErrorMessage,
} from "@/childprocess/managed-browser/ResultSanitizer";
import {
  classifyChallengeFlow,
  detectChallengeFromSignals,
  type ChallengeSignals,
} from "@/childprocess/managed-browser/ChallengeDetector";
import type { NormalizedCookie } from "@/schemas/accountCookies";

// ---------------------------------------------------------------------------
// Cookie conversion (design §13.1)
// ---------------------------------------------------------------------------

function cookie(overrides: Partial<NormalizedCookie> = {}): NormalizedCookie {
  return {
    domain: "youtube.com",
    path: "/",
    name: "SID",
    value: "synthetic-value",
    secure: true,
    httpOnly: true,
    ...overrides,
  };
}

describe("cookieTransfer", () => {
  it("preserves name, value, path, secure, httpOnly, expiry", () => {
    const outcome = convertCookie(
      cookie({ expirationDate: 4102444800, sameSite: "lax" })
    );
    if (!outcome.ok) throw new Error("expected conversion");
    expect(outcome.cookie.name).toBe("SID");
    expect(outcome.cookie.value).toBe("synthetic-value");
    expect(outcome.cookie.expires).toBe(4102444800);
    expect(outcome.cookie.sameSite).toBe("Lax");
  });

  it("maps SameSite variants per the design table", () => {
    const none = convertCookie(cookie({ sameSite: "no_restriction" }));
    expect(none.ok).toBe(true);
    if (none.ok) {
      expect(none.cookie.sameSite).toBe("None");
    }
    const strict = convertCookie(cookie({ sameSite: "strict" }));
    expect(strict.ok).toBe(true);
    if (strict.ok) {
      expect(strict.cookie.sameSite).toBe("Strict");
    }
    // Unspecified: omit so Chrome uses native behavior.
    const unspecified = convertCookie(cookie({ sameSite: "unspecified" }));
    expect(unspecified.ok).toBe(true);
    if (unspecified.ok) {
      expect("sameSite" in unspecified.cookie).toBe(false);
    }
  });

  it("uses a constructed URL for host-only cookies (no domain downgrade)", () => {
    const outcome = convertCookie(cookie({ hostOnly: true }));
    if (!outcome.ok) throw new Error("expected conversion");
    expect(outcome.cookie.url).toBe("https://youtube.com/");
    expect("domain" in outcome.cookie).toBe(false);
  });

  it("omits expiry for session cookies", () => {
    const outcome = convertCookie(cookie({}));
    expect(outcome.ok && "expires" in outcome.cookie).toBe(false);
  });

  it("one malformed cookie does not block the batch (FR-COOKIE-014)", () => {
    const batch = convertCookieBatch([
      cookie({ name: "A", domain: "youtube.com" }),
      cookie({ name: "", domain: "" }),
      cookie({ name: "B", domain: "google.com" }),
    ]);
    expect(batch.accepted).toHaveLength(2);
    expect(batch.rejectedCount).toBe(1);
    expect(batch.rejectReasonTallies["missing_name_or_domain"]).toBe(1);
  });

  it("round-trips captured Puppeteer cookies back to normalized form", () => {
    const normalized = fromCapturedCookie({
      name: "SID",
      value: "v",
      domain: ".youtube.com",
      path: "/",
      secure: true,
      httpOnly: true,
      expires: 4102444800,
      sameSite: "None",
    });
    expect(normalized).toMatchObject({
      domain: "youtube.com",
      sameSite: "no_restriction",
      expirationDate: 4102444800,
    });
    expect(fromCapturedCookie({ name: "X", value: "v" })).toBeNull();
  });

  it("matches domains suffix-exactly (not-google.com never matches)", () => {
    const allowed = ["youtube.com", "google.com"];
    expect(matchesDomainSuffix("youtube.com", allowed)).toBe(true);
    expect(matchesDomainSuffix("accounts.google.com", allowed)).toBe(true);
    expect(matchesDomainSuffix("not-google.com", allowed)).toBe(false);
    expect(matchesDomainSuffix("google.com.evil.io", allowed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Navigation policy (design §12.2)
// ---------------------------------------------------------------------------

const platformOptions = {
  allowedOrigins: ["youtube.com", "google.com", "accounts.google.com"],
};

describe("NavigationPolicy", () => {
  it("allows https platform origins and their subdomains", () => {
    expect(
      evaluateNavigationTarget(
        "https://www.youtube.com/watch?v=x",
        platformOptions
      ).allowed
    ).toBe(true);
    expect(
      evaluateNavigationTarget(
        "https://accounts.google.com/signin",
        platformOptions
      ).allowed
    ).toBe(true);
  });

  it("blocks cross-origin https targets", () => {
    const decision = evaluateNavigationTarget(
      "https://evil.example.com/clickjack",
      platformOptions
    );
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reasonCode).toBe(
      "cross_origin_not_allowed"
    );
  });

  it("blocks every dangerous scheme", () => {
    for (const url of [
      "file:///etc/passwd",
      "data:text/html,hi",
      "javascript:alert(1)",
      "blob:https://youtube.com/x",
      "chrome://settings",
      "devtools://devtools/bundled/inspector.html",
      "chrome-extension://abc/popup.html",
    ]) {
      expect(evaluateNavigationTarget(url, platformOptions).allowed).toBe(
        false
      );
    }
  });

  it("blocks private/link-local/metadata literals over https", () => {
    for (const url of [
      "https://192.168.1.1/admin",
      "https://10.0.0.5/",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/",
      "https://localhost/",
    ]) {
      const decision = evaluateNavigationTarget(url, platformOptions);
      expect(decision.allowed).toBe(false);
    }
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });

  it("permits http loopback only in fixture mode", () => {
    expect(
      evaluateNavigationTarget("http://127.0.0.1:4567/fixture", {
        ...platformOptions,
        allowLoopbackFixtures: true,
      }).allowed
    ).toBe(true);
    expect(
      evaluateNavigationTarget("http://127.0.0.1:4567/fixture", platformOptions)
        .allowed
    ).toBe(false);
    expect(
      evaluateNavigationTarget("http://youtube.com/", {
        ...platformOptions,
        allowLoopbackFixtures: true,
      }).allowed
    ).toBe(false);
  });

  it("sanitizes URLs for reporting (no credentials/query/fragment)", () => {
    expect(
      sanitizeUrlForReport(
        "https://user:pass@www.youtube.com/watch?v=secret&t=1#top"
      )
    ).toBe("https://www.youtube.com/watch");
  });
});

// ---------------------------------------------------------------------------
// Runtime state machine (design §9)
// ---------------------------------------------------------------------------

describe("ManagedBrowserRuntime state guards", () => {
  it("rejects actions while the user has control (FR-HANDOFF-002)", () => {
    const userControlStates = [
      "login_required",
      "user_login_in_progress",
      "handoff",
    ] as const;
    for (const state of userControlStates) {
      const result = assertCommandAllowed(state, "RUN_ACTIONS");
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.errorCode).toBe("user_has_control");
    }
  });

  it("rejects actions during a challenge", () => {
    const result = assertCommandAllowed("challenge_detected", "RUN_ACTIONS");
    expect(result.ok === false && result.errorCode).toBe(
      "challenge_in_progress"
    );
  });

  it("allows observe in ready/running/awaiting_approval/handoff only", () => {
    const observeStates = [
      "ready",
      "running",
      "awaiting_approval",
      "handoff",
    ] as const;
    for (const state of observeStates) {
      expect(assertCommandAllowed(state, "OBSERVE").ok).toBe(true);
    }
    const deniedStates = [
      "starting",
      "login_required",
      "stopped",
      "failed",
    ] as const;
    for (const state of deniedStates) {
      expect(assertCommandAllowed(state, "OBSERVE").ok).toBe(false);
    }
  });

  it("stop is valid in every state", () => {
    for (const state of [
      "starting",
      "ready",
      "user_login_in_progress",
      "challenge_resolving",
      "stopping",
      "failed",
    ] as const) {
      expect(assertCommandAllowed(state, "STOP_SESSION").ok).toBe(true);
    }
  });

  it("manual-login verification is only valid from user_login_in_progress", () => {
    expect(
      assertCommandAllowed("user_login_in_progress", "VERIFY_MANUAL_LOGIN").ok
    ).toBe(true);
    expect(assertCommandAllowed("handoff", "VERIFY_MANUAL_LOGIN").ok).toBe(
      false
    );
  });
});

describe("ManagedBrowserRuntime transitions", () => {
  it("follows the happy path exactly", () => {
    const events: string[] = [];
    const runtime = new ManagedBrowserRuntime("starting", (e) =>
      events.push(`${e.from}->${e.to}`)
    );
    expect(runtime.transition("validating_fingerprint")).toBe(true);
    expect(runtime.transition("applying_session")).toBe(true);
    expect(runtime.transition("verifying_login")).toBe(true);
    expect(runtime.transition("ready")).toBe(true);
    expect(runtime.transition("running")).toBe(true);
    expect(runtime.getState()).toBe("running");
    expect(events).toHaveLength(5);
  });

  it("supports the login handoff loop", () => {
    const runtime = new ManagedBrowserRuntime("verifying_login");
    expect(runtime.transition("login_required")).toBe(true);
    expect(runtime.transition("user_login_in_progress")).toBe(true);
    expect(runtime.transition("verifying_manual_login")).toBe(true);
    // verification failed -> back to user control
    expect(runtime.transition("user_login_in_progress")).toBe(true);
    expect(runtime.transition("verifying_manual_login")).toBe(true);
    expect(runtime.transition("ready")).toBe(true);
  });

  it("rejects invalid jumps and keeps state", () => {
    const runtime = new ManagedBrowserRuntime("starting");
    expect(runtime.transition("ready")).toBe(false);
    expect(runtime.getState()).toBe("starting");
  });

  it("any live state may stop or fail; stopped is terminal", () => {
    expect(isTransitionAllowed("running", "stopping").ok).toBe(true);
    expect(isTransitionAllowed("user_login_in_progress", "failed").ok).toBe(
      true
    );
    expect(isTransitionAllowed("failed", "stopping").ok).toBe(true);
    expect(isTransitionAllowed("stopping", "stopped").ok).toBe(true);
    expect(isTransitionAllowed("stopped", "ready").ok).toBe(false);
    expect(isTransitionAllowed("stopped", "starting").ok).toBe(false);
  });

  it("maintains a monotonic page revision", () => {
    const runtime = new ManagedBrowserRuntime("ready");
    expect(runtime.bumpRevision()).toBe(1);
    expect(runtime.bumpRevision()).toBe(2);
    expect(runtime.pageRevision).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Result sanitizer (design §16.4)
// ---------------------------------------------------------------------------

describe("ResultSanitizer", () => {
  it("flags secret keys", () => {
    for (const key of [
      "cookie",
      "Authorization",
      "access_token",
      "password",
      "apiKey".toLowerCase(),
      "sessionid",
    ]) {
      expect(isLikelySecretKey(key)).toBe(true);
    }
    expect(isLikelySecretKey("title")).toBe(false);
    expect(isLikelySecretKey("href")).toBe(false);
  });

  it("flags secret-shaped values", () => {
    expect(isLikelySecretValue("Bearer abcdefghijklmnop")).toBe(true);
    expect(
      isLikelySecretValue("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig")
    ).toBe(true);
    expect(isLikelySecretValue("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6")).toBe(true);
    expect(isLikelySecretValue("Search")).toBe(false);
    expect(isLikelySecretValue("Watch history")).toBe(false);
  });

  it("redacts planted canary secrets recursively", () => {
    const planted = "CANARY-SECRET-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
    const out = redactSecrets({
      title: "fine",
      cookie: planted,
      nested: { token: planted, note: "keep" },
      list: [planted, "ok"],
    }) as Record<string, unknown>;
    expect(out.title).toBe("fine");
    expect(out.cookie).toBe("[redacted]");
    const nested = out.nested as Record<string, unknown>;
    expect(nested.token).toBe("[redacted]");
    expect(nested.note).toBe("keep");
    expect(Array.isArray(out.list) && out.list[0]).toBe("[redacted]");
  });

  it("masks password-like input summaries entirely", () => {
    expect(summarizeInputValue("hunter2!", "password")).toBe("[password-like]");
    expect(summarizeInputValue("hello world", "text")).toBe("hello world");
    expect(summarizeInputValue(undefined, "text")).toBeUndefined();
  });

  it("budgets names and error messages", () => {
    expect(budgetName("x".repeat(500))).toHaveLength(200);
    expect(toSafeErrorMessage(new Error("x".repeat(1000)))).toHaveLength(200);
    expect(toSafeErrorMessage("boom")).toBe("boom");
  });
});

// ---------------------------------------------------------------------------
// Challenge detector (design §18.3 detection only)
// ---------------------------------------------------------------------------

function signals(overrides: Partial<ChallengeSignals> = {}): ChallengeSignals {
  return {
    url: "https://www.youtube.com/watch",
    title: "Some video",
    visibleTextSample: "Like Dislike Comment",
    inputTypes: [],
    ...overrides,
  };
}

describe("ChallengeDetector", () => {
  it("detects image CAPTCHAs from URL and text markers", () => {
    const result = detectChallengeFromSignals(
      signals({ url: "https://www.youtube.com/recaptcha-challenge" })
    );
    expect(result?.kind).toBe("captcha_image");
    expect(result?.evidenceCodes).toContain("url_captcha_marker");
  });

  it("detects human-verification text", () => {
    const result = detectChallengeFromSignals(
      signals({ visibleTextSample: "Please verify you're not a robot" })
    );
    expect(result?.kind).toBe("captcha_image");
  });

  it("classifies OTP / password / passkey prompts", () => {
    expect(
      detectChallengeFromSignals(signals({ inputTypes: ["otp"] }))?.kind
    ).toBe("otp");
    expect(
      detectChallengeFromSignals(signals({ inputTypes: ["password"] }))?.kind
    ).toBe("password");
    expect(
      detectChallengeFromSignals(
        signals({ visibleTextSample: "Use your passkey to continue" })
      )?.kind
    ).toBe("passkey");
  });

  it("returns null for ordinary pages", () => {
    expect(detectChallengeFromSignals(signals())).toBeNull();
  });

  it("classifies login/security/payment flows as sensitive", () => {
    expect(
      classifyChallengeFlow(
        signals({ url: "https://accounts.google.com/signin/challenge" })
      )
    ).toBe("login");
    expect(
      classifyChallengeFlow(signals({ title: "Checkout — payment method" }))
    ).toBe("payment");
    expect(
      classifyChallengeFlow(
        signals({ visibleTextSample: "verify your identity 2fa" })
      )
    ).toBe("security");
    expect(classifyChallengeFlow(signals())).toBe("unknown");
  });
});
