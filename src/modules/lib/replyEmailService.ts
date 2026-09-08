import nodemailer from "nodemailer";
import type {
  EmailServiceEntitydata,
  EmailSendResult,
} from "@/entityTypes/emailmarketingType";
import {
  OutboundSmtpSession,
  smtpErrorMessage,
} from "@/modules/lib/smtpTransport";

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
 * preserving threading headers (`In-Reply-To`, `References`) when present so the
 * reply threads correctly in the recipient's mailbox.
 *
 * Mirrors {@link EmailService} construction but adds a reply-specific send.
 */
export class ReplyEmailService {
  private session: OutboundSmtpSession;
  private emailSender: string;

  constructor(param: EmailServiceEntitydata) {
    this.emailSender = param.from;
    this.session = new OutboundSmtpSession(param);
  }

  async sendReplyEmail(data: ReplyEmailRequestData): Promise<EmailSendResult> {
    const subject = ensureRePrefix(data.subject);
    const mailOptions: nodemailer.SendMailOptions = {
      from: this.emailSender,
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
