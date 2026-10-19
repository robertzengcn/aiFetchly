/**
 * Local-provider compatibility E2E spec (G03 — local half).
 *
 * Drives REAL production generation wiring — renderer → preload → IPC →
 * generation service → OpenAI-compatible loopback provider (FakeAi) — plus
 * the loopback IMAP probe (§8.1 pre-draft detection) and loopback SMTP
 * (delivery). No injected Vitest ports: the model requests go over HTTP to
 * the in-process FakeAi server exactly as they would to a local provider.
 *
 * Covered (OpenAI-compatible loopback provider):
 *
 *   1. draft:create succeeds with a valid reply JSON: the FR-026
 *      `response_format: json_object` hint is present on every generation
 *      submission, the strict local parse accepts the body, and the draft +
 *      immutable revision + `draft_created` audit persist (FR-026/FR-027).
 *   2. Eligible-reuse success: a second draft:create for the same message
 *      returns the SAME draft with zero additional model calls (FR-028).
 *   3. The reused draft approves and sends end-to-end (G04 reuse→send).
 *
 * Explicitly NOT covered here (needs live servers): hosted-provider
 * compatibility, real-world JSON fallback/ignore-hint behavior against
 * provider quirks, and pilot baselines — see the G03 pilot plan. The
 * loopback numbers below are harness evidence, never pilot thresholds.
 */

import { createHash } from "node:crypto";
import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import { startFakeSmtpServer } from "../fixtures/fakeSmtpServer";
import { startFakeImapServer } from "../fixtures/fakeImapServer";
import type { LaunchedApp } from "../fixtures/electronApp";
import type { FakeOpenAiController } from "../fixtures/fakeOpenAiServer";

const IMAP_UID_VALIDITY = 434343;
const IMAP_UID = 1;
const SENDER = "e2e-local-sender@example.com";
const RECIPIENT = "e2e-recipient@example.com";
const IMAP_PASS = "e2e-plaintext-pass";

const CANNED_SUBJECT = "Re: E2E local provider original";
const CANNED_BODY = "Thanks for asking — happy to help with the details.";
const CANNED_REPLY_JSON = JSON.stringify({
  subject: CANNED_SUBJECT,
  bodyText: CANNED_BODY,
  intentSuggestion: "interested",
  confidence: 0.8,
});

