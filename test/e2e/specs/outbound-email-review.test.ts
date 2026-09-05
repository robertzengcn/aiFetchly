/**
 * Outbound email review→approve→send spec (technical design §24.8 item 6).
 *
 * Drives the complete intent-aware outbound delivery lifecycle through the real
 * renderer → preload → IPC → module → SQLite → utility-process worker path:
 *
 *   1. Seed an email-service row via the E2E-only channel (plaintext password
 *      is credential-compatible with the production decrypt passthrough).
 *      Its SMTP host points at a loopback server that accepts the TCP
 *      connection and immediately destroys the socket, so the production
 *      nodemailer sender fails with an ambiguous greeting-phase drop
 *      ("Unexpected socket close") — neither a success nor a definite
 *      pre-acceptance rejection — and the pipeline must land on
 *      delivery_unknown and NEVER auto-retry it (FR-019).
 *   2. The fake AI calls draft_outbound_email_batch, which prepares the
 *      reviewable batch without a separate permission decision.
 *   3. The tool result renders the batch card; "Review" opens the review
 *      dialog (§18).
 *   4. Approve reruns preflight and creates the exact-draft authorization
 *      (§13.2) — the raw token lives in renderer memory only.
 *   5. Send claims the idempotent attempt (§15.1), forks the production
 *      taskCode.js utility process, which submits to the dropping server,
 *      classifies the mid-connection drop as retry-unknown, and the bridge
 *      persists delivery_unknown (§21 recompute) — rendered as "Delivery
 *      Unknown" with the no-auto-retry note.
 *
 * This is the end-to-end enforcement of AD-003 "model proposes, trusted app
 * code authorizes": nothing sends without the review approval the user created.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import type { Locator } from "@playwright/test";
import { assertCleanTeardown } from "../support/assertions";
import type { LaunchedApp } from "../fixtures/electronApp";
import type { FakeOpenAiController } from "../fixtures/fakeOpenAiServer";
import * as net from "node:net";

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
 * Loopback SMTP stand-in for the ambiguous-failure scenario: accepts every TCP
 * connection, then immediately destroys the socket — the server drops the
 * client mid-connection, before the 220 greeting. The production nodemailer
 * sender fails with "Unexpected socket close", which is neither a success nor
 * a definite pre-acceptance rejection (ECONNREFUSED, auth, TLS, envelope
 * rejection are all definite and would end in `failed`), so the worker
 * classifies it retry-unknown and the outcome lands on delivery_unknown
 * (never auto-retried, FR-019). Runs on an ephemeral loopback port in the
 * Playwright test process — allowed by the loopback-only E2E network policy
 * and reachable by the Electron utility worker.
 */
async function startDroppingSmtpServer(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = net.createServer((socket) => {
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("dropping SMTP server did not get a TCP port");
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Seed one email-service row through the E2E-only channel, pointing at the
 * dropping loopback server, and return its id. Plain SMTP (ssl: 0): with
 * implicit TLS the destroyed socket surfaces as "read ECONNRESET" — also
 * ambiguous — but the greeting-phase drop of the non-TLS path is the
 * deterministic canonical case, free of TLS-handshake noise.
 */
async function seedDroppingSmtpService(
  app: LaunchedApp,
  port: number
): Promise<number> {
  const result = await app.mainWindow.evaluate(async (smtpPort: number) => {
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
        name: "E2E Dropping SMTP",
        from: "e2e-sender@example.com",
        password: "e2e-plaintext-pass",
        host: "127.0.0.1",
        port: String(smtpPort),
        ssl: 0,
        status: 1,
      })
    );
    return resp;
  }, port);
  expect(result?.status, `seed failed: ${result?.msg ?? "?"}`).toBe(true);
  const id = (result?.data as { id?: unknown } | undefined)?.id;
  expect(typeof id, "seed returned no id").toBe("number");
  return id as number;
}

/**
 * Full draft flow: open the chat, warm the conversation with a plain turn,
 * then make the fake AI call draft_outbound_email_batch. Returns once the
 * follow-up turn ("Done.") completes with the tool result rendered.
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

  // Draft preparation is non-sending, so it executes without a permission
  // card. The fake server answers the continuation with "Done."
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
    const smtp = await startDroppingSmtpServer();
    try {
      const serviceId = await seedDroppingSmtpService(aiApp, smtp.port);
      await draftBatchViaTool(aiApp, fakeAi, serviceId);

      // The batch card is rendered for the tool result with the Review action
      // (batch is draft_ready — non-terminal — so the review button shows).
      const card = aiApp.mainWindow.getByTestId("outbound-batch-review");
      await expect(card).toBeVisible({ timeout: 15_000 });

      // Nothing has been sent: no send attempt / delivery progress exists yet.
      await expect(
        aiApp.mainWindow.locator('[data-testid^="outbound-progress-row-"]')
      ).toHaveCount(0);
    } finally {
      await smtp.close();
    }
  });

  test("review → approve → send ends in delivery_unknown (dropping SMTP server, no auto-retry)", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(150_000);
    const smtp = await startDroppingSmtpServer();
    try {
      const serviceId = await seedDroppingSmtpService(aiApp, smtp.port);
      await draftBatchViaTool(aiApp, fakeAi, serviceId);

      // Open the review dialog from the batch card.
      await aiApp.mainWindow.getByTestId("outbound-batch-review").click();
      const approveBtn = aiApp.mainWindow.getByTestId(
        "outbound-review-approve"
      );
      await expect(approveBtn).toBeVisible({ timeout: 15_000 });
      const sendBtn = aiApp.mainWindow.getByTestId("outbound-review-send");

      // Send is disabled before approval (canSend requires a token).
      await expect(sendBtn).toBeDisabled();

      // Approve reruns preflight over the frozen revisions and creates the
      // exact-draft authorization (§13.2). The raw token stays in the
      // dialog's memory — it is never rendered or persisted.
      await approveBtn.click();
      await expect(sendBtn).toBeEnabled({ timeout: 15_000 });

      // Send claims the idempotent attempt (§15.1), forks the production
      // taskCode.js worker, which connects to the dropping loopback server
      // and fails mid-connection ("Unexpected socket close") -> retry-unknown
      // -> delivery_unknown (§21).
      await sendBtn.click();

      // The send-queued success alert appears (attempt claimed + worker started).
      await expect(aiApp.mainWindow.getByTestId("ai-chat-root")).toBeVisible();

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
    } finally {
      await smtp.close();
    }
  });
});
