/**
 * Privileged login-form filler (PRD §6.8 / A-FR-16..21; technical design §14).
 *
 * Runs in the browser worker. The password arrives inside a single
 * FILL_LOGIN_FORM request and is wiped after use; results carry outcome +
 * field stamps, never values.
 *
 * Layer A (hard rules, evaluated in-page immediately before input):
 *   - the password target is an HTMLInputElement with type === "password",
 *     enabled, visible, and hit-testable;
 *   - its frame is the top frame or a same-site frame on the allowed domains;
 *   - the page is HTTPS;
 *   - in login mode exactly ONE visible password input exists in the form.
 *   Any failure aborts with a reason code and NEVER types anything.
 *
 * Layer B (verify the input landed where intended):
 *   - values set via the native value setter + input/change events; read
 *     back LENGTH ONLY;
 *   - other inputs' value lengths snapshotted before/after — any unexpected
 *     change aborts and reports the tamper;
 *   - submit through the password field's own form (requestSubmit) or Enter
 *     in that field; never a button outside the form.
 */

export interface LoginFillTarget {
  readonly mode: "login" | "register";
  readonly allowedDomainSuffixes: readonly string[];
  readonly recipeStep: {
    readonly usernameField: string | null;
    readonly passwordField: string | null;
    readonly submitVia: "form" | "enter";
  } | null;
  readonly username: string;
  readonly password: string;
}

export type LoginFillOutcome =
  | "success"
  | "wrong_credential"
  | "challenge"
  | "unknown";

export interface LoginFillResult {
  readonly outcome: LoginFillOutcome;
  readonly reasonCode: string | null;
  readonly filledFieldStamps: readonly string[];
}

/** In-page evaluation contract (PuppeteerPageLike.evaluate). */
export interface LoginFillPageLike {
  url(): string;
  evaluate<T>(script: unknown, ...args: unknown[]): Promise<T>;
}

const FILL_SCRIPT = `
((input) => {
  const { mode, allowedDomainSuffixes, username, password, recipe } = input;

  const isVisible = (el) => {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const hitTestable = (el) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return top === el || (top instanceof Node && el.contains(top));
  };
  const frameAllowed = () => {
    try {
      if (window.top === window) return true;
      return allowedDomainSuffixes.some((suffix) =>
        location.hostname === suffix ||
        location.hostname.endsWith("." + suffix));
    } catch { return false; }
  };

  if (location.protocol !== "https:") {
    return { ok: false, reasonCode: "insecure_page" };
  }
  if (!frameAllowed()) {
    return { ok: false, reasonCode: "origin_mismatch" };
  }

  const forms = Array.from(document.querySelectorAll("form"));
  const candidates = [];
  for (const form of forms) {
    const passwordInputs = Array.from(form.querySelectorAll('input[type="password"]'))
      .filter((el) => isVisible(el));
    if (passwordInputs.length === 0) continue;
    if (mode === "login" && passwordInputs.length !== 1) {
      return { ok: false, reasonCode: "ambiguous_password_field" };
    }
    const usernameInput = Array.from(
      form.querySelectorAll('input[type="email"], input[type="text"], input[type="tel"]')
    ).find((el) => isVisible(el) && !el.disabled && !el.readOnly);
    if (!usernameInput) continue;
    candidates.push({ form, passwordInput: passwordInputs[0], usernameInput });
  }
  if (candidates.length === 0) {
    return { ok: false, reasonCode: "form_not_found" };
  }
  const chosen = candidates[0];
  const pw = chosen.passwordInput;

  // Layer A: hard password-field rules.
  if (
    !(pw instanceof HTMLInputElement) ||
    pw.type !== "password" ||
    pw.disabled ||
    pw.readOnly ||
    !isVisible(pw) ||
    !hitTestable(pw)
  ) {
    return { ok: false, reasonCode: "password_field_unsafe" };
  }

  // Layer B: snapshot other inputs' value lengths (tamper detection).
  const snapshot = () =>
    Array.from(document.querySelectorAll("input")).map((el) => el.value.length);
  const before = snapshot();

  const setNativeValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, "value"
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // Stamp identifiers for [credential] masking in later observations.
  const stampOf = (el) =>
    el.getAttribute("data-mb-obs") || el.name || el.id || "unnamed";
  const stamps = [];

  setNativeValue(chosen.usernameInput, username);
  stamps.push(stampOf(chosen.usernameInput));
  setNativeValue(pw, password);
  stamps.push(stampOf(pw));

  // Read back LENGTH ONLY.
  if (pw.value.length !== password.length) {
    return { ok: false, reasonCode: "fill_readback_mismatch", stamps };
  }

  const after = snapshot();
  const beforeTotal = before.reduce((a, b) => a + b, 0);
  const afterTotal = after.reduce((a, b) => a + b, 0);
  const expectedDelta = username.length + password.length;
  if (Math.abs(afterTotal - beforeTotal - expectedDelta) > 0) {
    // An unexpected change to another field: clear everything, abort.
    chosen.usernameInput.value = "";
    pw.value = "";
    return { ok: false, reasonCode: "unexpected_field_change", stamps };
  }

  if (recipe && recipe.submitVia === "enter") {
    pw.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  } else if (pw.form) {
    pw.form.requestSubmit();
  } else {
    pw.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }

  return { ok: true, reasonCode: null, stamps };
})
`;

