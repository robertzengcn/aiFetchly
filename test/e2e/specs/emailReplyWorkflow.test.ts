/**
 * Critical reply-workflow E2E spec (G03 — todo item 1).
 *
 * Drives the real renderer → preload → IPC → service → SQLite chain for the
 * §5/§7/§9 gate workflows that the audit-evidence spec cannot reach. Every
 * refusal here is produced by the PRODUCTION handlers (no mocks): the typed
 * code / next_action fields flow through dispatchValidated's duck-typed
 * failure envelope exactly as the renderer and the AI tool consume them.
 *
 * Covered (each against the loopback-only E2E network):
 *
 *   1. already_replied refusal at DRAFT_CREATE — a message with local sent
 *      state refuses BEFORE the model runs (zero FakeAi requests), with
 *      next_action routed to await_human_review (R22 semantics).
 *   2. A clean message with no receive config still reaches draft generation.
 *      Mailbox reply detection is check_email_replied, not create-draft.
 *   3. Approval binding → fresh send check — the seeded approval token drives
 *      the real EMAIL_REPLY_SEND; the forced pre-send detection refuses with
 *      receive_unavailable BEFORE the atomic claim, so the attempt ledger is
 *      EMPTY afterwards (§9 quiescence: no attempt row, no SMTP).
 *   4. Definitely-failed retry (R13) — re-approving a failed draft reopens it
 *      (preserving revision + hash), issues a NEW one-time token, and a send
 *      attempt under that token still refuses pre-claim: the ledger shows
 *      EXACTLY the one seeded failed attempt.
 *   5. CHECK_REPLIED positive DTO — the seeded sent state settles the
 *      diagnostic check with the full typed result shape.
 *   6. Translated failure guidance (FR-034) — a real refusal audit row
 *      (written by the production pre-draft gate) renders its typed code
 *      through the audit UI's i18n map and the derived next-action chip.
 *
 * Not provable here (documented in the todo's E2E-boundary paragraph): the
 * eligible-reuse SUCCESS path, the happy-path send (no SMTP server in the E2E
 * network), delayed-send freshness, and recovery races — those are covered by
 * the vitest integration suites with injected ports.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import type { LaunchedApp } from "../fixtures/electronApp";

/** Standard validated-IPC failure envelope (typed fields sit at the top). */
interface FailureEnvelope {
  status: boolean;
  msg?: string;
  data: null;
  code?: string;
  next_action?: string;
  existing_draft_id?: number;
  requestCorrelationId?: string;
}

/** EMAIL_REPLY_SEND_ATTEMPT_DETAIL response shape. */
interface AttemptDetail {
  status: boolean;
  data: {
    records: readonly {
      id: number;
      status: string;
      failureCode: string | null;
      sanitizedError: string | null;
    }[];
  };
}

/** EMAIL_REPLY_CHECK_REPLIED response shape (data side). */
interface CheckRepliedDto {
  success: boolean;
  message_id: number;
  state: string;
  replied: boolean | null;
  source: string;
  reason_code: string;
  matched_message_id: string | null;
  checked_at: string | null;
  from_cache: boolean;
  coverage: string;
}

/** Preload bridge surface (subset used by these scenarios). */
interface PreloadApi {
  invoke: (
    channel: string,
    data?: unknown
  ) => Promise<
    | {
        status: boolean;
        data: unknown;
        msg?: string;
        code?: string;
        next_action?: string;
        existing_draft_id?: number;
      }
    | undefined
  >;
}

/**
 * Invoke a whitelisted channel through the real preload bridge and return the
 * full envelope (typed failure fields included).
 */
async function invoke(
  app: LaunchedApp,
  channel: string,
  payload: Record<string, unknown>
): Promise<{
  status: boolean;
  data: unknown;
  msg?: string;
  code?: string;
  next_action?: string;
  existing_draft_id?: number;
}> {
  const result = await app.mainWindow.evaluate(
    async ({ ch, data }: { ch: string; data: Record<string, unknown> }) => {
      const api = (window as unknown as { api: PreloadApi }).api;
      return api.invoke(ch, JSON.stringify(data));
    },
    { ch: channel, data: payload }
  );
  expect(result, `invoke ${channel} returned undefined`).toBeDefined();
  return result!;
}