function namespacedUid(folder: string, validity: number, uid: number): string {
  // Replicates buildNamespacedProviderUid for INBOX (sha256 hex slice).
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

test.describe("Local-provider generation compatibility (G03 local)", () => {
  test.afterEach(({ app, aiApp, disabledApp }) => {
    const a = app ?? aiApp ?? disabledApp;
    if (!a) return;
    assertCleanTeardown(a);
  });

  test("draft:create → reuse → approve → send over loopback IMAP + provider + SMTP", async ({
    aiApp,
    fakeAi,
  }: {
    aiApp: LaunchedApp;
    fakeAi: FakeOpenAiController;
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
      // The generation call needs exactly one model completion (valid on
      // first pass — no correction round trip).
      await fakeAi.queueNonStreamingContents([CANNED_REPLY_JSON]);

      const serviceId = await (async () => {
        const result = await invoke(aiApp, "e2e:seed-email-service", {
          name: "E2E Local Provider Sender",
          from: SENDER,
          password: IMAP_PASS,
          host: "127.0.0.1",
          port: String(smtp.port),
          ssl: 0,
          status: 1,
          receiveEnabled: 1,
          imapHost: "127.0.0.1",
          imapPort: String(imap.port),
          imapSsl: 0,
          receiveFolder: "INBOX",
        });
        expect(result.status).toBe(true);
        return (result.data as { id: number }).id;
      })();

      const seeded = await invoke(aiApp, "e2e:seed-received-message", {
        emailServiceId: serviceId,
        providerUid: namespacedUid("INBOX", IMAP_UID_VALIDITY, IMAP_UID),
        messageId: "<e2e-local-provider-1@example.com>",
        fromAddress: RECIPIENT,
        toAddresses: [SENDER],
        subject: "E2E local provider original",
        replyStatus: "not_started",
        providerFolder: "INBOX",
        providerUidValidity: String(IMAP_UID_VALIDITY),
        // Deterministic classification skips the model classifier, so the
        // queued completion feeds generation alone.
        classification: "interested",
        classificationConfidence: 0.9,
      });
      expect(seeded.status).toBe(true);
      const messageId = (seeded.data as { id: number }).id;

      // 1. Real draft:create through the production generation pipeline.
      const created = (await invoke(aiApp, "email:reply:draft:create", {
        messageId,
        useKnowledgeLibrary: false,
      })) as {
        status: boolean;
        msg?: string;
        data: {
          draftId: number;
          subject: string;
          bodyText: string;
          requiresHumanReview: boolean;
        };
      };
      expect(created.status, `create failed: ${created.msg ?? "?"}`).toBe(
        true
      );
      expect(created.data.subject).toBe(CANNED_SUBJECT);
      expect(created.data.bodyText).toBe(CANNED_BODY);
      expect(created.data.requiresHumanReview).toBe(false);
      const draftId = created.data.draftId;

      // The local provider actually received the generation submission(s)
      // with the FR-026 JSON hint on every call.
      const completions = (await fakeAi.getRequests()).filter(
        (r) => r.path.includes("/chat/completions") && r.stream === false
      );
      // Valid first answer: exactly one generation submission, no correction
      // round trip (PRD §7: "valid first answer persists one draft").
      expect(completions.length).toBe(1);
      for (const req of completions) {
        expect(req.responseFormat).toBe("json_object");
      }
      const callsAfterCreate = completions.length;

      // The draft_created audit mirrors into the UI table.
      const created_audits = (await invoke(
        aiApp,
        "email:autoreply:audit:list",
        {
          page: 0,
          size: 20,
          decisionStatus: "draft_created",
        }
      )) as {
        status: boolean;
        data: { records: { draftId: number | null }[]; num: number };
      };
      expect(created_audits.status).toBe(true);
      expect(
        created_audits.data.records.some((r) => r.draftId === draftId)
      ).toBe(true);

      // 2. Eligible-reuse success: same message returns the SAME draft with
      // zero additional model calls (FR-028).
      const reused = (await invoke(aiApp, "email:reply:draft:create", {
        messageId,
        useKnowledgeLibrary: false,
      })) as {
        status: boolean;
        msg?: string;
        data: { draftId: number; reused: boolean };
      };
      expect(reused.status).toBe(true);
      expect(reused.data.draftId).toBe(draftId);
      expect(reused.data.reused).toBe(true);
      const afterReuse = (await fakeAi.getRequests()).filter(
        (r) => r.path.includes("/chat/completions") && r.stream === false
      );
      expect(afterReuse.length).toBe(callsAfterCreate);

      // 3. The reused draft approves and sends end-to-end (G04 reuse→send).
      const approve = (await invoke(aiApp, "email:reply:draft:approve", {
        draftId,
      })) as { status: boolean; msg?: string; data: { token: string } };
      expect(approve.status, `approve failed: ${approve.msg ?? "?"}`).toBe(
        true
      );
      const sendResult = await invoke(aiApp, "email:reply:send", {
        draftId,
        approvalToken: approve.data.token,
      });
      expect(sendResult.status, `send failed: ${sendResult.msg ?? "?"}`).toBe(
        true
      );
      expect((sendResult.data as { status: string }).status).toBe("sent");
      expect(smtp.recordedMessages).toHaveLength(1);
      expect(
        smtp.recordedMessages[0]?.headers["in-reply-to"] ?? ""
      ).toContain("e2e-local-provider-1@example.com");
    } finally {
      await imap.close();
      await smtp.close();
    }
  });
});
