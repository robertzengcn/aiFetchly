import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Buckemailremotedata } from "@/entityTypes/emailmarketingType";

type SendMailCallback = (
  error: Error | null,
  info: { response: string }
) => void;

const smtpMock = vi.hoisted(() => ({
  callbacks: [] as SendMailCallback[],
  sendMail: vi.fn((_options: unknown, callback: SendMailCallback): void => {
    smtpMock.callbacks.push(callback);
  }),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: smtpMock.sendMail,
    })),
  },
}));

import { EmailSend } from "@/childprocess/emailSend";
import { EmailService } from "@/modules/lib/emailService";

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

async function isSettled(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  return settled;
}

describe("outbound email completion", () => {
  beforeEach(() => {
    smtpMock.callbacks.length = 0;
    smtpMock.sendMail.mockClear();
  });

  it("keeps EmailService.sendEmail pending until SMTP responds", async () => {
    const service = new EmailService(serviceConfig);
    const success = vi.fn();

    const sending = service.sendEmail(request, undefined, success);

    expect(await isSettled(sending)).toBe(false);
    expect(success).not.toHaveBeenCalled();

    smtpMock.callbacks[0](null, { response: "250 accepted" });

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
    expect(smtpMock.callbacks).toHaveLength(2);

    smtpMock.callbacks[0](null, { response: "250 accepted" });
    expect(await isSettled(sending)).toBe(false);

    smtpMock.callbacks[1](null, { response: "250 accepted" });
    await sending;

    expect(success).toHaveBeenCalledTimes(2);
  });
});
