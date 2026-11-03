/**
 * Privileged login-form filler (PRD §6.8 / A-FR-16..21; technical design §14).
 *
 * Runs in the browser worker. The password arrives inside a single
 * FILL_LOGIN_FORM request and is wiped after use; results carry outcome +
 * field stamps, never values.
 *
 * The page scripts below are REAL FUNCTIONS (not string-encoded function
 * expressions): Puppeteer serializes a passed function and invokes it with
 * the serializable argument, so the body always executes (T02).
 *
 * Layer A (hard rules, evaluated in-page immediately before input):
 *   - the page is HTTPS;
 *   - EVERY frame that receives a value — including the top frame — is on
 *     one of the site's allowed domains;
 *   - the password target is an HTMLInputElement with type === "password",
 *     enabled, visible, and hit-testable;
 *   - in login mode exactly ONE visible password input exists in the form.
 *
 * Layer B (verify the input landed where intended — T03/T04):
 *   - the password target is REVALIDATED (type, enabled/readonly, visible,
 *     hit-test, same-form identity) AFTER the username set, because page
 *     input/change handlers can mutate or replace it synchronously;
 *   - values set via the native value setter + input/change events; read
 *     back LENGTH ONLY, per field;
 *   - every OTHER input's length is compared independently (a prefilled
 *     username cannot fail the fill, and equal-and-opposite changes cannot
 *     evade detection); any unexpected change clears EVERY affected field;
 *   - readback mismatch clears the touched fields before aborting;
 *   - submit through the password field's own form (requestSubmit with
 *     focus checks) — never a control outside the form.
 */

export interface LoginFillTarget {
  readonly mode: "login" | "register";
  readonly allowedDomainSuffixes: readonly string[];
  readonly recipeStep: {
    readonly usernameField: string | null;
    readonly passwordField: string | null;
    readonly submitVia: "form" | "enter";
  } | null;
  /** T21: top-level recipe fingerprints (used by the page function). */
  readonly usernameField?: string | null;
  readonly passwordField?: string | null;
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
  /** T21: learned-recipe payload (form action + field fingerprints). */
  readonly recipe?: {
    formAction: string | null;
    usernameField: string;
    passwordField: string;
  };
}

export interface LoginFillPageLike {
  url(): string;
  evaluate<T>(script: unknown, ...args: unknown[]): Promise<T>;
}

/**
 * The fill body. Passed to page.evaluate as a FUNCTION with one
 * serializable payload — never as a bare string expression (T02).
 */
