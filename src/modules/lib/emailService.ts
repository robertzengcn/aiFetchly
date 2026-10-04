import type { Transporter, SendMailOptions } from "nodemailer";
import {
  EmailRequestData,
  EmailServiceEntitydata,
} from "@/entityTypes/emailmarketingType";
import {
  createOutboundSmtpTransporter,
  smtpErrorMessage,
} from "@/modules/lib/smtpTransport";

export class EmailService {
  private transporter: Transporter;
  private emailSender: string;

  constructor(param: EmailServiceEntitydata) {
    this.emailSender = param.from;
    this.transporter = createOutboundSmtpTransporter(param);
  }

  public async sendEmail(
    param: EmailRequestData,
    errorCallback?: (errorMessage: string) => void,
    successCallback?: () => void
  ): Promise<void> {
    const mailOptions: SendMailOptions = {
      from: this.emailSender,
      to: param.Receiver,
      subject: param.Title,
      text: param.Content,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log("Email sent:", info.response);
      successCallback?.();
    } catch (error: unknown) {
      errorCallback?.(smtpErrorMessage(error));
    }
  }
}
