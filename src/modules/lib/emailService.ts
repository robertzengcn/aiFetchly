import nodemailer from "nodemailer";
import {
  EmailRequestData,
  EmailServiceEntitydata,
} from "@/entityTypes/emailmarketingType";

export class EmailService {
  private transporter: nodemailer.Transporter;
  private emailSender: string;

  constructor(param: EmailServiceEntitydata) {
    this.emailSender = param.from;
    this.transporter = nodemailer.createTransport({
      host: param.host,
      port: Number(param.port) || 0,
      secure: param.ssl === 1,
      auth: {
        user: param.from,
        pass: param.password,
      },
    } as nodemailer.TransportOptions);
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

    await new Promise<void>((resolve) => {
      this.transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Error:", error);
          errorCallback?.(error.message);
          resolve();
          return;
        }

        console.log("Email sent:", info.response);
        successCallback?.();
        resolve();
      });
    });
  }
}
