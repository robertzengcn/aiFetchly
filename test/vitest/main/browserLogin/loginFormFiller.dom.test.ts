// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import {
  fillLoginPageFunction,
  type LoginFillTarget,
} from "@/childprocess/managed-browser/LoginFormFiller";

/**
 * T02/T03/T04 acceptance: the REAL page function executes against a live
 * DOM (not a string-mock double) — Layer A/B rules, post-username
 * revalidation, and per-input tamper detection all run for real.
 */

interface InputSpec {
  type: string;
  name: string;
  value?: string;
}

interface PageOptions {
  protocol?: string;
  hostname?: string;
  inputs: InputSpec[];
  /** After the username set, mutate the password field (T03). */
  togglePasswordAfterUsername?: boolean;
  /** A non-target input whose length changes during the fill (T04). */
  foreignInputDelta?: boolean;
}

function buildPage(options: PageOptions): {
  run: (target: LoginFillTarget) => ReturnType<typeof fillLoginPageFunction>;
} {
  document.body.innerHTML = "";
  const form = document.createElement("form");
  form.action = "/login";
  for (const spec of options.inputs) {
    const input = document.createElement("input");
    input.type = spec.type;
    input.name = spec.name;
    if (spec.value !== undefined) {
      input.value = spec.value;
    }
    form.appendChild(input);
  }
  document.body.appendChild(form);

  // happy-dom reports zero rects and no elementFromPoint by default; the
  // script's visibility/hit-test helpers need real-ish geometry.
  for (const el of Array.from(document.querySelectorAll("input"))) {
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 20,
        width: 100,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }
  // The script hit-tests the password field at its center; return it.
  document.elementFromPoint = () =>
    (document.querySelector("input[type='password']") ??
      document.querySelector("input")) as Element;

  // happy-dom's vitest environment defaults to http://localhost; move the
  // page to the target origin via the supported setURL API.
  const protocol = options.protocol ?? "https:";
  const hostname = options.hostname ?? "www.example.test";
  const happyDom = (window as unknown as {
    happyDOM?: { setURL: (url: string) => Promise<void> };
  }).happyDOM;
  if (happyDom) {
    void happyDom.setURL(`${protocol}//${hostname}/login`);
  }

  if (options.togglePasswordAfterUsername) {
    const usernameInput = form.querySelector<HTMLInputElement>("input[name='username']")!;
    const passwordInput = form.querySelector<HTMLInputElement>("input[name='password']")!;
    usernameInput.addEventListener("input", () => {
      // Synchronous page handler: toggle the password to text (show-password
      // widget) — the credential must never land in it.
      passwordInput.type = "text";
    });
  }
  if (options.foreignInputDelta) {
    const search = form.querySelector<HTMLInputElement>("input[name='search']")!;
    const usernameInput = form.querySelector<HTMLInputElement>("input[name='username']")!;
    usernameInput.addEventListener("input", () => {
      search.value = "injected"; // unexpected recipient grows during fill
    });
  }

  return {
    run: (target) =>
      fillLoginPageFunction({
        mode: target.mode,
        allowedDomainSuffixes: [...target.allowedDomainSuffixes],
        username: target.username,
        password: target.password,
        submitVia: target.recipeStep?.submitVia ?? "form",
      }),
  };
}

function baseTarget(overrides: Partial<LoginFillTarget> = {}): LoginFillTarget {
  return {
    mode: "login",
    allowedDomainSuffixes: ["example.test"],
    recipeStep: null,
    username: "user@example.test",
    password: "sentinel-password-123",
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("fillLoginPageFunction against a live DOM (T02/T03/T04)", () => {
  it("fills both fields, submits via the form, and reports stamps", () => {
    const page = buildPage({
      inputs: [
        { type: "text", name: "username" },
        { type: "password", name: "password" },
      ],
    });
    const result = page.run(baseTarget());
    expect(result.ok).toBe(true);
    expect(result.stamps).toEqual(["username", "password"]);
    const username = document.querySelector<HTMLInputElement>("input[name='username']")!;
    const password = document.querySelector<HTMLInputElement>("input[name='password']")!;
    expect(username.value).toBe("user@example.test");
    // Length-only readback in the script; the DOM itself holds the value.
    expect(password.value.length).toBe("sentinel-password-123".length);
    expect(JSON.stringify(result)).not.toContain("sentinel-password-123");
  });

  it("succeeds with a prefilled username (per-input comparison, not a sum)", () => {
    const page = buildPage({
      inputs: [
        { type: "text", name: "username", value: "prefilled@example.test" },
        { type: "password", name: "password" },
      ],
    });
    const result = page.run(
      baseTarget({ username: "user@example.test", password: "short-pw" })
    );
    expect(result.ok).toBe(true);
    const username = document.querySelector<HTMLInputElement>("input[name='username']")!;
    expect(username.value).toBe("user@example.test");
  });

  it("refuses when the username handler toggles the password to text (T03)", () => {
    const page = buildPage({
      togglePasswordAfterUsername: true,
      inputs: [
        { type: "text", name: "username" },
        { type: "password", name: "password" },
      ],
    });
    const result = page.run(baseTarget());
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("password_field_mutated");
    const username = document.querySelector<HTMLInputElement>("input[name='username']")!;
    const password = document.querySelector<HTMLInputElement>("input[name='password']")!;
    // The credential never landed in the mutated target.
    expect(password.value).toBe("");
    expect(username.value).toBe("");
  });

  it("detects an unexpected foreign field change and clears everything (T04)", () => {
    const page = buildPage({
      foreignInputDelta: true,
      inputs: [
        { type: "text", name: "username" },
        { type: "text", name: "search" },
        { type: "password", name: "password" },
      ],
    });
    const result = page.run(baseTarget());
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("unexpected_field_change");
    for (const name of ["username", "search", "password"]) {
      expect(document.querySelector<HTMLInputElement>(`input[name='${name}']`)!.value).toBe("");
    }
  });

  it("aborts with cleared fields when the password readback mismatches", () => {
    const page = buildPage({
      inputs: [
        { type: "text", name: "username" },
        { type: "password", name: "password" },
      ],
    });
    // Simulate a page that silently truncates typed values via a handler.
    const password = document.querySelector<HTMLInputElement>("input[name='password']")!;
    password.addEventListener("input", () => {
      if (password.value.length > 4) {
        password.value = password.value.slice(0, 4);
      }
    });
    const result = page.run(baseTarget());
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("fill_readback_mismatch");
    expect(document.querySelector<HTMLInputElement>("input[name='username']")!.value).toBe("");
    expect(password.value).toBe("");
  });

  it("rejects a foreign frame host before typing (Layer A)", () => {
    const page = buildPage({
      hostname: "evil.test",
      inputs: [
        { type: "text", name: "username" },
        { type: "password", name: "password" },
      ],
    });
    const result = page.run(baseTarget());
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("origin_mismatch");
    expect(document.querySelector<HTMLInputElement>("input[name='password']")!.value).toBe("");
  });

  it("rejects HTTP pages before typing (Layer A)", () => {
    const page = buildPage({
      protocol: "http:",
      inputs: [
        { type: "text", name: "username" },
        { type: "password", name: "password" },
      ],
    });
    const result = page.run(baseTarget());
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("insecure_page");
  });

  it("rejects two visible password inputs in login mode (Layer A)", () => {
    const page = buildPage({
      inputs: [
        { type: "text", name: "username" },
        { type: "password", name: "password" },
        { type: "password", name: "confirm" },
      ],
    });
    const result = page.run(baseTarget());
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("ambiguous_password_field");
  });
});
