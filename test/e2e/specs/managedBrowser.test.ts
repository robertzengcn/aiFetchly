/**
 * Managed-browser E2E (technical design §26, GAP-17).
 *
 * ENV-GUARDED: this spec launches REAL headed Chrome through the production
 * session worker and therefore requires a display + a locally available
 * Chrome. It is skipped unless AIFETCHLY_MB_E2E=1 — `yarn test:e2e` stays
 * green on headless runners while an interactive machine can run:
 *
 *   AIFETCHLY_MB_E2E=1 xvfb-run -a yarn playwright test managedBrowser
 *
 * Certified here (§26 steps 1, 4, 6 — the automatable subset against the
 * REAL production paths; no module mocks):
 *  - start     — seed a fixture YouTube tool account (platformId 2), list it
 *                through the real eligible-accounts handler, and start a
 *                real managed session (real Chrome through the production
 *                session worker).
 *  - login-gate — a cookie-less fixture account reaches YouTube
 *                unauthenticated; the worker reports LOGIN_REQUIRED and the
 *                module transitions to user_login_in_progress (the
 *                takeover/login-verification phase, observed through the
 *                real IPC).
 *  - sensitive — the screenshot capture is DENIED in the sensitive
 *                user_login_in_progress state (nothing identifiable leaves
 *                the page while credentials are being entered).
 *  - stop      — stop is graceful: the active list clears and a SECOND
 *                start works after the clean teardown.
 *
 * The remaining §26 steps (verified manual-login resume, the 10-minute
 * login-window lapse, cookie refresh persistence, every challenge class,
 * cache reuse/eviction and the packaged-build matrix) require either real
 * credentials or a config seam for the login deadline — they stay
 * module-certified (`test/vitest/main/managedBrowser/`, 52 cases incl.
 * resume/expiry/stale-revision/challenge paths) until the harness milestone.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import type { LaunchedApp } from "../fixtures/electronApp";

const GUARDED = process.env.AIFETCHLY_MB_E2E === "1";

interface IpEnvelope {
  status: boolean;
  data: unknown;
  msg?: string;
}

async function ipc(
  app: LaunchedApp,
  channel: string,
  data: unknown
): Promise<IpEnvelope> {
  const payload = JSON.stringify(data);
  const resp = await app.mainWindow.evaluate(
    async ([ch, body]: [string, string]) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (c: string, d?: unknown) => Promise<IpEnvelope | undefined>;
          };
        }
      ).api;
      return (await api.invoke(ch, body)) ?? { status: false, data: null };
    },
    [channel, payload] as const
  );
  return resp as IpEnvelope;
}

interface ActiveSessionView {
  accountId?: number;
  sessionId?: string;
  state?: string;
  platformId?: number;
}

test.describe("managed browser (real Chrome)", () => {
  test.skip(!GUARDED, "set AIFETCHLY_MB_E2E=1 on a machine with a display");

  test("starts a managed session, gates on the login verification phase, denies captures in the sensitive state, and stops cleanly", async ({
    aiApp,
  }, testInfo) => {
    test.setTimeout(240_000);

    // 1. Seed the fixture YouTube tool account through the production save
    //    handler (the E2E DB is isolated under the temp test root).
    const seeded = await ipc(aiApp, "socialaccount:save", {
      user: `e2e-managed-${Date.now()}`,
      pass: null,
      status: 1,
      social_type_id: 2, // MANAGED_BROWSER_PILOT_PLATFORM_IDS = [2] (YouTube)
      name: "e2e-managed-youtube",
    });
    expect(seeded.status).toBe(true);
    const accountId = Number((seeded.data as { id?: number }).id);
    expect(accountId).toBeGreaterThan(0);

    // 2. The real eligible-accounts listing finds it (pilot allowlist).
    const eligible = await ipc(
      aiApp,
      "managed-browser:list-eligible-accounts",
      {}
    );
    expect(eligible.status).toBe(true);
    const accounts = (eligible.data ?? []) as Array<{
      accountId: number;
      platformId: number;
      accountLabel: string;
    }>;
    const fixtureRow = accounts.find((row) => row.accountId === accountId);
    expect(
      fixtureRow,
      "the seeded fixture account is listed as eligible"
    ).toBeTruthy();
    expect(fixtureRow?.platformId).toBe(2);

    // 3. START through the real AI-facing handler — a started session works
    //    and transitions to user_login_in_progress (cookie-less fixture
    //    account on the real YouTube verification URL).
    const started = await ipc(aiApp, "managed-browser:start", {
      accountId,
      purpose: "e2e takeover certification",
    });
    expect(started, "eligible listing + start diagnostics").toBeTruthy();
    expect(started.status, `start failed: ${started.msg}`).toBe(true);
    const startData = started.data as {
      sessionId?: string;
      alreadyActive?: boolean;
    };
    expect(startData).toBeTruthy();
    const sessionId = startData?.sessionId;
    expect(sessionId, "the start must yield an opaque mb_ session id").toMatch(
      /^mb_/
    );

    // 4. LOGIN-VERIFICATION GATE: poll the real status channel — the module
    //    settles user_login_in_progress through worker LOGIN_REQUIRED.
    const statusState = async (): Promise<string | undefined> => {
      const resp = await ipc(aiApp, "managed-browser:status", { sessionId });
      return (resp?.data as { state?: string } | undefined)?.state;
    };
    const observedStates: string[] = [];
    let settledState: string | undefined;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const state = await statusState();
      if (state) observedStates.push(state);
      if (state === "user_login_in_progress") {
        settledState = state;
        break;
      }
      // Any terminal divergence is a straight failure (the record is gone).
      if (!state) break;
      await aiApp.mainWindow.waitForTimeout(2_000);
    }
    expect(
      settledState ?? observedStates.at(-1),
      "the login-verification phase must publish user_login_in_progress"
    ).toBe("user_login_in_progress");

    // 5. Sensitive state: the screenshot capture is denied (no page pixels
    //    leave the browser while the user may be entering credentials).
    const denied = await ipc(aiApp, "managed-browser:capture-screenshot", {
      session_id: sessionId,
    });
    expect(denied.status).toBe(false);

    // 6. STOP is graceful: the lease releases and the module converges.
    const stopped = await ipc(aiApp, "managed-browser:stop", {
      sessionId,
      reason: "user_stop",
    });
    expect(stopped.status).toBe(true);

    const activeAfter = async (): Promise<number> => {
      const resp = await ipc(aiApp, "managed-browser:list-active", {});
      const list = (resp?.data ?? []) as ActiveSessionView[];
      return list.filter((row) => row.accountId === accountId).length;
    };
    await expect.poll(activeAfter, { timeout: 20_000 }).toBe(0);

    // 7. SECOND START after the clean teardown (takeover re-entry works —
    //    a duplicate record would hit lease/already_active confusion).
    const restarted = await ipc(aiApp, "managed-browser:start", {
      accountId,
      purpose: "e2e takeover re-entry",
    });
    expect(
      restarted.status,
      `restart failed: ${restarted.msg ?? "no message"}`
    ).toBe(true);
    const restartedSession = (restarted.data as { sessionId?: string })
      ?.sessionId;
    expect(restartedSession ?? "").toMatch(/^mb_/);
    // Re-entry reaches the same login gate (the account has no cookies).
    let reentryState: string | undefined;
    const reentryDeadline = Date.now() + 90_000;
    while (Date.now() < reentryDeadline) {
      const state = await statusStateOf(aiApp, restartedSession ?? "");
      if (state === "user_login_in_progress") {
        reentryState = state;
        break;
      }
      if (!state) break;
      await aiApp.mainWindow.waitForTimeout(2_000);
    }
    expect(reentryState).toBe("user_login_in_progress");

    // Clean teardown of the re-entry session.
    const restopped = await ipc(aiApp, "managed-browser:stop", {
      sessionId: restartedSession ?? "",
      reason: "user_stop",
    });
    expect(restopped.status).toBe(true);
    await expect.poll(activeAfter, { timeout: 20_000 }).toBe(0);

    await assertCleanTeardown(aiApp);
    void testInfo;
  });
});

async function statusStateOf(
  app: LaunchedApp,
  sessionId: string
): Promise<string | undefined> {
  const resp = await ipc(app, "managed-browser:status", { sessionId });
  return (resp?.data as { state?: string } | undefined)?.state;
}
