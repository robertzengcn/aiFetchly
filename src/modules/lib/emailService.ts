import nodemailer from "nodemailer";
import {
  EmailRequestData,
  EmailServiceEntitydata,
} from "@/entityTypes/emailmarketingType";
import {
  OutboundSmtpSession,
  smtpErrorMessage,
} from "@/modules/lib/smtpTransport";

export class EmailService {
  private session: OutboundSmtpSession;
  private emailSender: string;

  constructor(param: EmailServiceEntitydata) {
    this.emailSender = param.from;
    this.session = new OutboundSmtpSession(param);
  }

  public async sendEmail(
    param: EmailRequestData,
    errorCallback?: (errorMessage: string) => void,
    successCallback?: () => void
  ): Promise<void> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: this.emailSender,
      to: param.Receiver,
      subject: param.Title,
      text: param.Content,
    };

    try {
      const info = await this.session.sendMail(mailOptions);
      console.log("Email sent:", info.response);
      successCallback?.();
    } catch (error: unknown) {
      errorCallback?.(smtpErrorMessage(error));
    }
  }
}