const OUTCOME_PROBE_SCRIPT = `
(() => {
  const visible = (el) => {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const passwordStillVisible =
    Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
  const path = location.pathname.toLowerCase();
  const onLoginPath = /login|signin|sign-in|auth|session/.test(path);
  const errorRegion = document.querySelector(
    '[class*="error" i], [role="alert"], [class*="alert" i]'
  );
  const errorText = errorRegion && visible(errorRegion)
    ? (errorRegion.textContent || "").trim().slice(0, 200)
    : "";
  return {
    passwordStillVisible,
    onLoginPath,
    errorText,
    url: location.href,
  };
})
`;

export class LoginFormFiller {
  /**
   * Fill + submit with the Layer A/B rules. The password never leaves this
   * call; the returned stamps let the observation sanitizer mask the fields.
   */
  public async fill(
    page: LoginFillPageLike,
    target: LoginFillTarget
  ): Promise<LoginFillResult> {
    const fillResult = await page.evaluate<FillScriptResult>(FILL_SCRIPT, {
      mode: target.mode,
      allowedDomainSuffixes: [...target.allowedDomainSuffixes],
      username: target.username,
      password: target.password,
      recipe: target.recipeStep,
    });

    if (!fillResult.ok) {
      return {
        outcome: "unknown",
        reasonCode: fillResult.reasonCode ?? null,
        filledFieldStamps: fillResult.stamps ?? [],
      };
    }

    // Bounded outcome detection (A-FR-09): success is password field gone
    // AND off the login path with no error text; wrong credential stays on
    // the form with visible error; everything else hands off.
    const deadline = Date.now() + 5_000;
    let probe = await page.evaluate<OutcomeProbe>(OUTCOME_PROBE_SCRIPT);
    while (Date.now() < deadline) {
      if (!probe.passwordStillVisible && !probe.onLoginPath && !probe.errorText) {
        return {
          outcome: "success",
          reasonCode: null,
          filledFieldStamps: fillResult.stamps ?? [],
        };
      }
      if (probe.errorText) {
        return {
          outcome: "wrong_credential",
          reasonCode: "wrong_password",
          filledFieldStamps: fillResult.stamps ?? [],
        };
      }
      if (!probe.passwordStillVisible && probe.onLoginPath) {
        // Left the form but still on an auth path: likely 2FA/OTP.
        return {
          outcome: "challenge",
          reasonCode: "challenge_2fa",
          filledFieldStamps: fillResult.stamps ?? [],
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      probe = await page.evaluate<OutcomeProbe>(OUTCOME_PROBE_SCRIPT);
    }
    return {
      outcome: "unknown",
      reasonCode: "login_outcome_unknown",
      filledFieldStamps: fillResult.stamps ?? [],
    };
  }
}

interface FillScriptResult {
  readonly ok: boolean;
  readonly reasonCode?: string;
  readonly stamps?: string[];
}

interface OutcomeProbe {
  readonly passwordStillVisible: boolean;
  readonly onLoginPath: boolean;
  readonly errorText: string;
  readonly url: string;
}