/** Seed one email-service row (status 1, no receive fields) and return id. */
async function seedService(app: LaunchedApp, name: string): Promise<number> {
  const result = await invoke(app, "e2e:seed-email-service", {
    name,
    from: "e2e-workflow-sender@example.com",
    password: "e2e-plaintext-pass",
    host: "127.0.0.1",
    port: "143",
    ssl: 0,
    status: 1,
  });
  expect(result.status, `seed service failed: ${result.msg ?? "?"}`).toBe(true);
  const id = (result.data as { id?: unknown } | undefined)?.id;
  expect(typeof id).toBe("number");
  return id as number;
}

/** Seed one received message through the production upsert path. */
async function seedMessage(
  app: LaunchedApp,
  input: {
    emailServiceId: number;
    providerUid: string;
    messageId: string;
    fromAddress: string;
    subject: string;
    replyStatus: string;
    isAnswered?: number;
  }
): Promise<number> {
  const result = await invoke(app, "e2e:seed-received-message", {
    ...input,
    toAddresses: ["e2e-workflow-sender@example.com"],
  });
  expect(result.status, `seed message failed: ${result.msg ?? "?"}`).toBe(true);
  const id = (result.data as { id?: unknown } | undefined)?.id;
  expect(typeof id).toBe("number");
  return id as number;
}

interface ReplyDraftSeed {
  id: number;
  revisionId: number;
  revisionNumber: number;
  contentHash: string;
  approvalId: number;
  token: string;
}

/**
 * Seed an approval-ready reply draft (draft + revision 1 + approval) through
 * the production Model/service layer. The one-time token is returned ONCE.
 * senderAddress must equal the seeded service's `from` and recipientAddress
 * the message's `fromAddress` (v1 envelope binding gates at send time).
 */
async function seedReplyDraft(
  app: LaunchedApp,
  input: {
    emailServiceId: number;
    messageId: number;
    subject: string;
    bodyText: string;
    senderAddress: string;
    recipientAddress: string;
    seedFailedAttempt?: boolean;
  }
): Promise<ReplyDraftSeed> {
  const result = await invoke(app, "e2e:seed-reply-draft", input);
  expect(result.status, `seed reply draft failed: ${result.msg ?? "?"}`).toBe(
    true
  );
  const data = result.data as ReplyDraftSeed | undefined;
  expect(typeof data?.id).toBe("number");
  expect(typeof data?.token).toBe("string");
  return data as ReplyDraftSeed;
}