export function fillLoginPageFunction(input: {
  mode: "login" | "register";
  allowedDomainSuffixes: string[];
  username: string;
  password: string;
  submitVia: "form" | "enter";
  /** T21: saved recipe field fingerprints (name/id/autocomplete). */
  usernameField?: string | null;
  passwordField?: string | null;
  /** T21: the username round already submitted (two-step login step 2). */
  usernameFilled?: boolean;
}): {
  ok: boolean;
  reasonCode?: string | null;
  stamps?: string[];
  /** T21: form action for recipe learning. */
  formAction?: string | null;
  filledFields?: { username: string; password: string };
  usernameOnlySubmitted?: boolean;
} {
  const isVisible = (el: Element): boolean => {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const hitTestable = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return top === el || (top instanceof Node && el.contains(top));
  };
  const hostAllowed = (): boolean =>
    input.allowedDomainSuffixes.some(
      (suffix) =>
        location.hostname === suffix ||
        location.hostname.endsWith("." + suffix)
    );
  const passwordSafe = (pw: HTMLInputElement): boolean =>
    pw instanceof HTMLInputElement &&
    pw.type === "password" &&
    !pw.disabled &&
    !pw.readOnly &&
    isVisible(pw) &&
    hitTestable(pw);

  // Layer A: page-level rules BEFORE anything is typed.
  if (location.protocol !== "https:") {
    return { ok: false, reasonCode: "insecure_page" };
  }
  // T03: the TOP frame is also an input frame — it must be on-domain.
  if (!hostAllowed()) {
    return { ok: false, reasonCode: "origin_mismatch" };
  }

  const stampOf = (el: HTMLInputElement): string =>
    el.getAttribute("data-mb-obs") || el.name || el.id || "unnamed";
  const setNativeValue = (el: HTMLInputElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const stamps: string[] = [];

  const forms = Array.from(document.querySelectorAll("form"));
  const candidates: Array<{
    form: HTMLFormElement;
    passwordInput: HTMLInputElement;
    usernameInput: HTMLInputElement;
    passwordOnly?: boolean;
  }> = [];
  for (const form of forms) {
    const passwordInputs = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[type="password"]')
    ).filter((el) => isVisible(el));
    if (passwordInputs.length === 0) continue;
    if (input.mode === "login" && passwordInputs.length !== 1) {
      return { ok: false, reasonCode: "ambiguous_password_field" };
    }
    const matchByFingerprint = (
      el: HTMLInputElement,
      fingerprint: string | null | undefined
    ): boolean => {
      if (!fingerprint) return false;
      const f = fingerprint.toLowerCase();
      return (
        el.name.toLowerCase() === f ||
        el.id.toLowerCase() === f ||
        (el.getAttribute("autocomplete") ?? "").toLowerCase() === f
      );
    };
    // T21: saved recipe first, deterministic detection second.
    const usernameInput =
      Array.from(
        form.querySelectorAll<HTMLInputElement>(
          'input[type="email"], input[type="text"], input[type="tel"]'
        )
      ).find(
        (el) =>
          matchByFingerprint(el, input.usernameField) &&
          isVisible(el) &&
          !el.disabled &&
          !el.readOnly
      ) ??
      Array.from(
        form.querySelectorAll<HTMLInputElement>(
          'input[type="email"], input[type="text"], input[type="tel"]'
        )
      ).find(
        (el) => isVisible(el) && !el.disabled && !el.readOnly
      );
    // T21: two-step login — step 2 (password-only) pages are valid when
    // the username was already submitted in a previous round.
    if (!usernameInput && input.usernameFilled) {
      candidates.push({
        form,
        passwordInput: passwordInputs[0]!,
        usernameInput: null as unknown as HTMLInputElement,
        passwordOnly: true,
      });
      continue;
    }
    if (!usernameInput) continue;
    const passwordInput =
      passwordInputs.find((el) =>
        matchByFingerprint(el, input.passwordField)
      ) ?? passwordInputs[0]!;
    candidates.push({
      form,
      passwordInput,
      usernameInput,
    });
  }
  if (candidates.length === 0) {
    // T21: two-step login step 1 — a visible username input with NO
    // password input: fill + submit, report so the orchestrator can run
    // the password round on the next page (bounded, max 3 pages).
    for (const form of forms) {
      const hasPassword =
        Array.from(form.querySelectorAll('input[type="password"]')).filter(
          (el) => isVisible(el)
        ).length > 0;
      if (hasPassword) continue;
      const usernameInput = Array.from(
        form.querySelectorAll<HTMLInputElement>(
          'input[type="email"], input[type="text"], input[type="tel"]'
        )
      ).find(
        (el) => isVisible(el) && !el.disabled && !el.readOnly
      );
      if (!usernameInput) continue;
      setNativeValue(usernameInput, input.username);
      form.requestSubmit();
      return {
        ok: true,
        reasonCode: null,
        stamps: [stampOf(usernameInput)],
        usernameOnlySubmitted: true,
        formAction: form.getAttribute("action"),
      };
    }
    return { ok: false, reasonCode: "form_not_found" };
  }
  const chosen = candidates[0]!;
  const pw = chosen.passwordInput;

  if (!passwordSafe(pw)) {
    return { ok: false, reasonCode: "password_field_unsafe" };
  }

  // T04: per-input length snapshot (NOT a sum) — prefilled usernames and
  // equal-and-opposite foreign changes are both detected.
  const allInputs = Array.from(document.querySelectorAll("input"));
  const lengthsBefore = allInputs.map((el) => el.value.length);

  const clearField = (el: HTMLInputElement): void => {
    setNativeValue(el, "");
  };
  const clearTouched = (): void => {
    if (chosen.usernameInput) {
      clearField(chosen.usernameInput);
    }
    clearField(pw);
  }

  // --- Username (skipped on a two-step password-only page) -------------------
  if (!chosen.passwordOnly) {
    setNativeValue(chosen.usernameInput, input.username);
    stamps.push(stampOf(chosen.usernameInput));
    if (chosen.usernameInput.value.length !== input.username.length) {
      clearTouched();
      return { ok: false, reasonCode: "fill_readback_mismatch", stamps };
    }
  }

  // --- T03: REVALIDATE the password target AFTER the username set -----------
  const pwAfterUsername = chosen.form.querySelector<HTMLInputElement>(
    'input[type="password"]'
  );
  const sameNode = pwAfterUsername === pw;
  const revalidated = [
    sameNode,
    chosen.passwordInput.type === "password",
    !chosen.passwordInput.disabled,
    !chosen.passwordInput.readOnly,
    isVisible(chosen.passwordInput),
    hitTestable(chosen.passwordInput),
    // Same-form identity via the input's own form association (more
    // reliable across engines than Node.contains).
    chosen.passwordInput.form === chosen.form,
  ];
  if (revalidated.some((check) => !check)) {
    void revalidated;
    // The page handler replaced/toggled the password field — the credential
    // must never land in the mutated target. Clear and abort.
    if (chosen.usernameInput) {
      clearField(chosen.usernameInput);
    }
    clearField(pw);
    return { ok: false, reasonCode: "password_field_mutated", stamps };
  }
  // Login mode still requires exactly one visible password input.
  if (
    input.mode === "login" &&
    !chosen.passwordOnly &&
    Array.from(
      chosen.form.querySelectorAll('input[type="password"]')
    ).filter((el) => isVisible(el)).length !== 1
  ) {
    clearTouched();
    return { ok: false, reasonCode: "ambiguous_password_field", stamps };
  }

  // --- Password ---------------------------------------------------------------
  setNativeValue(pw, input.password);
  stamps.push(stampOf(pw));

  // --- Layer B: per-field readback + independent tamper detection ------------
  if (pw.value.length !== input.password.length) {
    clearTouched();
    return { ok: false, reasonCode: "fill_readback_mismatch", stamps };
  }
  const lengthsAfter = Array.from(document.querySelectorAll("input")).map(
    (el) => el.value.length
  );
  const tampered: HTMLInputElement[] = [];
  for (let i = 0; i < allInputs.length; i++) {
    const before = lengthsBefore[i] ?? -1;
    const after = lengthsAfter[i] ?? -2;
    if (before === after) continue;
    const el = allInputs[i]!;
    const isChosenUsername = el === chosen.usernameInput;
    const isChosenPassword = el === pw;
    if (isChosenUsername || isChosenPassword) continue;
    // An input the filler never touched changed length: unexpected recipient
    // or page mutation. Clear it too — no data stays behind.
    if (el instanceof HTMLInputElement) {
      tampered.push(el);
    }
  }
  if (tampered.length > 0) {
    clearTouched();
    for (const el of tampered) {
      clearField(el);
    }
    return { ok: false, reasonCode: "unexpected_field_change", stamps };
  }

  // T21/A-AC-04: mark the credential fields so later observations report
  // [credential] for their values — including show-password-toggled
  // (type=text) fields the sanitizer alone would not mask.
  if (chosen.usernameInput) {
    chosen.usernameInput.setAttribute("data-mb-cred", "1");
  }
  pw.setAttribute("data-mb-cred", "1");

  // --- Submit through the password field's own form (A-FR-18) ----------------
  const submit = (): void => {
    if (input.submitVia === "enter" || !pw.form) {
      // Focus checks around submission (A-FR-19); requestSubmit is the
      // trusted-path equivalent of pressing Enter inside the field.
      pw.focus();
      if (document.activeElement !== pw) {
        return; // focus stolen — refuse rather than submit blind
      }
    }
    if (pw.form) {
      pw.form.requestSubmit();
    } else {
      pw.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    }
  };
  submit();
  if (document.activeElement === pw) {
    pw.blur();
  }

  return {
    ok: true,
    reasonCode: null,
    stamps,
    // T21: fingerprint the fields we actually used so the recipe can be
    // saved and reused next time.
    formAction: chosen.form.getAttribute("action"),
    filledFields: {
      username: chosen.usernameInput
        ? stampOf(chosen.usernameInput)
        : (input.usernameField ?? "username"),
      password: stampOf(pw),
    },
  };
}

