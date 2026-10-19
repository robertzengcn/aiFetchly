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
import type { E2ETestRoot } from "../fixtures/types";
import type { FakeOpenAiController } from "../fixtures/fakeOpenAiServer";
import * as net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execFileAsync = promisify(execFile);
/** The user database lives in <testRoot>/database/scraper.db. */
const DB_FILE_NAME = "scraper.db";

function composer(app: LaunchedApp): Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: LaunchedApp): Promise<void> {
  // The chat workspace is the default landing route; the legacy dock toggle
  // only exists when the app landed elsewhere. Handle both.
  const toggle = app.mainWindow.getByTestId("ai-chat-toggle");
  try {
    await toggle.waitFor({ state: "visible", timeout: 5_000 });
    await toggle.click();
  } catch {
    /* already on the chat workspace */
  }
  await expect(composer(app)).toBeVisible({ timeout: 30_000 });
  // Under the chat-first shell, start a conversation so the send path has a
  // conversation to append to (the legacy dock creates one implicitly).
  const newChat = app.mainWindow.getByTestId("workspace-new-chat");
  try {
    await newChat.waitFor({ state: "visible", timeout: 5_000 });
    await newChat.click();
    await expect(composer(app)).toBeVisible({ timeout: 30_000 });
  } catch {
    /* legacy dock: no shell strip button */
  }
}

/**
 * The chat content root: the chat-first shell renders the transcript as
 * `workspace-transcript`; the legacy dock uses `ai-chat-root`. Scope text
 * containment to whichever is present.
 */
