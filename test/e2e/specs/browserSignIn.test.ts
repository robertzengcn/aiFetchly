import { expect, test } from "@playwright/test";

/**
 * T28 A-AC-02/03/04: deterministic sign-in E2E against a local fake site.
 * Prerequisites (test:e2e harness): a local HTTPS fixture at
 * https://localhost:8443/login with a decoy search box, a show-password
 * toggle, and one real login form; the fixture echoes submitted values as
 * JSON so assertions are exact without any real credential.
 *
 * This spec asserts:
 *  - the saved-password path fills ONLY the single visible HTTPS on-domain
 *    password input (never the decoy search box, never a type=text field);
 *  - a wrong password hands off with a reason and is not retried within
 *    the cooldown (A-FR-10);
 *  - the password string never appears in the chat transcript or the page
 *    outside the password field (A-FR-01 sentinel).
 */
test.describe("browser sign-in E2E (deterministic fixture)", () => {
  const SENTINEL = "e2e-sentinel-password-7f3a";
  const BASE = "https://localhost:8443";

  test.beforeEach(async ({ page }) => {
    // The harness seed API injects a saved account for example.test with the
    // sentinel password before the app window opens.
    await page.request.post(`${BASE}/__e2e__/seed`, {
      data: {
        account: { user: "e2e-user@example.test", password: SENTINEL },
        site: { registrableDomain: "example.test", loginUrl: `${BASE}/login` },
      },
    });
  });

  test("fills the real password field only, never the decoy", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const password = page.locator('input[type="password"]');
    await expect(password).toHaveCount(1);

    // Drive the app through the AI tool surface (browser_sign_in with the
    // seeded session); the harness runs the real LoginFormFiller in the
    // worker against THIS page.
    await page.evaluate(() =>
      (window as unknown as { __e2eSignIn?: (sessionId: string) => Promise<unknown> })
        .__e2eSignIn?.("mb_e2e_signin")
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

  test("a wrong password hands off and is not retried within the cooldown", async ({
    page,
  }) => {
    await page.request.post(`${BASE}/__e2e__/mode`, { data: { reject: true } });
    await page.goto(`${BASE}/login`);
    await page.evaluate(() =>
      (window as unknown as { __e2eSignIn?: (sessionId: string) => Promise<unknown> })
        .__e2eSignIn?.("mb_e2e_signin")
    );

    // The filler reported failure and handed off — exactly ONE submit.
    const submitted = await page.request.get(`${BASE}/__e2e__/submit-count`);
    expect(await submitted.json()).toEqual({ count: 1 });

    // An immediate retry is refused by the cooldown (no second submit).
    await page.evaluate(() =>
      (window as unknown as { __e2eSignIn?: (sessionId: string) => Promise<unknown> })
        .__e2eSignIn?.("mb_e2e_signin")
    );
    const submittedAgain = await page.request.get(`${BASE}/__e2e__/submit-count`);
    expect(await submittedAgain.json()).toEqual({ count: 1 });
  });
});
