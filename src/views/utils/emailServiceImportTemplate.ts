/**
 * CSV import template for email services.
 *
 * Mirrors the import whitelist in
 * `EmailMarketingController` (name, smtpUsername, from, replyTo, host,
 * port, password, ssl, receiveProtocol). Export deliberately omits
 * `password`, so the template carries a fill-in placeholder instead.
 */

export const EMAIL_SERVICE_IMPORT_TEMPLATE_HEADERS: string =
  "name,smtpUsername,from,replyTo,host,port,password,ssl,receiveProtocol,imapHost,imapPort,imapSsl,pop3Host,pop3Port,pop3Ssl,receiveUsername,receivePassword,receiveFolder,receiveEnabled";

export const EMAIL_SERVICE_IMPORT_TEMPLATE_FILENAME: string =
  "email_service_import_template.csv";

export function buildEmailServiceCsvTemplate(): string {
  const example: string = [
    "Example Service",
    "sender@example.com",
    "sender@example.com",
    "",
    "smtp.example.com",
    "465",
    "your-password-here",
    "1",
    "imap",
    "imap.example.com",
    "993",
    "1",
    "",
    "",
    "",
    "",
    "",
    "INBOX",
    "0",
  ].join(",");
  return `${EMAIL_SERVICE_IMPORT_TEMPLATE_HEADERS}\n${example}\n`;
}

export function downloadEmailServiceCsvTemplate(): void {
  const csv: string = buildEmailServiceCsvTemplate();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url: string = URL.createObjectURL(blob);
  const anchor: HTMLAnchorElement = document.createElement("a");
  anchor.href = url;
  anchor.download = EMAIL_SERVICE_IMPORT_TEMPLATE_FILENAME;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
