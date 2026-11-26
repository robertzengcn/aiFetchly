import { expect, test } from "@playwright/test";
import { fillLoginPageFunction } from "@/childprocess/managed-browser/LoginFormFiller";

/**
 * T28 A-AC-02/03/04: deterministic sign-in E2E against a local fake site.
 * Harness: the deterministic HTTPS fixture at https://localhost:8443/login
 * (decoy search box + one real login form; submitted values are echoed as
 * JSON so assertions are exact without any real credential).
 *
 * Driver: the WORKER-EQUIVALENT invocation — the spec evaluates the REAL
 * production `fillLoginPageFunction` (the exact page function the managed
 * browser worker executes, T02) against the fixture page, with the seeded
 * credential. The cooldown test documents the app-service layer that a
 * full app-run harness must drive (A-FR-10 lives in
 * BrowserCredentialLoginService, not in the page function).
 */
test.describe("browser sign-in E2E (deterministic fixture)", () => {
  const SENTINEL = "e2e-sentinel-password-7f3a";
  const BASE = "https://localhost:8443";

  test.beforeEach(async ({ page }) => {
    // The harness seed API records the saved account for example.test with
    // the sentinel password; the driver reads it back to fill the form.
    await page.request.post(`${BASE}/__e2e__/seed`, {
      data: {
        account: { user: "e2e-user@example.test", password: SENTINEL },
        // The fixture's REAL registrable domain is localhost — the seed
        // must match what the filler's Layer A host check verifies.
        site: { registrableDomain: "localhost", loginUrl: `${BASE}/login` },
      },
    });
  });

  test("fills the real password field only, never the decoy", async ({
    page,
  }) => {
    await page.goto(`${BASE}/login`);
    const password = page.locator('input[type="password"]');
    await expect(password).toHaveCount(1);

    // The seeded credential comes back from the harness (A-FR-08 shape).
    const seed = (await (
      await page.request.get(`${BASE}/__e2e__/seed`)
    ).json()) as {
      account: { user: string; password: string };
    };
    expect(seed.account.password).toBe(SENTINEL);

    // Worker-equivalent invocation: the REAL production page function runs
    // in the page against the REAL fixture DOM (Layer A checks, autocomplete
    // preference, per-field readback, data-mb-cred stamping).
    const fillResult = (await page.evaluate(fillLoginPageFunction, {
      mode: "login" as const,
      allowedDomainSuffixes: ["localhost"],
      username: seed.account.user,
      password: seed.account.password,
      submitVia: "form" as const,
    })) as { ok: boolean; stamps?: string[] };
    expect(fillResult.ok).toBe(true);
    expect(fillResult.stamps).toEqual(["username", "password"]);
    // The credential fields are stamped for observation masking (A-AC-04).
    await expect(page.locator('input[name="password"]')).toHaveAttribute(
      "data-mb-cred",
      "1"
    );
    await expect(page.locator('input[name="username"]')).toHaveAttribute(
      "data-mb-cred",
      "1"
    );

    // The fill landed in the password field, not the decoy search box.
    await expect(page.locator('input[name="search"]')).toHaveValue("");
    await expect(password).not.toHaveValue("");

    // The submitted request reached the fixture with the exact sentinel.
    const submitted = await page.request.get(`${BASE}/__e2e__/last-submit`);
    expect(await submitted.json()).toMatchObject({
      username: "e2e-user@example.test",
      password: SENTINEL,
    });

    // A-FR-01: the sentinel must never appear in rendered page text outside
    // the password field value (transcript/log checks live in unit suites).
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(SENTINEL);
  });

  // F23 (documented boundary): the cooldown is enforced by
  // BrowserCredentialLoginService (app process, A-FR-10) — driving it E2E
  // requires the Electron-launch harness with the app's account store.
  // The cooldown itself is covered by the unit suite
  // (test/vitest/main/browserLogin/credentialCard.test.ts, F12 concurrent
  // reservation test).
  test.fixme(
    "a wrong password hands off and is not retried within the cooldown",
    async () => {
      // Requires the app-run harness: seed a WRONG password, drive
      // browser_sign_in through the app, assert exactly one submit and a
      // cooldown refusal on immediate retry.
    }
  );
});
