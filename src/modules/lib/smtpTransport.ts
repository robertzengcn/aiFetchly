import nodemailer from "nodemailer";
import type { EmailServiceEntitydata } from "@/entityTypes/emailmarketingType";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";

/** SMTPS: wrap the socket in TLS before any SMTP greeting. */
export const SMTP_IMPLICIT_TLS_PORT = 465;

const WRONG_VERSION_HINT =
  "The SMTP server did not start TLS on this port. " +
  "Port 587 uses STARTTLS; port 465 uses implicit SSL/TLS.";

export type SmtpTlsMode = "configured" | "implicitTls" | "starttls";

export type SmtpTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: {
    user: string;
    pass: string;
  };
};

type SmtpErrorFields = {
  code?: unknown;
  command?: unknown;
};

/**
 * Map a stored SSL toggle + port to nodemailer TLS mode.
 *
 * `ssl === 1` means "encrypt the connection", not "use implicit TLS".
 * Port 465 speaks TLS immediately (`secure: true`). Port 587 (and other
 * submission ports) greet in plain SMTP and upgrade with STARTTLS
 * (`secure: false`, `requireTLS: true`). Using implicit TLS on 587 makes
 * BoringSSL report WRONG_VERSION_NUMBER because the first bytes are
 * "220 ..." rather than a TLS record.
 *
 * `mode` overrides that guess so a failed handshake can retry the other
 * TLS style. Port 465 still defaults to implicit TLS even if the stored
 * toggle is off, matching receive-side implicit-port normalization.
 */
export function buildSmtpTransportOptions(
  param: EmailServiceEntitydata,
  mode: SmtpTlsMode = "configured"
): SmtpTransportOptions {
  const port = Number(param.port) || 0;
  const sslEnabled = param.ssl === 1 || port === SMTP_IMPLICIT_TLS_PORT;
  const configuredImplicit = sslEnabled && port === SMTP_IMPLICIT_TLS_PORT;

  let useImplicitTls = false;
  let requireTls = false;
  if (sslEnabled) {
    if (mode === "implicitTls") {
      useImplicitTls = true;
    } else if (mode === "starttls") {
      requireTls = true;
    } else {
      useImplicitTls = configuredImplicit;
      requireTls = !useImplicitTls;
    }
  }

  return {
    host: param.host,
    port,
    secure: useImplicitTls,
    requireTLS: requireTls,
    auth: {
      user: resolveEmailServiceIdentity({
        smtpUsername: param.smtpUsername,
        from: param.from,
      }).smtpUsername,
      pass: param.password,
    },
  };
}

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
  param: EmailServiceEntitydata,
  mode: SmtpTlsMode = "configured"
): nodemailer.Transporter {
  const transporter = nodemailer.createTransport(
    buildSmtpTransportOptions(param, mode) as nodemailer.TransportOptions
  );
  transporter.on("error", () => {
    // Failure is observed via `sendMail`'s rejected promise / catch.
  });
  return transporter;
}

/**
 * Retry the other TLS style once when the first handshake failed because
 * the server expected STARTTLS or implicit TLS, not because AUTH/RCPT
 * failed after a working socket.
 *
 * First attempt stays RFC-shaped (587 STARTTLS, 465 implicit). A 587
 * implicit-TLS server then fails greeting/reset and retries implicit TLS.
 * The inverse (implicit TLS on a STARTTLS port) retries STARTTLS after
 * WRONG_VERSION_NUMBER. Trying implicit TLS first on every 587 send would
 * fail the common case on every message.
 */
export function shouldRetrySmtpTlsMode(
  error: unknown,
  attempted: SmtpTlsMode,
  param: EmailServiceEntitydata
): SmtpTlsMode | null {
  if (attempted !== "configured") {
    return null;
  }

  const options = buildSmtpTransportOptions(param, attempted);
  if (!options.secure && !options.requireTLS) {
    return null;
  }

  if (isPostHandshakeSmtpError(error) || isNonTlsModeError(error)) {
    return null;
  }

  if (options.secure && isImplicitTlsMismatch(error)) {
    return "starttls";
  }
  if (options.requireTLS && isStartTlsMismatch(error)) {
    return "implicitTls";
  }
  return null;
}

export function closeSmtpTransporter(
  transporter: nodemailer.Transporter
): void {
  try {
    transporter.close();
  } catch {
    // already closed
  }
}

/**
 * Send one message, retrying once with the other TLS mode when the first
 * handshake looks like a STARTTLS vs implicit-TLS mismatch. Remembers the
 * working mode on this instance so later sends skip the failed handshake.
 */
export class OutboundSmtpSession {
  private mode: SmtpTlsMode = "configured";
  private transporter: nodemailer.Transporter;

  constructor(private readonly param: EmailServiceEntitydata) {
    this.transporter = createOutboundSmtpTransporter(param);
  }

  async sendMail(
    mailOptions: nodemailer.SendMailOptions
  ): Promise<nodemailer.SentMessageInfo> {
    try {
      return await this.transporter.sendMail(mailOptions);
    } catch (error: unknown) {
      const retryMode = shouldRetrySmtpTlsMode(error, this.mode, this.param);
      if (!retryMode) {
        throw error;
      }
      closeSmtpTransporter(this.transporter);
      this.mode = retryMode;
      this.transporter = createOutboundSmtpTransporter(this.param, retryMode);
      return await this.transporter.sendMail(mailOptions);
    }
  }

  close(): void {
    closeSmtpTransporter(this.transporter);
  }
}

/** Normalize a nodemailer / SMTP throw into a string for callbacks and logs. */
export function smtpErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("WRONG_VERSION_NUMBER")) {
    return `${message} ${WRONG_VERSION_HINT}`;
  }
  return message;
}

function smtpErrorFields(error: unknown): SmtpErrorFields {
  if (typeof error !== "object" || error === null) {
    return {};
  }
  return error as SmtpErrorFields;
}

function smtpErrorCode(error: unknown): string {
  const code = smtpErrorFields(error).code;
  return typeof code === "string" ? code : "";
}

function smtpErrorCommand(error: unknown): string {
  const command = smtpErrorFields(error).command;
  return typeof command === "string" ? command.toUpperCase() : "";
}

function smtpErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${smtpErrorCode(error)} ${message}`;
}

function isPostHandshakeSmtpError(error: unknown): boolean {
  const command = smtpErrorCommand(error);
  return (
    command === "AUTH" ||
    command === "MAIL" ||
    command === "RCPT" ||
    command === "DATA"
  );
}

function isNonTlsModeError(error: unknown): boolean {
  const text = smtpErrorText(error);
  return (
    /ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|EAI_AGAIN/i.test(text) ||
    /UNABLE_TO_VERIFY|CERT_|self-signed|certificate/i.test(text) ||
    /535|Invalid login|authentication failed/i.test(text)
  );
}

function isImplicitTlsMismatch(error: unknown): boolean {
  const text = smtpErrorText(error);
  return /WRONG_VERSION_NUMBER/i.test(text);
}

function isStartTlsMismatch(error: unknown): boolean {
  const code = smtpErrorCode(error);
  if (
    code === "GREETING_TIMEOUT" ||
    code === "ClosedAfterConnectText" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNABORTED"
  ) {
    return true;
  }
  return /greeting never received|socket hang up|ECONNRESET/i.test(
    smtpErrorText(error)
  );
}
