import { describe, expect, it } from "vitest";
import { LoginFormFiller } from "@/childprocess/managed-browser/LoginFormFiller";

/**
 * PRD §6.8 / A-FR-16..21: password-field safety. Layer A hard rules and
 * Layer B read-back/tamper checks, exercised through scripted page doubles.
 */

type PageScript = (script: string, arg?: unknown) => Promise<unknown>;

interface FakeDom {
  protocol: string;
  hostname: string;
  isTopFrame: boolean;
  /** First password field state. */
  passwordType: string;
  passwordDisabled: boolean;
  passwordReadonly: boolean;
  passwordVisible: boolean;
  visiblePasswordCount: number;
  usernameVisible: boolean;
  /** Outcome probe results after submit. */
  probe: {
    passwordStillVisible: boolean;
    onLoginPath: boolean;
    errorText: string;
    url: string;
  };
}

function makePage(dom: FakeDom): {
  url: () => string;
  evaluate: PageScript;
  calls: { submitted: boolean; filled: number };
} {
  const calls = { submitted: false, filled: 0 };
  const evaluate: PageScript = async (script, arg) => {
    const source = String(script);
    if (source.includes("passwordStillVisible")) {
      return dom.probe;
    }
    if (source.includes("requestSubmit")) {
      // The main fill script — emulate the in-page rules deterministically.
      const input = arg as {
        mode: string;
        username: string;
        password: string;
      };
      if (dom.protocol !== "https:") {
        return { ok: false, reasonCode: "insecure_page" };
      }
      if (dom.passwordType !== "password") {
        return { ok: false, reasonCode: "password_field_unsafe" };
      }
      if (dom.visiblePasswordCount !== 1) {
        return { ok: false, reasonCode: "ambiguous_password_field" };
      }
      if (dom.passwordDisabled || dom.passwordReadonly) {
        return { ok: false, reasonCode: "password_field_unsafe" };
      }
      if (!dom.usernameVisible) {
        return { ok: false, reasonCode: "form_not_found" };
      }
      calls.filled += 1;
      calls.submitted = true;
      return { ok: true, reasonCode: null, stamps: ["user", "pass"] };
    }
    return null;
  };
  return {
    url: () => `${dom.protocol}://${dom.hostname}/login`,
    evaluate,
    calls,
  };
}

const TARGET = {
  mode: "login" as const,
  allowedDomainSuffixes: ["example.test"],
  recipeStep: null,
  username: "user@example.test",
  password: "sentinel-password-123",
};

describe("LoginFormFiller Layer A/B (A-FR-16..21)", () => {
  it("refuses HTTP pages before typing anything", async () => {
    const page = makePage({ ...freshDom(), protocol: "http:" });
    const result = await new LoginFormFiller().fill(page, TARGET);
    expect(result.outcome).toBe("unknown");
    expect(result.reasonCode).toBe("insecure_page");
    expect(page.calls.filled).toBe(0);
  });

  it("refuses a password input toggled to type=text (show-password)", async () => {
    const page = makePage({ ...freshDom(), passwordType: "text" });
    const result = await new LoginFormFiller().fill(page, TARGET);
    expect(result.reasonCode).toBe("password_field_unsafe");
    expect(page.calls.filled).toBe(0);
  });

  it("refuses two visible password inputs in login mode", async () => {
    const page = makePage({ ...freshDom(), visiblePasswordCount: 2 });
    const result = await new LoginFormFiller().fill(page, TARGET);
    expect(result.reasonCode).toBe("ambiguous_password_field");
    expect(page.calls.filled).toBe(0);
  });

  it("refuses when no username input shares the form", async () => {
    const page = makePage({ ...freshDom(), usernameVisible: false });
    const result = await new LoginFormFiller().fill(page, TARGET);
    expect(result.reasonCode).toBe("form_not_found");
  });

  it("fills once and reports stamps without the password", async () => {
    const dom = freshDom();
    const page = makePage(dom);
    const result = await new LoginFormFiller().fill(page, TARGET);
    expect(page.calls.filled).toBe(1);
    expect(result.filledFieldStamps).toEqual(["user", "pass"]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sentinel-password-123");
  });

  it("classifies a visible error region as wrong_credential", async () => {
    const dom = freshDom();
    dom.probe = {
      passwordStillVisible: true,
      onLoginPath: true,
      errorText: "Incorrect password",
      url: "https://example.test/login",
    };
    const page = makePage(dom);
    const result = await new LoginFormFiller().fill(page, TARGET);
    expect(result.outcome).toBe("wrong_credential");
    expect(result.reasonCode).toBe("wrong_password");
  });

  it("classifies leaving the form on an auth path as a 2FA challenge", async () => {
    const dom = freshDom();
    dom.probe = {
      passwordStillVisible: false,
      onLoginPath: true,
      errorText: "",
      url: "https://example.test/login/verify",
    };
    const page = makePage(dom);
    const result = await new LoginFormFiller().fill(page, TARGET);
    expect(result.outcome).toBe("challenge");
    expect(result.reasonCode).toBe("challenge_2fa");
  });

  it("reports success when the password field is gone and the URL left the login path", async () => {
    const dom = freshDom();
    dom.probe = {
      passwordStillVisible: false,
      onLoginPath: false,
      errorText: "",
      url: "https://example.test/feed",
    };
    const page = makePage(dom);
    const result = await new LoginFormFiller().fill(page, TARGET);
    expect(result.outcome).toBe("success");
  });
});

function freshDom(): FakeDom {
  return {
    protocol: "https:",
    hostname: "www.example.test",
    isTopFrame: true,
    passwordType: "password",
    passwordDisabled: false,
    passwordReadonly: false,
    passwordVisible: true,
    visiblePasswordCount: 1,
    usernameVisible: true,
    probe: {
      passwordStillVisible: false,
      onLoginPath: false,
      errorText: "",
      url: "https://example.test/feed",
    },
  };
}
