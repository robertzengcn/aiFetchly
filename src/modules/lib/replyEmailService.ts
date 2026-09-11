import nodemailer from "nodemailer";
import type {
  EmailServiceEntitydata,
  EmailSendResult,
} from "@/entityTypes/emailmarketingType";
import {
  OutboundSmtpSession,
  smtpErrorMessage,
} from "@/modules/lib/smtpTransport";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";

/** Reply payload with thread-tracking headers preserved where available. */
export interface ReplyEmailRequestData {
  readonly receiver: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string | null;
  readonly inReplyTo?: string | null;
  readonly references?: string | null;
}

/**
 * Sends a reply email through the same SMTP credentials as outbound send,
 * preserving threading headers. The configured outgoing Reply-To (§13.2) is
 * emitted as a header; the inbound message's replyToAddress still selects
 * `data.receiver` independently (FR-011).
 */
export class ReplyEmailService {
  private session: OutboundSmtpSession;
  private readonly fromAddress: string;
  private readonly replyToAddress: string | null;

  constructor(param: EmailServiceEntitydata) {
    const identity = resolveEmailServiceIdentity({
      smtpUsername: param.smtpUsername,
      from: param.from,
      replyTo: param.replyTo,
    });
    this.fromAddress = identity.fromAddress;
    this.replyToAddress = identity.replyToAddress;
    this.session = new OutboundSmtpSession(param);
  }

  async sendReplyEmail(data: ReplyEmailRequestData): Promise<EmailSendResult> {
    const subject = ensureRePrefix(data.subject);
    const mailOptions: nodemailer.SendMailOptions = {
      from: this.fromAddress,
      ...(this.replyToAddress ? { replyTo: this.replyToAddress } : {}),
      to: data.receiver,
      subject,
      text: data.text,
    };
    if (data.html) {
      mailOptions.html = data.html;
    }
    if (data.inReplyTo) {
      mailOptions.inReplyTo = data.inReplyTo;
    }
    if (data.references) {
      mailOptions.references = data.references;
    }

    try {
      const info = await this.session.sendMail(mailOptions);
      return {
        receiver: data.receiver,
        status: true,
        title: subject,
        content: data.text,
        info: typeof info === "object" && info ? info.messageId : undefined,
      };
    } catch (error: unknown) {
      return {
        receiver: data.receiver,
        status: false,
        title: subject,
        content: data.text,
        info: smtpErrorMessage(error),
      };
    }
  }
}

/** Ensure the subject carries a `Re:` prefix without stacking duplicates. */
export function ensureRePrefix(subject: string): string {
  const trimmed = subject.trim();
  if (/^re:\s*/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}
