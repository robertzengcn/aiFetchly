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
  sendMail: vi.fn((): Promise<{ response: string; messageId?: string }> => {
    return new Promise((resolve, reject) => {
      smtpMock.pending.push({ resolve, reject });
    });
  }),
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
      const sending = service.sendEmail(request, errorCallback, successCallback);
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
    expect(failures[0]?.errorCode).toBe("smtp_rejected");
    expect(failures[0]?.retrySafety).toBe("safe");
  });
});
