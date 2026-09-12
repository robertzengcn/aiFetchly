import nodemailer from "nodemailer";
import {
  EmailRequestData,
  EmailServiceEntitydata,
  SendEmailError,
} from "@/entityTypes/emailmarketingType";
import { OutboundSmtpSession } from "@/modules/lib/smtpTransport";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";
import { classifySmtpFailure } from "@/modules/lib/smtpErrorClassifier";

export class EmailService {
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

  public async sendEmail(
    param: EmailRequestData,
    errorCallback?: (error: SendEmailError) => void,
    successCallback?: () => void
  ): Promise<void> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: this.fromAddress,
      ...(this.replyToAddress ? { replyTo: this.replyToAddress } : {}),
      to: param.Receiver,
      subject: param.Title,
      text: param.Content,
    };

    try {
      await this.session.sendMail(mailOptions);
      successCallback?.();
    } catch (error: unknown) {
      const classified = classifySmtpFailure(error);
      errorCallback?.({
        message: classified.sanitizedMessage,
        code: classified.code,
      });
    }
  }
}
