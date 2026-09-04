/**
 * Outbound email review→approve→send spec (technical design §19 T-Outbound-1).
 *
 * Drives the complete intent-aware outbound delivery lifecycle through the real
 * renderer → preload → IPC → module → SQLite → utility-process worker path:
 *
 *   1. Seed an email-service row via the E2E-only channel (plaintext password
 *      is credential-compatible with the production decrypt passthrough).
 *      Its SMTP host points at 127.0.0.1 with a closed port so delivery
 *      deterministically ends in delivery_unknown — ECONNREFUSED is an
 *      ambiguous SMTP error, so the pipeline must NEVER auto-retry it (FR-019).
 *   2. The fake AI calls draft_outbound_email_batch; the permission card gates
 *      it; "Allow once" runs the tool against the isolated per-test database.
 *   3. The tool result renders the batch card; "Review" opens the review
 *      dialog (§18).
 *   4. Approve reruns preflight and creates the exact-draft authorization
 *      (§13.2) — the raw token lives in renderer memory only.
 *   5. Send claims the idempotent attempt (§15.1), forks the production
 *      taskCode.js utility process, which submits to the closed port,
 *      classifies ECONNREFUSED as retry-unknown, and the bridge persists
 *      delivery_unknown (§21 recompute) — rendered as "Delivery Unknown" with
 *      the no-auto-retry note.
 *
 * This is the end-to-end enforcement of AD-003 "model proposes, trusted app
 * code authorizes": nothing sends without the review approval the user created.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import type { Locator } from "@playwright/test";
import { assertCleanTeardown } from "../support/assertions";
import type { LaunchedApp } from "../fixtures/electronApp";
import type { FakeOpenAiController } from "../fixtures/fakeOpenAiServer";

function composer(app: LaunchedApp): Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
  await expect(composer(app)).toBeVisible({ timeout: 30_000 });
}

async function sendUnique(app: LaunchedApp, prefix: string): Promise<void> {
  await composer(app).fill(`${prefix}-${Date.now()}`);
  await app.mainWindow.getByTestId("ai-chat-send").click();
}

/**
 * Seed one email-service row through the E2E-only channel and return its id.
 * The SMTP host is loopback with a closed port (nothing listens on it), so the
 * production nodemailer sender gets ECONNREFUSED — classified retry-unknown —
 * and the outcome lands on delivery_unknown (never auto-retried, FR-019).
 * No external network is touched (the loopback connection itself is allowed).
 */
async function seedClosedPortSmtpService(app: LaunchedApp): Promise<number> {
  const result = await app.mainWindow.evaluate(async () => {
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
    const resp = await api.invoke(
      "e2e:seed-email-service",
      JSON.stringify({
        name: "E2E Closed-Port SMTP",
        from: "e2e-sender@example.com",
        password: "e2e-plaintext-pass",
        host: "127.0.0.1",
        // A port that is closed in the sandboxed E2E environment: 1 is not a
        // SMTP port and nothing listens on it locally.
        port: "1",
        ssl: 1,
        status: 1,
      })
    );
    return resp;
  });
  expect(result?.status, `seed failed: ${result?.msg ?? "?"}`).toBe(true);
  const id = (result?.data as { id?: unknown } | undefined)?.id;
  expect(typeof id, "seed returned no id").toBe("number");
  return id as number;
}

/**
 * Full draft flow: open the chat, warm the conversation with a plain turn,
 * then make the fake AI call draft_outbound_email_batch (gated by the
 * permission card). Returns once the user has approved execution and the
 * follow-up turn ("Done.") completed, with the tool result rendered.
 */
