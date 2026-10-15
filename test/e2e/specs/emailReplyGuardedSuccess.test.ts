/**
 * Guarded reply success + reconciliation E2E spec (G04, with the G02 loop).
 *
 * Exercises REAL cross-layer production wiring — renderer → preload → IPC →
 * service → SQLite, plus real loopback IMAP (the §7.1 probe) and loopback
 * SMTP (the delivery handoff). No injected Vitest ports: the detection
 * service opens genuine IMAP connections to the in-process fake server and
 * the delivery service submits through real nodemailer to the in-process
 * fake SMTP server.
 *
 * Covered:
 *
 *   1. Happy path — eligible draft → approval → forced pre-send probe
 *      (complete negative from loopback IMAP) → atomic claim → fresh
 *      post-claim gate → SMTP accept → sent. Exactly one SMTP message with
 *      thread-correct In-Reply-To/References; attempt + draft + message all
 *      `sent`; `reply_sent` audit mirrored as `auto_sent`.
 *   2. G02 flagged loop — model-flagged draft refuses approval → stale
 *      resolution refuses → explicit revision-bound resolution → approval →
 *      send succeeds. The model's reasons stay intact.
 *   3. Unknown + leave_unresolved — SMTP blackhole (refused loopback port)
 *      ends delivery in `delivery_unknown`; reconciliation
 *      `leave_unresolved` keeps the ambiguity, mirrors
 *      `needs_human_review` (never `failed`); `confirm_not_sent` then
 *      reopens to a fresh approval (N06 retry requirement).
 *   4. Unknown + confirm_sent — operator-verified delivery upgrades the
 *      ambiguous attempt to `sent`.
 */

import { createHash } from "node:crypto";
import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import { startFakeSmtpServer } from "../fixtures/fakeSmtpServer";
import { startFakeImapServer } from "../fixtures/fakeImapServer";
import type { LaunchedApp } from "../fixtures/electronApp";

/** Standard validated-IPC failure envelope (typed fields sit at the top). */
interface FailureEnvelope {
  status: boolean;
  msg?: string;
  data: null;
  code?: string;
  next_action?: string;
  requestCorrelationId?: string;
}

interface AttemptRecord {
  id: number;
  status: string;
  failureCode: string | null;
  sanitizedError: string | null;
}

const IMAP_UID_VALIDITY = 424242;
const IMAP_UID = 1;
const SENDER = "e2e-guarded-sender@example.com";
const RECIPIENT = "e2e-recipient@example.com";
const IMAP_PASS = "e2e-plaintext-pass";

/** Replicates buildNamespacedProviderUid({folder, uidValidity, uid}). */
function namespacedUid(folder: string, validity: number, uid: number): string {
  const folderHash = createHash("sha256")
    .update(folder, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `imap:${folderHash}:${validity}:${uid}`;
}

async function invoke(
  app: LaunchedApp,
  channel: string,
  payload: Record<string, unknown>
): Promise<{ status: boolean; data: unknown; msg?: string; code?: string }> {
  const result = await app.mainWindow.evaluate(
    async ({ ch, data }: { ch: string; data: Record<string, unknown> }) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (
              channel: string,
              data?: unknown
            ) => Promise<
              | { status: boolean; data: unknown; msg?: string; code?: string }
              | undefined
            >;
          };
        }
      ).api;
      return api.invoke(ch, JSON.stringify(data));
    },
    { ch: channel, data: payload }
  );
  expect(result, `invoke ${channel} returned undefined`).toBeDefined();
  return result!;
}

async function seedImapService(
  app: LaunchedApp,
  input: {
    name: string;
    smtpPort: string;
    imapPort: string;
  }
): Promise<number> {
  const result = await invoke(app, "e2e:seed-email-service", {
    name: input.name,
    from: SENDER,
    password: IMAP_PASS,
    host: "127.0.0.1",
    port: input.smtpPort,
    ssl: 0,
    status: 1,
    receiveEnabled: 1,
    imapHost: "127.0.0.1",
    imapPort: input.imapPort,
    imapSsl: 0,
    receiveFolder: "INBOX",
  });
  expect(result.status, `seed service failed: ${result.msg ?? "?"}`).toBe(true);
  return (result.data as { id: number }).id;
}