/** Outcome probe — also a real function (T02). */
export function loginOutcomeProbePageFunction(): {
  passwordStillVisible: boolean;
  onLoginPath: boolean;
  errorText: string;
  url: string;
} {
  const visible = (el: Element): boolean => {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const passwordStillVisible = Array.from(
    document.querySelectorAll('input[type="password"]')
  ).some(visible);
  const path = location.pathname.toLowerCase();
  const onLoginPath = /login|signin|sign-in|auth|session/.test(path);
  const errorRegion = document.querySelector(
    '[class*="error" i], [role="alert"], [class*="alert" i]'
  );
  const errorText =
    errorRegion && visible(errorRegion)
      ? (errorRegion.textContent || "").trim().slice(0, 200)
      : "";
  return {
    passwordStillVisible,
    onLoginPath,
    errorText,
    url: location.href,
  };
}

export class LoginFormFiller {
  /**
   * Fill + submit with the Layer A/B rules. The password never leaves this
   * call; the returned stamps let the observation sanitizer mask the fields.
   */
  public async fill(
    page: LoginFillPageLike,
    target: LoginFillTarget
  ): Promise<LoginFillResult> {
    // T21/A-FR-21: bounded two-step login loop (max 3 pages). A
    // username-only page is submitted, then the password round runs on
    // the page that follows.
    let fillResult: Awaited<ReturnType<typeof fillLoginPageFunction>> = {
      ok: false,
      reasonCode: "form_not_found",
    };
    let usernameFilled = false;
    for (let round = 0; round < 3; round++) {
      fillResult = await page.evaluate<
        Awaited<ReturnType<typeof fillLoginPageFunction>>
      >(fillLoginPageFunction, {
        mode: target.mode,
        allowedDomainSuffixes: [...target.allowedDomainSuffixes],
        username: target.username,
        password: target.password,
        submitVia: target.recipeStep?.submitVia ?? "form",
        // R20: recipe fingerprints must reach the page function.
        usernameField: target.usernameField ?? target.recipeStep?.usernameField ?? null,
        passwordField: target.passwordField ?? target.recipeStep?.passwordField ?? null,
        usernameFilled,
      });
      if (!fillResult.ok) {
        return {
          outcome: "unknown",
          reasonCode: fillResult.reasonCode ?? null,
          filledFieldStamps: fillResult.stamps ?? [],
        };
      }
      if (fillResult.usernameOnlySubmitted) {
        usernameFilled = true;
        // Wait for the password page to load before the next round.
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        continue;
      }
      break; // full fill succeeded — proceed to outcome detection
    }
    if (fillResult.usernameOnlySubmitted) {
      // All rounds were username-only: treat as challenge (2FA/flow change).
      return {
        outcome: "challenge",
        reasonCode: "two_step_flow_incomplete",
        filledFieldStamps: fillResult.stamps ?? [],
      };
    }

    // Bounded outcome detection (A-FR-09): success is password field gone
    // AND off the login path with no error text; wrong credential stays on
    // the form with visible error; everything else hands off.
    const deadline = Date.now() + 5_000;
    let probe = await page.evaluate<
      ReturnType<typeof loginOutcomeProbePageFunction>
    >(loginOutcomeProbePageFunction);
    while (Date.now() < deadline) {
      if (!probe.passwordStillVisible && !probe.onLoginPath && !probe.errorText) {
        return {
          outcome: "success",
          reasonCode: null,
          filledFieldStamps: fillResult.stamps ?? [],
          ...(fillResult.formAction !== undefined && fillResult.filledFields
            ? {
                recipe: {
                  formAction: fillResult.formAction,
                  usernameField: fillResult.filledFields.username,
                  passwordField: fillResult.filledFields.password,
                },
              }
            : {}),
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
      probe = await page.evaluate<
        ReturnType<typeof loginOutcomeProbePageFunction>
      >(loginOutcomeProbePageFunction);
    }
    return {
      outcome: "unknown",
      reasonCode: "login_outcome_unknown",
      filledFieldStamps: fillResult.stamps ?? [],
    };
  }
}