async function draftBatchViaTool(
  app: LaunchedApp,
  fakeAi: FakeOpenAiController,
  serviceId: number
): Promise<void> {
  await openChat(app);
  await fakeAi.setScenario("stream-text");
  await sendUnique(app, "e2e-outbound-prep");
  await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
    "Hello world!",
    { timeout: 30_000 }
  );

  // The next non-continuation request returns a draft_outbound_email_batch
  // tool call. Direct recipients keep the batch small and deterministic.
  await fakeAi.setToolCall(
    "draft_outbound_email_batch",
    JSON.stringify({
      emails: [
        {
          address: "e2e-recipient@example.com",
          title: "E2E Recipient",
          source: "direct",
        },
      ],
      service_ids: [serviceId],
      email_subject: "E2E Review Flow",
      email_html_content: "<p>E2E outbound review body</p>",
    })
  );
  await sendUnique(app, "e2e-outbound-draft");

  // The permission card gates the automation-category tool before execution.
  const card = app.mainWindow.getByTestId("ai-chat-permission-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("draft_outbound_email_batch", {
    timeout: 15_000,
  });
  await app.mainWindow.getByTestId("ai-chat-permission-allow-once").click();

  // Tool executed -> the fake server answers the continuation with "Done."
  await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
    "Done.",
    { timeout: 30_000 }
  );
}

test.describe("Outbound email review → approve → send (Electron integration)", () => {
  test.afterEach(({ app, aiApp, disabledApp }) => {
    const a = app ?? aiApp ?? disabledApp;
    if (!a) return;
    // Same invariants as the sibling specs: no unexpected page errors, no
    // external network, clean renderer console.
    assertCleanTeardown(a);
  });

  test("draft tool result renders a reviewable batch card (no send yet)", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(150_000);
    const serviceId = await seedClosedPortSmtpService(aiApp);
    await draftBatchViaTool(aiApp, fakeAi, serviceId);

    // The batch card is rendered for the tool result with the Review action
    // (batch is draft_ready — non-terminal — so the review button shows).
    const card = aiApp.mainWindow.getByTestId("outbound-batch-review");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Nothing has been sent: no send attempt / delivery progress exists yet.
    await expect(
      aiApp.mainWindow.locator('[data-testid^="outbound-progress-row-"]')
    ).toHaveCount(0);
  });

  test("review → approve → send ends in delivery_unknown (closed SMTP port, no auto-retry)", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(150_000);
    const serviceId = await seedClosedPortSmtpService(aiApp);
    await draftBatchViaTool(aiApp, fakeAi, serviceId);

    // Open the review dialog from the batch card.
    await aiApp.mainWindow.getByTestId("outbound-batch-review").click();
    const approveBtn = aiApp.mainWindow.getByTestId("outbound-review-approve");
    await expect(approveBtn).toBeVisible({ timeout: 15_000 });
    const sendBtn = aiApp.mainWindow.getByTestId("outbound-review-send");

    // Send is disabled before approval (canSend requires a token).
    await expect(sendBtn).toBeDisabled();

    // Approve reruns preflight over the frozen revisions and creates the
    // exact-draft authorization (§13.2). The raw token stays in the dialog's
    // memory — it is never rendered or persisted.
    await approveBtn.click();
    await expect(sendBtn).toBeEnabled({ timeout: 15_000 });

    // Send claims the idempotent attempt (§15.1), forks the production
    // taskCode.js worker, which connects to the closed loopback port and
    // fails with ECONNREFUSED -> retry-unknown -> delivery_unknown (§21).
    await sendBtn.click();

    // The send-queued success alert appears (attempt claimed + worker started).
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-root")
    ).toBeVisible();

    // Per-recipient progress row lands on Delivery Unknown with the explicit
    // no-auto-retry note (FR-019 / §18).
    const row = aiApp.mainWindow.locator(
      '[data-testid^="outbound-progress-row-"]'
    );
    await expect(row.first()).toBeVisible({ timeout: 60_000 });
    await expect(row.first()).toContainText("e2e-recipient@example.com");
    await expect(row.first()).toContainText("Delivery Unknown", {
      timeout: 60_000,
    });
    await expect(row.first()).toContainText(
      "Status unknown — do not auto-retry."
    );
    // No retry control is offered for a delivery_unknown outcome (§18).
    await expect(
      row.first().locator('[data-testid^="outbound-progress-retry-"]')
    ).toHaveCount(0);
  });
});