async function seedImapMessage(
  app: LaunchedApp,
  input: { emailServiceId: number; providerUid: string; messageId: string }
): Promise<number> {
  const result = await invoke(app, "e2e:seed-received-message", {
    emailServiceId: input.emailServiceId,
    providerUid: input.providerUid,
    messageId: input.messageId,
    fromAddress: RECIPIENT,
    toAddresses: [SENDER],
    subject: "E2E guarded original",
    replyStatus: "not_started",
    providerFolder: "INBOX",
    providerUidValidity: String(IMAP_UID_VALIDITY),
  });
  expect(result.status, `seed message failed: ${result.msg ?? "?"}`).toBe(true);
  return (result.data as { id: number }).id;
}

async function seedDraft(
  app: LaunchedApp,
  input: {
    emailServiceId: number;
    messageId: number;
    flagged?: boolean;
  }
): Promise<{
  id: number;
  revisionId: number;
  contentHash: string;
  approvalId: number;
  token: string;
}> {
  const result = await invoke(app, "e2e:seed-reply-draft", {
    emailServiceId: input.emailServiceId,
    messageId: input.messageId,
    subject: "Re: E2E guarded original",
    bodyText: "E2E guarded reply body with enough detail to send",
    senderAddress: SENDER,
    recipientAddress: RECIPIENT,
    ...(input.flagged === true
      ? {
          requiresHumanReview: 1,
          reviewReasonsJson: JSON.stringify(["e2e review reason"]),
          unresolvedQuestionsJson: JSON.stringify(["e2e open question"]),
        }
      : {}),
  });
  expect(result.status, `seed draft failed: ${result.msg ?? "?"}`).toBe(true);
  return result.data as {
    id: number;
    revisionId: number;
    contentHash: string;
    approvalId: number;
    token: string;
  };
}

