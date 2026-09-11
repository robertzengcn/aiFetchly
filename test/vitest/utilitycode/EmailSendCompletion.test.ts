import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Buckemailremotedata } from "@/entityTypes/emailmarketingType";

interface SmtpPending {
  resolve: (info: { response: string; messageId?: string }) => void;
  reject: (error: Error) => void;
}

const smtpMock = vi.hoisted(() => ({
  pending: [] as SmtpPending[],
  on: vi.fn(),
  close: vi.fn(),
  sendMail: vi.fn(
    (
      _mailOptions?: unknown
    ): Promise<{ response: string; messageId?: string }> => {
      return new Promise((resolve, reject) => {
        smtpMock.pending.push({ resolve, reject });
      });
    }
  ),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: smtpMock.sendMail,
      on: smtpMock.on,
      close: smtpMock.close,
    })),
  },
}));

import { EmailSend } from "@/childprocess/emailSend";
import { EmailService } from "@/modules/lib/emailService";
import { ReplyEmailService } from "@/modules/lib/replyEmailService";
import { classifySubmissionResult } from "@/service/emailReply/EmailSubmissionClassifier";
import { OutboundEmailEnvelopeHasher } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { AuthorizedEmailWorkerEvent } from "@/entityTypes/outboundEmailDeliveryTypes";

const SMTP_AUTH_FAILED =
  "Invalid login: 535 5.7.8 Error: authentication failed: (reason unavailable)";

const serviceConfig = {
  name: "Test SMTP",
  from: "sender@example.com",
  password: "secret",
  host: "smtp.example.com",
  port: "465",
  ssl: 1,
};

const request = {
  From: "sender@example.com",
  Receiver: "buyer@example.com",
  Title: "Campaign subject",
  Content: "<p>Body</p>",
};

async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await Promise.resolve();
  return settled;
}

async function collectUnhandledRejections(
  run: () => Promise<void>
): Promise<unknown[]> {
  const rejections: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run();
    await Promise.resolve();
    await Promise.resolve();
    return rejections;
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
}

describe("outbound email completion", () => {
  beforeEach(() => {
    smtpMock.pending.length = 0;
    smtpMock.sendMail.mockClear();
    smtpMock.on.mockClear();
    smtpMock.close.mockClear();
  });

  it("keeps EmailService.sendEmail pending until SMTP responds", async () => {
    const service = new EmailService(serviceConfig);
    const success = vi.fn();

    const sending = service.sendEmail(request, undefined, success);

    expect(await isSettled(sending)).toBe(false);
    expect(success).not.toHaveBeenCalled();

    smtpMock.pending[0].resolve({ response: "250 accepted" });

    await sending;
    expect(success).toHaveBeenCalledOnce();
  });

  it("keeps the worker send pending until every SMTP attempt finishes", async () => {
    const campaign: Buckemailremotedata = {
      Receiverlist: [
        { address: "one@example.com", source: "direct" },
        { address: "two@example.com", source: "direct" },
      ],
      Emailtemplist: [],
      Emailfilterlist: [],
      Emailservicelist: [serviceConfig],
      email_subject: "Campaign subject",
      email_html_content: "<p>Body</p>",
    };
    const success = vi.fn();

    const sending = new EmailSend().send(campaign, success);

    expect(await isSettled(sending)).toBe(false);
    expect(smtpMock.pending).toHaveLength(2);

    smtpMock.pending[0].resolve({ response: "250 accepted" });
    expect(await isSettled(sending)).toBe(false);

    smtpMock.pending[1].resolve({ response: "250 accepted" });
    await sending;

    expect(success).toHaveBeenCalledTimes(2);
  });

  it("reports a missing SMTP service as a send failure", async () => {
    const campaign: Buckemailremotedata = {
      Receiverlist: [{ address: "one@example.com", source: "direct" }],
      Emailtemplist: [],
      Emailfilterlist: [],
      Emailservicelist: [],
      email_subject: "Campaign subject",
      email_html_content: "<p>Body</p>",
    };
    const failure = vi.fn();

    await new EmailSend().send(campaign, undefined, failure);

    expect(failure).toHaveBeenCalledWith(
      "one@example.com",
      "No email service is available for this task",
      "Campaign subject",
      "<p>Body</p>"
    );
  });

  it("reports SMTP 535 Invalid login as a send failure without unhandledRejection", async () => {
    const campaign: Buckemailremotedata = {
      Receiverlist: [{ address: "buyer@example.com", source: "direct" }],
      Emailtemplist: [],
      Emailfilterlist: [],
      Emailservicelist: [serviceConfig],
      email_subject: "Campaign subject",
      email_html_content: "<p>Body</p>",
    };
    const failure = vi.fn();

    const rejections = await collectUnhandledRejections(async () => {
      const sending = new EmailSend().send(campaign, undefined, failure);
      expect(smtpMock.pending).toHaveLength(1);
      smtpMock.pending[0].reject(new Error(SMTP_AUTH_FAILED));
      await sending;
    });

    expect(rejections).toEqual([]);
    expect(failure).toHaveBeenCalledWith(
      "buyer@example.com",
      SMTP_AUTH_FAILED,
      "Campaign subject",
      "<p>Body</p>"
    );
  });
});

