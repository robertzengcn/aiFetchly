import nodemailer from "nodemailer";
import {
  EmailRequestData,
  EmailServiceEntitydata,
} from "@/entityTypes/emailmarketingType";
import {
  OutboundSmtpSession,
  smtpErrorMessage,
} from "@/modules/lib/smtpTransport";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";

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
    errorCallback?: (errorMessage: string) => void,
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
      errorCallback?.(smtpErrorMessage(error));
    }
  }
}
