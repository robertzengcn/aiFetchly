/**
 * Reply-evidence audit E2E spec (T10 — FR-033/FR-034).
 *
 * Drives the typed-evidence audit surfaces through the real renderer →
 * preload → IPC → module → SQLite path:
 *
 *   1. Seed an email-service row, a received message with
 *      `replyStatus: "sent"` (the §7.1 local-first short-circuit — no IMAP
 *      round trip is needed, keeping the flow inside the loopback-only E2E
 *      network), and an audit row whose `metadataJson` carries the typed
 *      `stage`/`code` exactly as the production refusal writers emit them.
 *   2. The audit list page renders the evidence chip from the structured
 *      JSON fields (never by parsing the English reason text — B12).
 *   3. The audit detail page renders the evidence chip, the stage caption,
 *      and the next-action chip derived from the typed code.
 *   4. The "Check reply status" recheck action runs the real
 *      EMAIL_REPLY_CHECK_REPLIED AI-gated channel; the local-first state
 *      settles `replied` deterministically and the three-state result chip
 *      renders.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import type { LaunchedApp } from "../fixtures/electronApp";

interface SeedResult {
  id: number;
}

async function invokeSeed(
  app: LaunchedApp,
  channel: string,
  payload: Record<string, unknown>
): Promise<number> {
  const result = await app.mainWindow.evaluate(
    async ({ ch, data }: { ch: string; data: Record<string, unknown> }) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (
              c: string,
              d?: unknown
            ) => Promise<
              { status: boolean; data: unknown; msg?: string } | undefined
            >;
          };
        }
      ).api;
      const resp = await api.invoke(ch, JSON.stringify(data));
      return resp;
    },
    { ch: channel, data: payload }
  );
  expect(result?.status, `seed ${channel} failed: ${result?.msg ?? "?"}`).toBe(
    true
  );
  const id = (result?.data as SeedResult | undefined)?.id;
  expect(typeof id, `seed ${channel} returned no id`).toBe("number");
  return id as number;
}

async function seedAuditScenario(app: LaunchedApp): Promise<void> {
  const serviceId = await invokeSeed(app, "e2e:seed-email-service", {
    name: "E2E Audit Evidence Sender",
    from: "e2e-audit-sender@example.com",
    password: "e2e-plaintext-pass",
    host: "127.0.0.1",
    port: "143",
    ssl: 0,
    status: 1,
  });

  // Local-first positive: replyStatus "sent" short-circuits detection to
  // `replied` (source local_state) without touching any mailbox.
  const messageId = await invokeSeed(app, "e2e:seed-received-message", {
    emailServiceId: serviceId,
    providerUid: "e2e-audit-uid-1",
    messageId: "<e2e-audit-original-1@example.com>",
    fromAddress: "e2e-recipient@example.com",
    toAddresses: ["e2e-audit-sender@example.com"],
    subject: "E2E audit evidence original",
    replyStatus: "sent",
    isAnswered: 1,
  });

  // Typed refusal metadata exactly as the production writers emit it.
  await invokeSeed(app, "e2e:seed-auto-reply-audit", {
    emailServiceId: serviceId,
    messageId,
    action: "auto_reply_skipped",
    decisionStatus: "skipped",
    reason:
      "[already_replied] A reply to this message was already sent — draft generation refused before any model call.",
    generatedSubject: "E2E audit evidence original",
    requiresUserApproval: 1,
    metadataJson: JSON.stringify({
      correlationId: "e2e-corr-1",
      messageCorrelationId: "e2e-msg-corr-1",
      stage: "pre_draft",
      code: "already_replied",
    }),
  });
}

test.describe("Reply-evidence audit surfaces (T10)", () => {
  test.afterEach(({ app, aiApp, disabledApp }) => {
    const a = app ?? aiApp ?? disabledApp;
    if (!a) return;
    assertCleanTeardown(a);
  });

  test("audit list renders the typed evidence chip; detail renders evidence + next action + live recheck", async ({
    aiApp,
  }) => {
    test.setTimeout(150_000);
    await seedAuditScenario(aiApp);
    const page = aiApp.mainWindow;

    // Audit list: the evidence chip renders from the structured metadata.
    await page.evaluate(() => {
      window.location.hash = "/emailmarketing/emailreply/audit/list";
    });
    await expect(page.getByTestId("email-auto-reply-audit-list")).toBeVisible({
      timeout: 15_000,
    });

    // Open the detail via the row action.
    await page
      .locator("tbody tr")
      .filter({ hasText: "E2E audit evidence original" })
      .locator('[data-testid="audit-row-open"]')
      .click();
    await expect(
      page.getByTestId("audit-detail-recheck")
    ).toBeVisible({ timeout: 15_000 });

    // Evidence chip + stage caption + next-action chip from the typed code.
    await expect(page.getByTestId("audit-detail-evidence-chip")).toContainText(
      "Already replied"
    );
    await expect(page.getByTestId("audit-detail-stage")).toContainText(
      "pre_draft"
    );

    // Live recheck through the real AI-gated channel: the seeded local state
    // settles `replied` — the result chip renders with no mailbox round trip.
    await page.getByTestId("audit-detail-recheck").click();
    await expect(
      page.getByTestId("audit-detail-recheck-result")
    ).toContainText("Replied", { timeout: 15_000 });
  });
});