test.describe("Guarded reply success + reconciliation (G04/G02)", () => {
  test.afterEach(({ app, aiApp, disabledApp }) => {
    const a = app ?? aiApp ?? disabledApp;
    if (!a) return;
    assertCleanTeardown(a);
  });

  test("eligible draft → approval → probe → claim → SMTP accept → sent, one thread-correct message", async ({
    aiApp,
  }) => {
    test.setTimeout(180_000);
    const smtp = await startFakeSmtpServer();
    const imap = await startFakeImapServer({
      user: SENDER,
      pass: IMAP_PASS,
      folders: {
        INBOX: {
          uidValidity: IMAP_UID_VALIDITY,
          messages: [{ uid: IMAP_UID, flags: ["\\Seen"] }],
        },
        Sent: { uidValidity: 777, messages: [] },
      },
    });
    try {
      const serviceId = await seedImapService(aiApp, {
        name: "E2E Guarded Happy Sender",
        smtpPort: String(smtp.port),
        imapPort: String(imap.port),
      });
      const originalId = "<e2e-guarded-happy-1@example.com>";
      const messageId = await seedImapMessage(aiApp, {
        emailServiceId: serviceId,
        providerUid: namespacedUid("INBOX", IMAP_UID_VALIDITY, IMAP_UID),
        messageId: originalId,
      });
      const seed = await seedDraft(aiApp, {
        emailServiceId: serviceId,
        messageId,
      });

      const sendResult = await invoke(aiApp, "email:reply:send", {
        draftId: seed.id,
        approvalToken: seed.token,
      });
      expect(sendResult.status, `send failed: ${sendResult.msg ?? "?"}`).toBe(
        true
      );
      const outcome = sendResult.data as {
        status: string;
        attemptId: number;
      };
      expect(outcome.status).toBe("sent");
      expect(typeof outcome.attemptId).toBe("number");

      // Exactly one SMTP submission, thread-correct and addressed.
      expect(smtp.recordedMessages).toHaveLength(1);
      const recorded = smtp.recordedMessages[0];
      expect(recorded?.rcptTo).toContain(RECIPIENT);
      expect(recorded?.headers["in-reply-to"] ?? "").toContain(
        "e2e-guarded-happy-1@example.com"
      );
      expect(recorded?.headers["references"] ?? "").toContain(
        "e2e-guarded-happy-1@example.com"
      );

      // Attempt + draft + message all terminal-sent.
      const detail = (await invoke(aiApp, "email:reply:send:attempt:detail", {
        draftId: seed.id,
      })) as { status: boolean; data: { records: AttemptRecord[] } };
      expect(detail.status).toBe(true);
      expect(detail.data.records).toHaveLength(1);
      expect(detail.data.records[0]?.status).toBe("sent");

      const draftDetail = (await invoke(aiApp, "email:reply:draft:detail", {
        id: seed.id,
      })) as { status: boolean; data: { status: string } };
      expect(draftDetail.status).toBe(true);
      expect(draftDetail.data.status).toBe("sent");

      // The reply_sent audit mirrors as auto_sent in the UI table.
      const audits = (await invoke(aiApp, "email:autoreply:audit:list", {
        page: 0,
        size: 20,
        decisionStatus: "auto_sent",
      })) as {
        status: boolean;
        data: { records: { draftId: number | null }[]; num: number };
      };
      expect(audits.status).toBe(true);
      expect(
        audits.data.records.some((r) => r.draftId === seed.id)
      ).toBe(true);
    } finally {
      await imap.close();
      await smtp.close();
    }
  });

  test("flagged draft refuses approval, resolves explicitly, then approves + sends (G02 loop)", async ({
    aiApp,
  }) => {
    test.setTimeout(180_000);
    const smtp = await startFakeSmtpServer();
    const imap = await startFakeImapServer({
      user: SENDER,
      pass: IMAP_PASS,
      folders: {
        INBOX: {
          uidValidity: IMAP_UID_VALIDITY,
          messages: [{ uid: IMAP_UID, flags: ["\\Seen"] }],
        },
        Sent: { uidValidity: 777, messages: [] },
      },
    });
    try {
      const serviceId = await seedImapService(aiApp, {
        name: "E2E Guarded Flagged Sender",
        smtpPort: String(smtp.port),
        imapPort: String(imap.port),
      });
      const messageId = await seedImapMessage(aiApp, {
        emailServiceId: serviceId,
        providerUid: namespacedUid("INBOX", IMAP_UID_VALIDITY, IMAP_UID),
        messageId: "<e2e-guarded-flagged-1@example.com>",
      });
      const seed = await seedDraft(aiApp, {
        emailServiceId: serviceId,
        messageId,
        flagged: true,
      });

      // The detail DTO surfaces the model's flag + reasons.
      const flagged = (await invoke(aiApp, "email:reply:draft:detail", {
        id: seed.id,
      })) as {
        status: boolean;
        data: { requiresHumanReview: boolean; reviewReasonsJson: string | null };
      };
      expect(flagged.status).toBe(true);
      expect(flagged.data.requiresHumanReview).toBe(true);
      expect(flagged.data.reviewReasonsJson).toContain("e2e review reason");

      // Approval refuses while unresolved.
      const refused = (await invoke(aiApp, "email:reply:draft:approve", {
        draftId: seed.id,
      })) as FailureEnvelope;
      expect(refused.status).toBe(false);
      expect(refused.msg ?? "").toContain("human review");

      // A stale (wrong-revision) resolution refuses without unlocking.
      const stale = (await invoke(aiApp, "email:reply:draft:resolve-review", {
        draftId: seed.id,
        revisionId: seed.revisionId + 999999,
      })) as { status: boolean; data: { resolved: boolean } };
      expect(stale.status).toBe(true);
      expect(stale.data.resolved).toBe(false);

      // Explicit revision-bound resolution, then approval + send succeed.
      const resolved = (await invoke(
        aiApp,
        "email:reply:draft:resolve-review",
        {
          draftId: seed.id,
          revisionId: seed.revisionId,
          note: "e2e operator checked the draft",
        }
      )) as { status: boolean; data: { resolved: boolean } };
      expect(resolved.status).toBe(true);
      expect(resolved.data.resolved).toBe(true);

      const approve = (await invoke(aiApp, "email:reply:draft:approve", {
        draftId: seed.id,
      })) as { status: boolean; msg?: string; data: { token: string } };
      expect(approve.status, `approve failed: ${approve.msg ?? "?"}`).toBe(
        true
      );

      const sendResult = await invoke(aiApp, "email:reply:send", {
        draftId: seed.id,
        approvalToken: approve.data.token,
      });
      expect(sendResult.status, `send failed: ${sendResult.msg ?? "?"}`).toBe(
        true
      );
      expect((sendResult.data as { status: string }).status).toBe("sent");
      expect(smtp.recordedMessages).toHaveLength(1);
    } finally {
      await imap.close();
      await smtp.close();
    }
  });

  test("SMTP mid-greeting drop → delivery_unknown → leave_unresolved keeps ambiguity; confirm_not_sent reopens to fresh approval", async ({
    aiApp,
  }) => {
    test.setTimeout(180_000);
    // Ambiguous transport failure (FR-019): the server accepts the TCP
    // connection then drops it, so submission may have begun — the delivery
    // must end in delivery_unknown, never a definite failure. (A refused
    // port would be a definite pre-acceptance rejection → `failed`.)
    const smtp = await startFakeSmtpServer();
    smtp.setDropAfterGreeting(true);
    const imap = await startFakeImapServer({
      user: SENDER,
      pass: IMAP_PASS,
      folders: {
        INBOX: {
          uidValidity: IMAP_UID_VALIDITY,
          messages: [{ uid: IMAP_UID, flags: ["\\Seen"] }],
        },
        Sent: { uidValidity: 777, messages: [] },
      },
    });
    try {
      const serviceId = await seedImapService(aiApp, {
        name: "E2E Guarded Unknown Sender",
        smtpPort: String(smtp.port),
        imapPort: String(imap.port),
      });
      const messageId = await seedImapMessage(aiApp, {
        emailServiceId: serviceId,
        providerUid: namespacedUid("INBOX", IMAP_UID_VALIDITY, IMAP_UID),
        messageId: "<e2e-guarded-unknown-1@example.com>",
      });
      const seed = await seedDraft(aiApp, {
        emailServiceId: serviceId,
        messageId,
      });

      // SMTP is unreachable: the send ends in delivery_unknown (FR-019 —
      // a refused connection is ambiguous, never a definite failure).
      const sendResult = await invoke(aiApp, "email:reply:send", {
        draftId: seed.id,
        approvalToken: seed.token,
      });
      expect(sendResult.status, `send failed: ${sendResult.msg ?? "?"}`).toBe(
        true
      );
      expect((sendResult.data as { status: string }).status).toBe(
        "delivery_unknown"
      );

      const detail = (await invoke(aiApp, "email:reply:send:attempt:detail", {
        draftId: seed.id,
      })) as { status: boolean; data: { records: AttemptRecord[] } };
      expect(detail.data.records).toHaveLength(1);
      const unknownAttempt = detail.data.records[0];
      expect(unknownAttempt?.status).toBe("delivery_unknown");
      expect(typeof unknownAttempt?.id).toBe("number");
      const attemptId = unknownAttempt?.id as number;

      // leave_unresolved: no state change, audit keeps the ambiguity with
      // human-review guidance (N09 — never presented as failed).
      const left = (await invoke(aiApp, "email:reply:delivery:reconcile", {
        attemptId,
        action: "leave_unresolved",
      })) as { status: boolean; data: { reconciled: boolean } };
      expect(left.status).toBe(true);
      expect(left.data.reconciled).toBe(false);

      const stillUnknown = (await invoke(
        aiApp,
        "email:reply:send:attempt:detail",
        { draftId: seed.id }
      )) as { status: boolean; data: { records: AttemptRecord[] } };
      expect(stillUnknown.data.records[0]?.status).toBe("delivery_unknown");

      const reviewRows = (await invoke(aiApp, "email:autoreply:audit:list", {
        page: 0,
        size: 20,
        decisionStatus: "needs_human_review",
        search: "leave_unresolved",
      })) as {
        status: boolean;
        data: { records: unknown[]; num: number };
      };
      expect(reviewRows.status).toBe(true);
      expect(reviewRows.data.num).toBeGreaterThanOrEqual(1);

      // confirm_not_sent on the still-ambiguous attempt: failed + draft
      // reopened, and a FRESH approval is issuable (N06 retry requirement).
      const downgraded = (await invoke(
        aiApp,
        "email:reply:delivery:reconcile",
        {
          attemptId,
          action: "confirm_not_sent",
          evidence: "e2e operator verified nothing was sent",
        }
      )) as { status: boolean; data: { reconciled: boolean } };
      expect(downgraded.status).toBe(true);
      expect(downgraded.data.reconciled).toBe(true);

      const failedDetail = (await invoke(
        aiApp,
        "email:reply:send:attempt:detail",
        { draftId: seed.id }
      )) as { status: boolean; data: { records: AttemptRecord[] } };
      expect(failedDetail.data.records[0]?.status).toBe("failed");

      const freshApproval = (await invoke(aiApp, "email:reply:draft:approve", {
        draftId: seed.id,
      })) as { status: boolean; msg?: string; data: { token: string } };
      expect(
        freshApproval.status,
        `re-approve failed: ${freshApproval.msg ?? "?"}`
      ).toBe(true);
      expect(freshApproval.data.token).toBeTruthy();
    } finally {
      await imap.close();
      await smtp.close();
    }
  });

  test("operator confirm_sent upgrades an ambiguous attempt to sent", async ({
    aiApp,
  }) => {
    test.setTimeout(180_000);
    const smtp = await startFakeSmtpServer();
    smtp.setDropAfterGreeting(true);
    const imap = await startFakeImapServer({
      user: SENDER,
      pass: IMAP_PASS,
      folders: {
        INBOX: {
          uidValidity: IMAP_UID_VALIDITY,
          messages: [{ uid: IMAP_UID, flags: ["\\Seen"] }],
        },
        Sent: { uidValidity: 777, messages: [] },
      },
    });
    try {
      const serviceId = await seedImapService(aiApp, {
        name: "E2E Guarded Confirm Sender",
        smtpPort: String(smtp.port),
        imapPort: String(imap.port),
      });
      const messageId = await seedImapMessage(aiApp, {
        emailServiceId: serviceId,
        providerUid: namespacedUid("INBOX", IMAP_UID_VALIDITY, IMAP_UID),
        messageId: "<e2e-guarded-confirm-1@example.com>",
      });
      const seed = await seedDraft(aiApp, {
        emailServiceId: serviceId,
        messageId,
      });
      const sendResult = await invoke(aiApp, "email:reply:send", {
        draftId: seed.id,
        approvalToken: seed.token,
      });
      expect((sendResult.data as { status: string }).status).toBe(
        "delivery_unknown"
      );
      const detail = (await invoke(aiApp, "email:reply:send:attempt:detail", {
        draftId: seed.id,
      })) as { status: boolean; data: { records: AttemptRecord[] } };
      const confirmTarget = detail.data.records[0];
      expect(confirmTarget?.status).toBe("delivery_unknown");
      const attemptId = confirmTarget?.id as number;

      const confirmed = (await invoke(
        aiApp,
        "email:reply:delivery:reconcile",
        {
          attemptId,
          action: "confirm_sent",
          evidence: "e2e operator found the message in Sent",
          providerMessageId: "<e2e-prov-1@example.com>",
        }
      )) as { status: boolean; data: { reconciled: boolean } };
      expect(confirmed.status).toBe(true);
      expect(confirmed.data.reconciled).toBe(true);

      const sentDetail = (await invoke(
        aiApp,
        "email:reply:send:attempt:detail",
        { draftId: seed.id }
      )) as { status: boolean; data: { records: AttemptRecord[] } };
      expect(sentDetail.data.records[0]?.status).toBe("sent");

      const draftDetail = (await invoke(aiApp, "email:reply:draft:detail", {
        id: seed.id,
      })) as { status: boolean; data: { status: string } };
      expect(draftDetail.data.status).toBe("sent");
    } finally {
      await imap.close();
      await smtp.close();
    }
  });
});
