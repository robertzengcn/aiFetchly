import nodemailer from "nodemailer";
import type { EmailServiceEntitydata } from "@/entityTypes/emailmarketingType";

/**
 * Build a nodemailer SMTP transporter from a stored email-service row.
 *
 * The EventEmitter `error` listener is load-bearing: SMTP AUTH failures
 * (535 / Invalid login) are delivered both through `sendMail`'s promise
 * and as an `error` event on the transport. Without a listener, Node
 * treats the event as an uncaught exception and the send tool cannot
 * report the failure.
 */
export function createOutboundSmtpTransporter(
  param: EmailServiceEntitydata
): nodemailer.Transporter {
  const transporter = nodemailer.createTransport({
    host: param.host,
    port: Number(param.port) || 0,
    secure: param.ssl === 1,
    auth: {
      user: param.from,
      pass: param.password,
    },
  } as nodemailer.TransportOptions);
  transporter.on("error", () => {
    // Failure is observed via `sendMail`'s rejected promise / catch.
  });
  return transporter;
}

/** Normalize a nodemailer / SMTP throw into a string for callbacks and logs. */
export function smtpErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