test.describe("Critical reply workflows (G03)", () => {
  test.afterEach(({ app, aiApp, disabledApp }) => {
    const a = app ?? aiApp ?? disabledApp;
    if (!a) return;
    assertCleanTeardown(a);
  });

  test("positive local evidence refuses draft creation before any model call; next_action routes to human review", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(150_000);
    const serviceId = await seedService(aiApp, "E2E Workflow Sent Sender");
    // replyStatus "sent" → §7.1 step-1 local-first short-circuit → the
    // pre-draft policy gate denies before classification or the LLM.
    const messageId = await seedMessage(aiApp, {
      emailServiceId: serviceId,
      providerUid: "e2e-wf-sent-1",
      messageId: "<e2e-wf-original-1@example.com>",
      fromAddress: "e2e-recipient@example.com",
      subject: "E2E workflow already-replied original",
      replyStatus: "sent",
      isAnswered: 1,
    });

    const refusal = (await invoke(aiApp, "email:reply:draft:create", {
      messageId,
    })) as FailureEnvelope;
    expect(refusal.status).toBe(false);
    expect(refusal.code).toBe("already_replied");
    // R22: refusal-side next_action NEVER suggests approving a draft.
    expect(refusal.next_action).toBe("await_human_review");
    expect(refusal.data).toBeNull();
    expect(refusal.msg).toContain("already_replied");

    // Zero-AI-call guarantee (B01): the guard ran before classification, so
    // the FakeAi loopback server recorded nothing.
    await expect
      .poll(async () => (await fakeAi.getRequests()).length, {
        timeout: 15_000,
      })
      .toEqual(0);
  });

  test("a clean message reaches draft generation without a mailbox reply probe", async ({
    aiApp,
    fakeAi,
  }) => {
    test.setTimeout(150_000);
    const serviceId = await seedService(aiApp, "E2E Workflow NoRecv Sender");
    // No receive config. Draft creation must not refuse with
    // receive_unavailable; that check belongs to check_email_replied and to
    // send. The model is reached.
    const messageId = await seedMessage(aiApp, {
      emailServiceId: serviceId,
      providerUid: "e2e-wf-norecv-1",
      messageId: "<e2e-wf-original-2@example.com>",
      fromAddress: "e2e-recipient@example.com",
      subject: "E2E workflow draft without probe",
      replyStatus: "not_started",
    });

    const result = (await invoke(aiApp, "email:reply:draft:create", {
      messageId,
    })) as FailureEnvelope;
    expect(result.code).not.toBe("receive_unavailable");
    await expect
      .poll(async () => (await fakeAi.getRequests()).length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
  });

  test("approval token binds to send; fresh pre-send detection refuses before the claim leaves any attempt row", async ({
    aiApp,
  }) => {
    test.setTimeout(150_000);
    const serviceId = await seedService(aiApp, "E2E Workflow Quiesce Sender");
    const messageId = await seedMessage(aiApp, {
      emailServiceId: serviceId,
      providerUid: "e2e-wf-quiesce-1",
      messageId: "<e2e-wf-original-3@example.com>",
      fromAddress: "e2e-recipient@example.com",
      subject: "E2E workflow send-quiescence original",
      replyStatus: "not_started",
    });
    // v1 envelope binding: sender = service.from, recipient = message.from.
    const seed = await seedReplyDraft(aiApp, {
      emailServiceId: serviceId,
      messageId,
      subject: "Re: E2E workflow send-quiescence original",
      bodyText: "E2E workflow quiescence reply body",
      senderAddress: "e2e-workflow-sender@example.com",
      recipientAddress: "e2e-recipient@example.com",
    });

    // The real send path: token resolve → binding → policy → forced §7.1
    // pre-send detection (forceRefresh: true) → receive_unavailable refusal
    // BEFORE the atomic claim.
    const sendResult = (await invoke(aiApp, "email:reply:send", {
      draftId: seed.id,
      approvalToken: seed.token,
    })) as FailureEnvelope;
    expect(sendResult.status).toBe(false);
    expect(sendResult.code).toBe("receive_unavailable");
    expect(sendResult.data).toBeNull();

    // §9 quiescence: no attempt row exists after the pre-claim refusal.
    const detail = (await invoke(
      aiApp,
      "email:reply:send:attempt:detail",
      { draftId: seed.id }
    )) as { status: boolean; data: { records: readonly unknown[] } };
    expect(detail.status).toBe(true);
    expect(detail.data.records).toHaveLength(0);
  });

  test("definitely-failed draft re-approves (R13 reopen) and the retry send refuses pre-claim, leaving exactly the seeded failed attempt", async ({
    aiApp,
  }) => {
    test.setTimeout(150_000);
    const serviceId = await seedService(aiApp, "E2E Workflow Retry Sender");
    const messageId = await seedMessage(aiApp, {
      emailServiceId: serviceId,
      providerUid: "e2e-wf-retry-1",
      messageId: "<e2e-wf-original-4@example.com>",
      fromAddress: "e2e-recipient@example.com",
      subject: "E2E workflow failed-retry original",
      replyStatus: "not_started",
    });
    // seedFailedAttempt: one definitely-failed attempt + draft status
    // "failed" — the B08/R13 retry fixture.
    const seed = await seedReplyDraft(aiApp, {
      emailServiceId: serviceId,
      messageId,
      subject: "Re: E2E workflow failed-retry original",
      bodyText: "E2E workflow retry reply body",
      senderAddress: "e2e-workflow-sender@example.com",
      recipientAddress: "e2e-recipient@example.com",
      seedFailedAttempt: true,
    });

    // The real approve channel reopens the failed draft: revision + content
    // hash preserved, a NEW approval row + one-time token issued.
    const approve = (await invoke(aiApp, "email:reply:draft:approve", {
      draftId: seed.id,
    })) as {
      status: boolean;
      msg?: string;
      data?: {
        approvalId: number;
        token: string;
        revisionId: number;
        contentHash: string;
      };
    };
    expect(approve.status, `approve failed: ${approve.msg ?? "?"}`).toBe(true);
    expect(approve.data?.token).toBeTruthy();
    expect(typeof approve.data?.approvalId).toBe("number");
    // R13: the reopen preserves the original revision and hash.
    expect(approve.data?.revisionId).toBe(seed.revisionId);
    expect(approve.data?.contentHash).toBe(seed.contentHash);

    // The retry send under the NEW token still refuses pre-claim (the same
    // deterministic receive_unavailable probe), so nothing is delivered.
    const sendResult = (await invoke(aiApp, "email:reply:send", {
      draftId: seed.id,
      approvalToken: approve.data!.token,
    })) as FailureEnvelope;
    expect(sendResult.status).toBe(false);
    expect(sendResult.code).toBe("receive_unavailable");

    // Exactly ONE attempt — the seeded failed one; the refused retry never
    // reached the claim step.
    const detail = (await invoke(
      aiApp,
      "email:reply:send:attempt:detail",
      { draftId: seed.id }
    )) as AttemptDetail;
    expect(detail.status).toBe(true);
    expect(detail.data.records).toHaveLength(1);
    expect(detail.data.records[0]?.status).toBe("failed");
    expect(detail.data.records[0]?.failureCode).toBe("smtp_rejected");
  });

  test("check_email_replied returns the full typed positive DTO from seeded sent state", async ({
    aiApp,
  }) => {
    test.setTimeout(150_000);
    const serviceId = await seedService(aiApp, "E2E Workflow Check Sender");
    const messageId = await seedMessage(aiApp, {
      emailServiceId: serviceId,
      providerUid: "e2e-wf-check-1",
      messageId: "<e2e-wf-original-5@example.com>",
      fromAddress: "e2e-recipient@example.com",
      subject: "E2E workflow check-replied original",
      replyStatus: "sent",
      isAnswered: 1,
    });

    const resp = (await invoke(aiApp, "email:reply:check:replied", {
      messageId,
    })) as { status: boolean; data?: CheckRepliedDto; msg?: string };
    expect(resp.status, `check failed: ${resp.msg ?? "?"}`).toBe(true);
    const dto = resp.data;
    expect(dto?.success).toBe(true);
    expect(dto?.message_id).toBe(messageId);
    expect(dto?.state).toBe("replied");
    expect(dto?.replied).toBe(true);
    expect(dto?.source).toBe("local_state");
    expect(dto?.reason_code).toBe("already_replied");
    expect(dto?.matched_message_id).toBeNull();
    expect(dto?.from_cache).toBe(true);
    expect(dto?.coverage).toBe("local_only");
  });

  test("a real refusal audit renders the translated code label and the derived next-action chip (FR-034)", async ({
    aiApp,
  }) => {
    test.setTimeout(150_000);
    const serviceId = await seedService(aiApp, "E2E Workflow Audit Sender");
    const messageId = await seedMessage(aiApp, {
      emailServiceId: serviceId,
      providerUid: "e2e-wf-audit-1",
      messageId: "<e2e-wf-original-6@example.com>",
      fromAddress: "e2e-recipient@example.com",
      subject: "E2E workflow refusal-guidance original",
      replyStatus: "sent",
      isAnswered: 1,
    });

    // Local sent state still refuses at the pre-draft policy gate, so the
    // audit row is written by production (not a seeded audit row).
    const refusal = (await invoke(aiApp, "email:reply:draft:create", {
      messageId,
    })) as FailureEnvelope;
    expect(refusal.status).toBe(false);
    expect(refusal.code).toBe("already_replied");

    // The audit UI surfaces the typed code through the i18n map
    // (emailReply.policyCode.already_replied) and the derived next action
    // (emailReply.nextAction.await_human_review).
    const page = aiApp.mainWindow;
    await page.evaluate(() => {
      window.location.hash = "/emailmarketing/emailreply/audit/list";
    });
    await expect(page.getByTestId("email-auto-reply-audit-list")).toBeVisible({
      timeout: 15_000,
    });
    // Refusal rows carry no subject fields, so filter on the rendered
    // evidence chip text rather than the message subject.
    await page
      .locator("tbody tr")
      .filter({ hasText: "Already replied" })
      .locator('[data-testid="audit-row-open"]')
      .click();
    await expect(page.getByTestId("audit-detail-evidence-chip")).toContainText(
      "Already replied",
      { timeout: 15_000 }
    );
    await expect(page.getByTestId("audit-detail-stage")).toContainText(
      "pre_draft"
    );
    // R22: the refusal-derived next action routes to human review.
    await expect(page.getByTestId("audit-detail-next-action")).toContainText(
      "Await human review",
      { timeout: 15_000 }
    );
  });
});