// ---------------------------------------------------------------------------
// §13.2 — legacy services resolve the service identity and emit the
// configured Reply-To as a header (omitted when null).
// ---------------------------------------------------------------------------

describe("legacy service Reply-To header emission", () => {
  beforeEach(() => {
    smtpMock.pending.length = 0;
    smtpMock.sendMail.mockClear();
    smtpMock.on.mockClear();
    smtpMock.close.mockClear();
  });

  it("EmailService.sendEmail passes the configured replyTo to the SMTP transport", async () => {
    const service = new EmailService({
      ...serviceConfig,
      smtpUsername: "api-login@example.com",
      replyTo: "replies@example.com",
    });
    const success = vi.fn();

    const sending = service.sendEmail(request, undefined, success);
    expect(smtpMock.pending).toHaveLength(1);
    smtpMock.pending[0].resolve({ response: "250 accepted" });
    await sending;

    expect(success).toHaveBeenCalledOnce();
    expect(smtpMock.sendMail).toHaveBeenCalledTimes(1);
    const mailOptions = smtpMock.sendMail.mock.calls[0]?.[0] as {
      from?: string;
      replyTo?: string;
      to?: string;
    };
    expect(mailOptions.replyTo).toBe("replies@example.com");
    expect(mailOptions.from).toBe("sender@example.com");
    expect(mailOptions.to).toBe("buyer@example.com");
  });

  it("EmailService.sendEmail omits replyTo from the transport when it is not configured", async () => {
    const service = new EmailService(serviceConfig);
    const success = vi.fn();

    const sending = service.sendEmail(request, undefined, success);
    expect(smtpMock.pending).toHaveLength(1);
    smtpMock.pending[0].resolve({ response: "250 accepted" });
    await sending;

    const mailOptions = smtpMock.sendMail.mock.calls[0]?.[0] as {
      replyTo?: string;
    };
    expect(mailOptions.replyTo).toBeUndefined();
  });

  it("ReplyEmailService.sendReplyEmail passes the configured replyTo to the SMTP transport", async () => {
    const service = new ReplyEmailService({
      ...serviceConfig,
      smtpUsername: "api-login@example.com",
      replyTo: "replies@example.com",
    });

    const sending = service.sendReplyEmail({
      receiver: "buyer@example.com",
      subject: "Question about your listing",
      text: "Hello!",
    });
    expect(smtpMock.pending).toHaveLength(1);
    smtpMock.pending[0].resolve({ response: "250 accepted" });
    const result = await sending;

    expect(result.status).toBe(true);
    const mailOptions = smtpMock.sendMail.mock.calls[0]?.[0] as {
      from?: string;
      replyTo?: string;
      subject?: string;
    };
    expect(mailOptions.replyTo).toBe("replies@example.com");
    expect(mailOptions.from).toBe("sender@example.com");
    expect(mailOptions.subject).toBe("Re: Question about your listing");
  });

  it("ReplyEmailService.sendReplyEmail omits replyTo when it is not configured", async () => {
    const service = new ReplyEmailService(serviceConfig);

    const sending = service.sendReplyEmail({
      receiver: "buyer@example.com",
      subject: "Question about your listing",
      text: "Hello!",
    });
    smtpMock.pending[0].resolve({ response: "250 accepted" });
    await sending;

    const mailOptions = smtpMock.sendMail.mock.calls[0]?.[0] as {
      replyTo?: string;
    };
    expect(mailOptions.replyTo).toBeUndefined();
  });
});