function chatRoot(app: LaunchedApp): Locator {
  return app.mainWindow
    .locator(
      '[data-testid="workspace-transcript"], [data-testid="ai-chat-root"]'
    )
    .first();
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
): Promise<number> {
  await openChat(app);
  await fakeAi.setScenario("stream-text");
  await sendUnique(app, "e2e-outbound-prep");
  await expect(chatRoot(app)).toContainText("Hello world!", {
    timeout: 30_000,
  });

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
  await expect(chatRoot(app)).toContainText("Done.", {
    timeout: 30_000,
  });
  const reviewAction = app.mainWindow.getByTestId("outbound-batch-review");
  await expect(reviewAction).toBeVisible({ timeout: 15_000 });
  const batchId = await reviewAction.getAttribute("data-batch-id");
  expect(batchId, "review action did not expose its batch id").toMatch(/^\d+$/);
  return Number(batchId);
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
      const batchId = await draftBatchViaTool(aiApp, fakeAi, serviceId);

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
      await expect(approveBtn).toBeHidden({ timeout: 15_000 });

      // The send was claimed and the dialog closed.
      await expect(chatRoot(aiApp)).toBeVisible();

      // Poll the authoritative batch status because delivery progress is
      // intentionally hidden with the closed dialog.
      await expect
        .poll(
          async () =>
            await aiApp.mainWindow.evaluate(async (id: number) => {
              const api = (
                window as unknown as {
                  api: {
                    invoke: (
                      channel: string,
                      data?: unknown
                    ) => Promise<{
                      status: boolean;
                      data?: {
                        batchStatus?: string;
                        outcomes?: Array<{
                          recipientAddress?: string;
                          status?: string;
                        }>;
                      };
                    }>;
                  };
                }
              ).api;
              const response = await api.invoke("outbound:email:batch:status", {
                batchId: id,
              });
              return response.data;
            }, batchId),
          { timeout: 60_000 }
        )
        .toMatchObject({
          batchStatus: "delivery_unknown",
          outcomes: [
            {
              recipientAddress: "e2e-recipient@example.com",
              status: "delivery_unknown",
            },
          ],
        });
    } finally {
      await smtp.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Parity-audit follow-up coverage (FR-OUT-006 / FR-OUT-009):
//   • Duplicate claim — a repeated send with the SAME claim triple collapses
//     into already_processed with the ORIGINAL attempt id (FR-OUT-006). The
//     duplicate exercises the same validated channel the dialog's Send
//     button posts through; the raw token is minted by calling the approve
//     channel directly (server-side) because the dialog only ever holds it
//     in renderer memory.
//   • Persistent receipt — closing the dialog after a claimed send does not
//     discard the transcript receipt: the batch card stays attached and
//     reopening Review still renders the terminal delivery progress with the
//     no-auto-retry note (FR-OUT-009).
// Claim-time expiry of authorizations is covered at unit level in
// test/vitest/main/OutboundEmailDeliveryService.test.ts (authorization_expired).
// ---------------------------------------------------------------------------

interface OutboundEnvelope {
  status: boolean;
  msg?: string;
  data: unknown;
}

/**
 * Invoke an outbound IPC channel with a JSON payload through the preload
 * bridge and return the envelope. Mirrors the direct-invoke helpers used by
 * sibling specs (the seed helper above).
 */
async function invokeOutboundEnvelope(
  app: LaunchedApp,
  channel: string,
  payload: unknown
): Promise<OutboundEnvelope> {
  const response = await app.mainWindow.evaluate(
    async (args: { channel: string; raw: string }) => {
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
      return await api.invoke(args.channel, args.raw);
    },
    { channel, raw: JSON.stringify(payload) }
  );
  return (response ?? {
    status: false,
    data: null,
    msg: "no envelope",
  }) as OutboundEnvelope;
}

interface OutboundBatchStatusData {
  batchStatus?: string;
  attempt?: { id?: number; status?: string } | null;
  outcomes?: Array<{
    recipientAddress?: string;
    status?: string;
    draftId?: number;
  }>;
}

/** Read the authoritative batch status (attempt + outcomes). */
async function readBatchStatus(
  app: LaunchedApp,
  batchId: number
): Promise<OutboundBatchStatusData> {
  const response = await invokeOutboundEnvelope(
    app,
    "outbound:email:batch:status",
    {
      batchId,
    }
  );
  return (response.data ?? {}) as OutboundBatchStatusData;
}

test("duplicate send claim cannot start a second attempt (FR-OUT-006)", async ({
  aiApp,
  fakeAi,
}) => {
  test.setTimeout(150_000);
  const smtp = await startDroppingSmtpServer();
  try {
    const serviceId = await seedDroppingSmtpService(aiApp, smtp.port);
    const batchId = await draftBatchViaTool(aiApp, fakeAi, serviceId);

    // Mirrors the dialog: GET (fills missing senders), then approve with the
    // loaded hash. The handler returns the raw token ONCE; only the id + the
    // post-fill hash are needed for the claim triple.
    const getResponse = await invokeOutboundEnvelope(
      aiApp,
      "outbound:email:batch:get",
      { batchId }
    );
    expect(getResponse.status).toBe(true);
    const batchData = getResponse.data as {
      batch?: { batchHash?: string };
      drafts?: Array<{ id?: number }>;
    } | null;
    const batchHash = batchData?.batch?.batchHash ?? "";
    const draftId = batchData?.drafts?.[0]?.id ?? 0;
    expect(batchHash).toMatch(/^[0-9a-f]{64}$/);
    expect(draftId).toBeGreaterThan(0);

    const approveResponse = await invokeOutboundEnvelope(
      aiApp,
      "outbound:email:batch:approve",
      { batchId, batchHash }
    );
    expect(
      approveResponse.status,
      `approve failed: ${approveResponse.msg}`
    ).toBe(true);
    const approval = approveResponse.data as {
      authorizationId?: number;
      batchHash?: string;
    } | null;
    const authorizationId = approval?.authorizationId ?? 0;
    const claimHash = approval?.batchHash ?? "";
    expect(authorizationId).toBeGreaterThan(0);

    const sendPayload = { batchId, authorizationId, batchHash: claimHash };

    // First claim — wins the attempt and starts the production worker
    // against the dropping SMTP server.
    const first = await invokeOutboundEnvelope(
      aiApp,
      "outbound:email:batch:send",
      sendPayload
    );
    expect(first.status, `first send failed: ${first.msg}`).toBe(true);
    const firstData = first.data as { status?: string; attemptId?: number };
    expect(firstData.status).toBe("claimed");
    const attemptId = firstData.attemptId ?? 0;
    expect(attemptId).toBeGreaterThan(0);

    // Repeated click / stale renderer retry: the SAME claim triple must
    // collapse into already_processed bound to the ORIGINAL attempt, never a
    // second delivery.
    const second = await invokeOutboundEnvelope(
      aiApp,
      "outbound:email:batch:send",
      sendPayload
    );
    expect(second.status, `duplicate send errored: ${second.msg}`).toBe(true);
    const secondData = second.data as { status?: string; attemptId?: number };
    expect(secondData.status).toBe("already_processed");
    expect(secondData.attemptId).toBe(attemptId);

    // Exactly one attempt and one outcome settle — delivery_unknown like the
    // canonical journey; the duplicate created nothing extra.
    await expect
      .poll(async () => await readBatchStatus(aiApp, batchId), {
        timeout: 60_000,
      })
      .toEqual({
        batchStatus: "delivery_unknown",
        attempt: { id: attemptId, status: "completed" },
        outcomes: [
          {
            draftId,
            recipientAddress: "e2e-recipient@example.com",
            status: "delivery_unknown",
            id: expect.any(Number),
            errorCode: expect.anything(),
            providerMessageId: null,
          },
        ],
      });
  } finally {
    await smtp.close();
  }
});

test("receipt stays after dialog close and reopening shows delivery progress (FR-OUT-009)", async ({
  aiApp,
  fakeAi,
}) => {
  test.setTimeout(150_000);
  const smtp = await startDroppingSmtpServer();
  try {
    const serviceId = await seedDroppingSmtpService(aiApp, smtp.port);
    const batchId = await draftBatchViaTool(aiApp, fakeAi, serviceId);

    // Full dialog journey: review → approve → send (UI clicks).
    await aiApp.mainWindow.getByTestId("outbound-batch-review").click();
    const approveBtn = aiApp.mainWindow.getByTestId("outbound-review-approve");
    const sendBtn = aiApp.mainWindow.getByTestId("outbound-review-send");
    await expect(approveBtn).toBeVisible({ timeout: 15_000 });
    await approveBtn.click();
    await expect(sendBtn).toBeEnabled({ timeout: 15_000 });
    await sendBtn.click();
    // The dialog closes itself after the claim.
    await expect(chatRoot(aiApp)).toBeVisible({ timeout: 15_000 });

    // The transcript receipt is NOT discarded with the dialog: the batch
    // card stays attached to the message row.
    await expect(
      aiApp.mainWindow.getByTestId("workspace-outbound-batch")
    ).toBeVisible({ timeout: 15_000 });

    // Wait for the attempt to settle at delivery_unknown, then reopen the
    // dialog — it must still render the terminal delivery progress.
    await expect
      .poll(async () => (await readBatchStatus(aiApp, batchId)).batchStatus, {
        timeout: 60_000,
      })
      .toBe("delivery_unknown");

    await aiApp.mainWindow.getByTestId("outbound-batch-review").click();
    const progressTitle = aiApp.mainWindow
      .locator(".outbound-progress__header")
      .getByText("Delivery Progress");
    await expect(progressTitle).toBeVisible({ timeout: 15_000 });
    const outcomeRow = aiApp.mainWindow.locator(
      '[data-testid^="outbound-progress-row-"]'
    );
    await expect(outcomeRow).toHaveCount(1, { timeout: 15_000 });
    await expect(outcomeRow.first()).toContainText("Delivery Unknown");
    // §18: delivery_unknown never offers one-click retry — the note is shown.
    await expect(outcomeRow.first()).toContainText("do not auto-retry");
  } finally {
    await smtp.close();
  }
});