describe("SMTP 535 authentication failures", () => {
  beforeEach(() => {
    smtpMock.pending.length = 0;
    smtpMock.sendMail.mockClear();
    smtpMock.on.mockClear();
  });

  it("attaches a transport error listener so AUTH failures are not uncaught", () => {
    new EmailService(serviceConfig);
    expect(smtpMock.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("invokes EmailService errorCallback with Invalid login and does not throw", async () => {
    const service = new EmailService(serviceConfig);
    const errorCallback = vi.fn();
    const successCallback = vi.fn();

    const rejections = await collectUnhandledRejections(async () => {
      const sending = service.sendEmail(
        request,
        errorCallback,
        successCallback
      );
      smtpMock.pending[0].reject(new Error(SMTP_AUTH_FAILED));
      await sending;
    });

    expect(rejections).toEqual([]);
    expect(successCallback).not.toHaveBeenCalled();
    expect(errorCallback).toHaveBeenCalledWith(SMTP_AUTH_FAILED);
  });

  it("returns ReplyEmailService failure so the classifier treats 535 as rejected", async () => {
    const service = new ReplyEmailService(serviceConfig);

    const rejections = await collectUnhandledRejections(async () => {
      const sending = service.sendReplyEmail({
        receiver: "buyer@example.com",
        subject: "Hello",
        text: "Hi",
      });
      smtpMock.pending[0].reject(new Error(SMTP_AUTH_FAILED));
      const raw = await sending;
      expect(raw.status).toBe(false);
      expect(raw.info).toBe(SMTP_AUTH_FAILED);
      const classified = classifySubmissionResult(raw);
      expect(classified.certainty).toBe("definitely_rejected");
      expect(classified.accepted).toBe(false);
    });

    expect(rejections).toEqual([]);
  });

  it("emits smtp_rejected for authorized start_email_send_task SMTP 535", async () => {
    const envelopeBase = {
      draftId: 1,
      revisionId: 11,
      revisionNumber: 1,
      recipientAddress: "buyer@example.com",
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      subject: "Hello",
      bodyText: "Hi there",
      bodyHtml: null as string | null,
    };
    const envelopeHash = OutboundEmailEnvelopeHasher.hashEnvelope({
      version: 1,
      emailServiceId: envelopeBase.emailServiceId,
      senderAddress: envelopeBase.senderAddress,
      recipientAddress: envelopeBase.recipientAddress,
      subject: envelopeBase.subject,
      bodyText: envelopeBase.bodyText,
      bodyHtml: envelopeBase.bodyHtml,
    });
    const envelope = { ...envelopeBase, envelopeHash };
    const payload = {
      version: 2 as const,
      mode: "authorized_envelopes" as const,
      batchId: 7,
      sendAttemptId: 11,
      batchHash: OutboundEmailEnvelopeHasher.hashBatch([
        {
          version: 1,
          draftId: envelope.draftId,
          emailServiceId: envelope.emailServiceId,
          senderAddress: envelope.senderAddress,
          recipientAddress: envelope.recipientAddress,
          subject: envelope.subject,
          bodyText: envelope.bodyText,
          bodyHtml: envelope.bodyHtml,
        },
      ]),
      envelopes: [envelope],
      emailServices: [{ id: 1, ...serviceConfig }],
    };

    const events: AuthorizedEmailWorkerEvent[] = [];
    const rejections = await collectUnhandledRejections(async () => {
      const sending = new EmailSend().sendAuthorizedEnvelopes(payload, (e) =>
        events.push(e)
      );
      expect(smtpMock.pending).toHaveLength(1);
      smtpMock.pending[0].reject(new Error(SMTP_AUTH_FAILED));
      await sending;
    });

    expect(rejections).toEqual([]);
    const failures = events.filter(
      (
        e
      ): e is Extract<
        AuthorizedEmailWorkerEvent,
        { type: "authorized-email-failed" }
      > => e.type === "authorized-email-failed"
    );
    expect(failures).toHaveLength(1);
    // §19.2 — the production classifier maps an auth failure to the specific
    // `smtp_auth_failed` code (retry-safe: the server never accepted the msg).
    expect(failures[0]?.errorCode).toBe("smtp_auth_failed");
    expect(failures[0]?.retrySafety).toBe("safe");
  });

  // -------------------------------------------------------------------------
  // §16.4 — version-3 authorized-envelope send path (v2 identity)
  // -------------------------------------------------------------------------

  /**
   * Build a valid v3 payload carrying one v2 envelope + one v3 service row.
   * The envelope identity matches the service row so all §16.4 gates pass.
   */
  function buildV3Payload(opts?: {
    replyToAddress?: string | null;
    smtpUsername?: string;
    senderAddress?: string;
    serviceFrom?: string;
    serviceReplyTo?: string | null;
    serviceSmtpUsername?: string;
    batchHashOverride?: string;
    envelopeHashOverride?: string;
    emailServiceId?: number;
  }): {
    payload: import("@/entityTypes/outboundEmailDeliveryTypes").AuthorizedEmailWorkerPayloadV3;
    envelopeHash: string;
    batchHash: string;
  } {
    const emailServiceId = opts?.emailServiceId ?? 1;
    const smtpUsername = opts?.smtpUsername ?? "sender@example.com";
    const senderAddress = opts?.senderAddress ?? "sender@example.com";
    const replyToAddress = opts?.replyToAddress ?? null;
    const draftId = 1;
    const revisionId = 11;
    const recipientAddress = "buyer@example.com";
    const subject = "Hello";
    const bodyText = "Hi there";
    const bodyHtml: string | null = null;

    const envelopeEntry = {
      version: 2 as const,
      draftId,
      emailServiceId,
      smtpUsername,
      senderAddress,
      replyToAddress,
      recipientAddress,
      subject,
      bodyText,
      bodyHtml,
    };
    const envelopeHash =
      opts?.envelopeHashOverride ??
      OutboundEmailEnvelopeHasher.hashEnvelopeV2(envelopeEntry);
    const batchHash =
      opts?.batchHashOverride ??
      OutboundEmailEnvelopeHasher.hashBatchV2([envelopeEntry]);

    const payload = {
      version: 3 as const,
      mode: "authorized_envelopes" as const,
      batchId: 7,
      sendAttemptId: 11,
      batchHash,
      envelopes: [
        {
          envelopeVersion: 2 as const,
          draftId,
          revisionId,
          revisionNumber: 1,
          recipientAddress,
          emailServiceId,
          smtpUsername,
          senderAddress,
          replyToAddress,
          subject,
          bodyText,
          bodyHtml,
          envelopeHash,
        },
      ],
      emailServices: [
        {
          id: emailServiceId,
          smtpUsername: opts?.serviceSmtpUsername ?? smtpUsername,
          from: opts?.serviceFrom ?? senderAddress,
          replyTo: opts?.serviceReplyTo ?? replyToAddress,
          password: "secret",
          host: "smtp.example.com",
          port: "465",
          name: "Test SMTP",
          ssl: 1,
        },
      ],
    };
    return { payload, envelopeHash, batchHash };
  }

  it("v3: submits the envelope and emits authorized-email-submitted on success", async () => {
    const { payload } = buildV3Payload();
    const events: AuthorizedEmailWorkerEvent[] = [];
    const sending = new EmailSend().sendAuthorizedEnvelopes(payload, (e) =>
      events.push(e)
    );
    expect(smtpMock.pending).toHaveLength(1);
    smtpMock.pending[0].resolve({
      response: "250 OK",
      messageId: "<msg-id@example.com>",
    });
    await sending;

    const submitted = events.filter(
      (
        e
      ): e is Extract<
        AuthorizedEmailWorkerEvent,
        { type: "authorized-email-submitted" }
      > => e.type === "authorized-email-submitted"
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.providerMessageId).toBe("<msg-id@example.com>");
    const complete = events.some(
      (e) => e.type === "authorized-email-worker-complete"
    );
    expect(complete).toBe(true);
  });

  it("v3: rejects with worker_payload_invalid when the batch hash is wrong", async () => {
    const { payload } = buildV3Payload({
      batchHashOverride: "a".repeat(64),
    });
    const events: AuthorizedEmailWorkerEvent[] = [];
    await new EmailSend().sendAuthorizedEnvelopes(payload, (e) =>
      events.push(e)
    );
    const failures = events.filter(
      (
        e
      ): e is Extract<
        AuthorizedEmailWorkerEvent,
        { type: "authorized-email-failed" }
      > => e.type === "authorized-email-failed"
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.errorCode).toBe("worker_payload_hash_mismatch");
    expect(smtpMock.pending).toHaveLength(0);
  });

  it("v3: aborts with worker_identity_mismatch when the service row's smtpUsername differs", async () => {
    const { payload } = buildV3Payload({
      smtpUsername: "sender@example.com",
      serviceSmtpUsername: "different-login@example.com",
    });
    const events: AuthorizedEmailWorkerEvent[] = [];
    await new EmailSend().sendAuthorizedEnvelopes(payload, (e) =>
      events.push(e)
    );
    const failures = events.filter(
      (
        e
      ): e is Extract<
        AuthorizedEmailWorkerEvent,
        { type: "authorized-email-failed" }
      > => e.type === "authorized-email-failed"
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.errorCode).toBe("worker_identity_mismatch");
    expect(smtpMock.pending).toHaveLength(0);
  });

  it("v3: aborts with worker_identity_mismatch when the service row's replyTo differs (null vs non-null)", async () => {
    const { payload } = buildV3Payload({
      replyToAddress: null,
      serviceReplyTo: "replies@example.com",
    });
    const events: AuthorizedEmailWorkerEvent[] = [];
    await new EmailSend().sendAuthorizedEnvelopes(payload, (e) =>
      events.push(e)
    );
    const failures = events.filter(
      (
        e
      ): e is Extract<
        AuthorizedEmailWorkerEvent,
        { type: "authorized-email-failed" }
      > => e.type === "authorized-email-failed"
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.errorCode).toBe("worker_identity_mismatch");
    expect(smtpMock.pending).toHaveLength(0);
  });

  it("v3: main and worker compute the same v2 batch hash", async () => {
    // This is the core integrity guarantee: the hash the main process put in
    // the payload equals the hash the worker recomputes from the envelopes.
    const { payload, batchHash } = buildV3Payload();
    expect(payload.batchHash).toBe(batchHash);
    const events: AuthorizedEmailWorkerEvent[] = [];
    const sending = new EmailSend().sendAuthorizedEnvelopes(payload, (e) =>
      events.push(e)
    );
    smtpMock.pending[0].resolve({ response: "250 OK", messageId: "ok" });
    await sending;
    // No hash-mismatch failure → the worker's recomputed hash matched.
    const hashMismatch = events.some(
      (e) =>
        e.type === "authorized-email-failed" &&
        e.errorCode === "worker_payload_hash_mismatch"
    );
    expect(hashMismatch).toBe(false);
  });

  it("v3: all-v1 payload still uses the v2 path (version 2)", async () => {
    // A v2 payload (version: 2) carrying v1 envelopes must route through the
    // legacy sendAuthorizedEnvelopesV2 path (not v3). The hashes match, so the
    // worker submits successfully. This guards against the version dispatch
    // regressing and the v1 envelope hash staying byte-identical.
    const envelopeBase = {
      draftId: 1,
      revisionId: 11,
      revisionNumber: 1,
      recipientAddress: "buyer@example.com",
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      subject: "Hello",
      bodyText: "Hi there",
      bodyHtml: null as string | null,
    };
    const envelopeHash = OutboundEmailEnvelopeHasher.hashEnvelope({
      version: 1,
      emailServiceId: envelopeBase.emailServiceId,
      senderAddress: envelopeBase.senderAddress,
      recipientAddress: envelopeBase.recipientAddress,
      subject: envelopeBase.subject,
      bodyText: envelopeBase.bodyText,
      bodyHtml: envelopeBase.bodyHtml,
    });
    const payload = {
      version: 2 as const,
      mode: "authorized_envelopes" as const,
      batchId: 7,
      sendAttemptId: 11,
      batchHash: OutboundEmailEnvelopeHasher.hashBatch([
        {
          version: 1,
          draftId: envelopeBase.draftId,
          emailServiceId: envelopeBase.emailServiceId,
          senderAddress: envelopeBase.senderAddress,
          recipientAddress: envelopeBase.recipientAddress,
          subject: envelopeBase.subject,
          bodyText: envelopeBase.bodyText,
          bodyHtml: envelopeBase.bodyHtml,
        },
      ]),
      envelopes: [{ ...envelopeBase, envelopeHash }],
      emailServices: [{ id: 1, ...serviceConfig }],
    };
    const events: AuthorizedEmailWorkerEvent[] = [];
    const sending = new EmailSend().sendAuthorizedEnvelopes(payload, (e) =>
      events.push(e)
    );
    // The v2 path matched hashes → it created a sender and called sendMail,
    // which parked on the mock's pending promise. Resolve it so the worker
    // completes.
    expect(smtpMock.pending).toHaveLength(1);
    smtpMock.pending[0].resolve({ response: "250 OK", messageId: "ok" });
    await sending;
    expect(smtpMock.sendMail).toHaveBeenCalledTimes(1);
    const submitted = events.filter(
      (e) => e.type === "authorized-email-submitted"
    );
    expect(submitted).toHaveLength(1);
    const complete = events.some(
      (e) => e.type === "authorized-email-worker-complete"
    );
    expect(complete).toBe(true);
  });

  it("v3: passes a non-null Reply-To to the SMTP transport", async () => {
    const replyTo = "replies@example.com";
    const { payload } = buildV3Payload({ replyToAddress: replyTo });
    const events: AuthorizedEmailWorkerEvent[] = [];
    const sending = new EmailSend().sendAuthorizedEnvelopes(payload, (e) =>
      events.push(e)
    );
    expect(smtpMock.pending).toHaveLength(1);
    smtpMock.pending[0].resolve({ response: "250 OK", messageId: "ok" });
    await sending;
    // The nodemailer mock received a replyTo field in the sendMail options.
    expect(smtpMock.sendMail).toHaveBeenCalledTimes(1);
    const callArgs = smtpMock.sendMail.mock.calls[0]?.[0] as
      | { replyTo?: string }
      | undefined;
    expect(callArgs?.replyTo).toBe(replyTo);
  });

  it("v3: omits Reply-To from the SMTP transport when replyToAddress is null", async () => {
    const { payload } = buildV3Payload({ replyToAddress: null });
    const events: AuthorizedEmailWorkerEvent[] = [];
    const sending = new EmailSend().sendAuthorizedEnvelopes(payload, (e) =>
      events.push(e)
    );
    expect(smtpMock.pending).toHaveLength(1);
    smtpMock.pending[0].resolve({ response: "250 OK", messageId: "ok" });
    await sending;
    const callArgs = smtpMock.sendMail.mock.calls[0]?.[0] as
      | { replyTo?: string }
      | undefined;
    expect(callArgs?.replyTo).toBeUndefined();
  });
});
