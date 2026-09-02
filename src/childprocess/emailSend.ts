import { Buckemailremotedata } from "@/entityTypes/emailmarketingType";
import nodemailer from "nodemailer";
import { convertVariableInTemplate } from "@/views/utils/emailFun";
import { EmailTemplatePreviewdata } from "@/entityTypes/emailmarketingType";
import { EmailService } from "@/modules/lib/emailService";
import { randomInt } from "crypto";
import { z } from "zod/v4";
import {
  EmailServiceEntitydata,
  EmailRequestData,
} from "@/entityTypes/emailmarketingType";
import { OutboundEmailEnvelopeHasher } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { BatchEnvelopeEntry } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import { OUTBOUND_EMAIL_BATCH_LIMITS } from "@/service/outboundEmail/outboundEmailLimits";
import { authorizedEmailWorkerPayloadV2Schema } from "@/entityTypes/outboundEmailDeliveryTypes";
import type {
  AuthorizedEmailWorkerEvent,
  AuthorizedEmailWorkerPayloadV2,
  AuthorizedOutboundEnvelope,
} from "@/entityTypes/outboundEmailDeliveryTypes";

// ---------------------------------------------------------------------------
// §16.2 authorized exact-envelope send path
// ---------------------------------------------------------------------------

/**
 * The frozen mail the worker submits for one envelope. Content is exact — no
 * template conversion, no random selection. `html` is omitted (not null) when
 * the envelope carries no HTML so the provider sends a text-only message.
 */
export interface AuthorizedSmtpMail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string | null;
}

/** Result of a single SMTP submission. */
export interface AuthorizedSmtpSendResult {
  readonly messageId: string | null;
}

/**
 * Per-service SMTP sender. Built once per service record; closed after the
 * batch completes so transport objects and credential references are released
 * (§16.2 item 10). The worker holds no `EmailServiceEntitydata` after `close`.
 */
export interface AuthorizedSmtpSender {
  send(mail: AuthorizedSmtpMail): Promise<AuthorizedSmtpSendResult>;
  close(): void;
}

/**
 * Builds a sender for a service record. Injected so tests substitute fakes; the
 * production default constructs a real nodemailer transporter. The factory
 * receives only the credential-bearing service record it needs.
 */
export type AuthorizedSmtpSenderFactory = (
  service: EmailServiceEntitydata
) => AuthorizedSmtpSender;

/** Maximum simultaneous SMTP submissions (§16.2 item 9). */
const SMTP_CONCURRENCY = 5;

/**
 * Worker-boundary schema for credential-bearing email-service rows. The shared
 * payload schema validates envelope-shape only and leaves `emailServices` as
 * `unknown[]` (§6.3 comment); the worker narrows each row here before trusting
 * it — never `as`-cast untrusted cross-process input.
 */
const workerEmailServiceSchema = z.object({
  id: z.number().int(),
  from: z.string().min(1),
  password: z.string().min(1),
  host: z.string().min(1),
  port: z.string(),
  name: z.string(),
  ssl: z.number(),
});

/**
 * Patterns that indicate an ambiguous / network-class SMTP failure: the
 * message may or may not have been accepted by the provider, so a retry risks
 * a duplicate (FR-019). Classified `retrySafety: "unknown"`.
 */
const AMBIGUOUS_SMTP_PATTERNS: readonly RegExp[] = [
  /ETIMEDOUT/i,
  /ESOCKET/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /EPIPE/i,
  /EHOSTUNREACH/i,
  /ENETUNREACH/i,
  /Greeting/i,
  /timeout/i,
  /timed out/i,
  /connection/i,
];

function classifySmtpError(message: string): "safe" | "unknown" {
  return AMBIGUOUS_SMTP_PATTERNS.some((p) => p.test(message))
    ? "unknown"
    : "safe";
}

/** Build a real nodemailer-backed sender for a service record. */
function defaultSenderFactory(
  service: EmailServiceEntitydata
): AuthorizedSmtpSender {
  const transporter = nodemailer.createTransport({
    host: service.host,
    port: Number(service.port) || 0,
    secure: service.ssl === 1,
    auth: {
      user: service.from,
      pass: service.password,
    },
  } as nodemailer.TransportOptions);
  return {
    async send(mail: AuthorizedSmtpMail): Promise<AuthorizedSmtpSendResult> {
      const info = await transporter.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        ...(mail.html === null ? {} : { html: mail.html }),
      });
      const messageId =
        typeof info?.messageId === "string" ? info.messageId : null;
      return { messageId };
    },
    close(): void {
      try {
        transporter.close();
      } catch {
        // Transport already closed — release is best-effort (§16.2 item 10).
      }
    },
  };
}

/** One envelope's typed outcome after SMTP submission. */
type EnvelopeOutcome =
  | {
      kind: "submitted";
      draftId: number;
      revisionId: number;
      envelopeHash: string;
      providerMessageId: string | null;
    }
  | {
      kind: "failed";
      draftId: number;
      revisionId: number;
      envelopeHash: string;
      errorCode: string;
      retrySafety: "safe" | "unknown";
    };

export class EmailSend {
  private readonly senderFactory: AuthorizedSmtpSenderFactory;

  constructor(senderFactory?: AuthorizedSmtpSenderFactory) {
    this.senderFactory = senderFactory ?? defaultSenderFactory;
  }

  // -- §16.2 authorized exact-envelope send --------------------------------

  /**
   * Send the frozen, authorized envelopes for a batch (technical design §16.2).
   *
   * The worker: validates the payload + service rows with Zod, recomputes
   * every envelope hash and the batch hash BEFORE any SMTP submission (a
   * mismatch stops the entire batch), builds one sender per service, submits
   * each envelope to its exact assigned service with its exact content (no
   * `convertVariableInTemplate`, no random selection), caps concurrency at
   * five, emits a typed event per envelope, and closes every sender after
   * completion. It performs no database access and makes no authorization
   * decisions.
   */
  public async sendAuthorizedEnvelopes(
    payload: AuthorizedEmailWorkerPayloadV2,
    eventCallback: (event: AuthorizedEmailWorkerEvent) => void
  ): Promise<void> {
    const emit = (e: AuthorizedEmailWorkerEvent): void => {
      eventCallback(e);
    };

    // §16.2 item 1 — validate the payload and narrow service rows before doing
    // anything. A structurally invalid payload cannot be trusted.
    const parsedPayload = authorizedEmailWorkerPayloadV2Schema.safeParse({
      ...payload,
      // The shared schema leaves emailServices as unknown[]; narrow here.
      emailServices: payload.emailServices,
    });
    if (!parsedPayload.success) {
      // Payload itself is malformed — fail every envelope with a safe,
      // pre-send code and terminate. Nothing was sent.
      for (const env of payload.envelopes) {
        emit({
          type: "authorized-email-failed",
          batchId: payload.batchId,
          sendAttemptId: payload.sendAttemptId,
          draftId: env.draftId,
          revisionId: env.revisionId,
          envelopeHash: env.envelopeHash,
          errorCode: "worker_payload_invalid",
          retrySafety: "safe",
        });
      }
      emit({
        type: "authorized-email-worker-complete",
        batchId: payload.batchId,
        sendAttemptId: payload.sendAttemptId,
      });
      return;
    }

    const batchId = parsedPayload.data.batchId;
    const sendAttemptId = parsedPayload.data.sendAttemptId;
    const envelopes = parsedPayload.data.envelopes;

    // §16.2 item 1 (size limits) — enforce recipient + body caps before any
    // SMTP submission. Defense-in-depth: the main process already preflighted,
    // but the worker never trusts the caller.
    if (envelopes.length > OUTBOUND_EMAIL_BATCH_LIMITS.maxRecipients) {
      for (const env of envelopes) {
        emit({
          type: "authorized-email-failed",
          batchId,
          sendAttemptId,
          draftId: env.draftId,
          revisionId: env.revisionId,
          envelopeHash: env.envelopeHash,
          errorCode: "worker_batch_too_large",
          retrySafety: "safe",
        });
      }
      emit({
        type: "authorized-email-worker-complete",
        batchId,
        sendAttemptId,
      });
      return;
    }
    for (const env of envelopes) {
      if (env.bodyText.length > OUTBOUND_EMAIL_BATCH_LIMITS.maxTextBodyChars) {
        emit({
          type: "authorized-email-failed",
          batchId,
          sendAttemptId,
          draftId: env.draftId,
          revisionId: env.revisionId,
          envelopeHash: env.envelopeHash,
          errorCode: "worker_body_too_large",
          retrySafety: "safe",
        });
        emit({
          type: "authorized-email-worker-complete",
          batchId,
          sendAttemptId,
        });
        return;
      }
      if (
        env.bodyHtml !== null &&
        env.bodyHtml.length > OUTBOUND_EMAIL_BATCH_LIMITS.maxHtmlBodyChars
      ) {
        emit({
          type: "authorized-email-failed",
          batchId,
          sendAttemptId,
          draftId: env.draftId,
          revisionId: env.revisionId,
          envelopeHash: env.envelopeHash,
          errorCode: "worker_body_too_large",
          retrySafety: "safe",
        });
        emit({
          type: "authorized-email-worker-complete",
          batchId,
          sendAttemptId,
        });
        return;
      }
    }

    // §16.2 item 2+3 — build a service map; reject missing or duplicate records.
    const serviceMap = new Map<number, EmailServiceEntitydata>();
    const duplicateServiceIds: number[] = [];
    for (const raw of payload.emailServices) {
      const parsed = workerEmailServiceSchema.safeParse(raw);
      if (!parsed.success) {
        continue;
      }
      // `id` is required by the worker schema; the EmailServiceEntitydata type
      // marks it optional, so bind it from the validated Zod output (a definite
      // number) before the widening cast.
      const svcId = parsed.data.id;
      const svc = parsed.data as EmailServiceEntitydata;
      if (serviceMap.has(svcId)) {
        duplicateServiceIds.push(svcId);
        continue;
      }
      serviceMap.set(svcId, svc);
    }

    // §16.2 item 1 (hashes) — recompute every envelope hash + the batch hash.
    // A mismatch stops the entire batch before SMTP (§11).
    let hashMismatch = false;
    const batchEntries: BatchEnvelopeEntry[] = [];
    for (const env of envelopes) {
      const recomputed = OutboundEmailEnvelopeHasher.hashEnvelope({
        version: 1,
        emailServiceId: env.emailServiceId,
        senderAddress: env.senderAddress,
        recipientAddress: env.recipientAddress,
        subject: env.subject,
        bodyText: env.bodyText,
        bodyHtml: env.bodyHtml,
      });
      if (recomputed !== env.envelopeHash) {
        hashMismatch = true;
      }
      batchEntries.push({
        version: 1,
        draftId: env.draftId,
        emailServiceId: env.emailServiceId,
        senderAddress: env.senderAddress,
        recipientAddress: env.recipientAddress,
        subject: env.subject,
        bodyText: env.bodyText,
        bodyHtml: env.bodyHtml,
      });
    }
    const recomputedBatchHash =
      OutboundEmailEnvelopeHasher.hashBatch(batchEntries);
    if (recomputedBatchHash !== parsedPayload.data.batchHash) {
      hashMismatch = true;
    }

    if (hashMismatch) {
      // Stop the entire batch before any SMTP submission. Every envelope is
      // safe to retry with a fresh authorization — nothing was sent.
      for (const env of envelopes) {
        emit({
          type: "authorized-email-failed",
          batchId,
          sendAttemptId,
          draftId: env.draftId,
          revisionId: env.revisionId,
          envelopeHash: env.envelopeHash,
          errorCode: "worker_payload_hash_mismatch",
          retrySafety: "safe",
        });
      }
      emit({
        type: "authorized-email-worker-complete",
        batchId,
        sendAttemptId,
      });
      return;
    }

    // Duplicate service records are a tamper signal — abort before SMTP.
    if (duplicateServiceIds.length > 0) {
      for (const env of envelopes) {
        emit({
          type: "authorized-email-failed",
          batchId,
          sendAttemptId,
          draftId: env.draftId,
          revisionId: env.revisionId,
          envelopeHash: env.envelopeHash,
          errorCode: "worker_service_duplicate",
          retrySafety: "safe",
        });
      }
      emit({
        type: "authorized-email-worker-complete",
        batchId,
        sendAttemptId,
      });
      return;
    }

    // Build one sender per referenced service. Envelopes referencing a missing
    // service record abort that envelope (and, by spec, the batch).
    const senders = new Map<number, AuthorizedSmtpSender>();
    const referencedIds = new Set(envelopes.map((e) => e.emailServiceId));
    let missingService = false;
    for (const id of referencedIds) {
      const svc = serviceMap.get(id);
      if (!svc) {
        missingService = true;
        continue;
      }
      senders.set(id, this.senderFactory(svc));
    }

    if (missingService) {
      for (const env of envelopes) {
        emit({
          type: "authorized-email-failed",
          batchId,
          sendAttemptId,
          draftId: env.draftId,
          revisionId: env.revisionId,
          envelopeHash: env.envelopeHash,
          errorCode: "worker_service_missing",
          retrySafety: "safe",
        });
      }
      emit({
        type: "authorized-email-worker-complete",
        batchId,
        sendAttemptId,
      });
      return;
    }

    // §16.2 items 4–8, 10 — submit each envelope to its exact assigned service
    // with its exact content, concurrency-limited, then close every sender.
    const outcomes = await this.submitEnvelopes(envelopes, senders, serviceMap);

    for (const outcome of outcomes) {
      if (outcome.kind === "submitted") {
        emit({
          type: "authorized-email-submitted",
          batchId,
          sendAttemptId,
          draftId: outcome.draftId,
          revisionId: outcome.revisionId,
          envelopeHash: outcome.envelopeHash,
          providerMessageId: outcome.providerMessageId,
        });
      } else {
        emit({
          type: "authorized-email-failed",
          batchId,
          sendAttemptId,
          draftId: outcome.draftId,
          revisionId: outcome.revisionId,
          envelopeHash: outcome.envelopeHash,
          errorCode: outcome.errorCode,
          retrySafety: outcome.retrySafety,
        });
      }
    }

    // Release transport objects and zero credential references (§16.2 item 10).
    for (const sender of senders.values()) {
      sender.close();
    }
    senders.clear();
    serviceMap.clear();

    emit({
      type: "authorized-email-worker-complete",
      batchId,
      sendAttemptId,
    });
  }

  /**
   * Submit envelopes with concurrency capped at {@link SMTP_CONCURRENCY}.
   * Returns one typed outcome per envelope, preserving input order. Sender
   * selection is deterministic — by envelope.emailServiceId, never random.
   */
  private async submitEnvelopes(
    envelopes: readonly AuthorizedOutboundEnvelope[],
    senders: Map<number, AuthorizedSmtpSender>,
    serviceMap: Map<number, EmailServiceEntitydata>
  ): Promise<EnvelopeOutcome[]> {
    const results: EnvelopeOutcome[] = new Array(envelopes.length);
    let cursor = 0;
    const next = (): number => cursor++;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next();
        if (i >= envelopes.length) {
          return;
        }
        const env = envelopes[i];
        results[i] = await this.submitOne(env, senders, serviceMap);
      }
    };
    const pool: Promise<void>[] = [];
    for (let w = 0; w < SMTP_CONCURRENCY; w++) {
      pool.push(worker());
    }
    await Promise.all(pool);
    return results;
  }

  /** Submit one envelope to its exact assigned service; classify any failure. */
  private async submitOne(
    env: AuthorizedOutboundEnvelope,
    senders: Map<number, AuthorizedSmtpSender>,
    serviceMap: Map<number, EmailServiceEntitydata>
  ): Promise<EnvelopeOutcome> {
    const sender = senders.get(env.emailServiceId);
    const service = serviceMap.get(env.emailServiceId);
    // Should be unreachable after pre-checks, but defend in depth: never send
    // without a resolved sender + from-address.
    if (!sender || !service) {
      return {
        kind: "failed",
        draftId: env.draftId,
        revisionId: env.revisionId,
        envelopeHash: env.envelopeHash,
        errorCode: "worker_service_missing",
        retrySafety: "safe",
      };
    }
    // §16.2 items 5,6 — exact subject/body, exact sender address, no template
    // conversion. html omitted when null.
    const mail: AuthorizedSmtpMail = {
      from: service.from,
      to: env.recipientAddress,
      subject: env.subject,
      text: env.bodyText,
      html: env.bodyHtml,
    };
    try {
      const result = await sender.send(mail);
      return {
        kind: "submitted",
        draftId: env.draftId,
        revisionId: env.revisionId,
        envelopeHash: env.envelopeHash,
        providerMessageId: result.messageId,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        kind: "failed",
        draftId: env.draftId,
        revisionId: env.revisionId,
        envelopeHash: env.envelopeHash,
        errorCode: "smtp_rejected",
        retrySafety: classifySmtpError(message),
      };
    }
  }
  public async send(
    param: Buckemailremotedata,
    successCallback?: (
      receiver: string,
      title: string,
      content: string
    ) => void | undefined | null,
    errorCallback?: (
      receiver: string,
      info: string,
      title: string,
      content: string
    ) => void | undefined | null
  ): Promise<void> {
    const totalfilter: string[] = [];
    if (param.Emailfilterlist && param.Emailfilterlist.length > 0) {
      param.Emailfilterlist.forEach((item) => {
        if (item.filter_details && item.filter_details.length > 0) {
          item.filter_details.forEach((filterdetail) => {
            totalfilter.push(filterdetail.content);
          });
        }
      });
    }

    //loop receiver
    param.Receiverlist.forEach((item) => {
      //check if item in filter list
      if (totalfilter.includes(item.address)) {
        return;
      }

      // param.Emailfilterlist.forEach((filterlist) => {
      //     filterlist.filter_details.forEach((filterdetail) => {
      //         const regex = new RegExp(filterdetail.content);
      //         if (regex.test(item.address)) {
      //             return;
      //         }
      //     })
      // })
      for (const filterlist of param.Emailfilterlist) {
        for (const filterdetail of filterlist.filter_details) {
          try {
            const regex = new RegExp(filterdetail.content);
            if (regex.test(item.address)) {
              return;
            }
          } catch (error) {
            if (filterdetail.content.includes("*")) {
              try {
                const regex = new RegExp(
                  filterdetail.content.replace(/\*/g, ".*")
                );

                if (regex.test(item.address)) {
                  return;
                }
              } catch (rerr) {
                console.log(
                  `Invalid regular expression second: ${filterdetail.content}`,
                  rerr
                );
              }
            } else {
              console.log(
                `Invalid regular expression: ${filterdetail.content}`,
                error
              );
            }
          }
        }
      }

      //get random one from email send list
      const randomEmailservice = this.getRandomItem(param.Emailservicelist);
      if (!randomEmailservice) {
        console.error(
          "No email service available, skipping recipient:",
          item.address
        );
        return;
      }

      //get random email template, fallback to inline subject/content if no templates
      const randEmailtpl = this.getRandomItem(param.Emailtemplist);
      const previewData: EmailTemplatePreviewdata = {
        TplTitle: randEmailtpl?.TplTitle || param.email_subject || "",
        TplContent: randEmailtpl?.TplContent || param.email_html_content || "",
        Sender: randomEmailservice.from,
        Receiver: item.address,
      };
      //replace variable in email template
      const emailTpldata = convertVariableInTemplate(previewData);
      //send email
      // Create a transporter object
      // const transporter = nodemailer.createTransport({
      //     host: randomEmailservice.host,
      //     port: Number(randomEmailservice.port) || 0,
      //     secure: randomEmailservice.ssl, // true for 465, false for other ports
      //     auth: {
      //         user: randomEmailservice.from, // your SMTP username
      //         pass: randomEmailservice.password, // your SMTP password
      //     }
      // } as nodemailer.TransportOptions);
      // // Configure the mailoptions object
      // const mailOptions = {
      //     from: randomEmailservice.from,
      //     to: item.address,
      //     subject: emailTpldata.TplTitle,
      //     text: emailTpldata.TplContent
      // };
      const emailserviceenditydata: EmailServiceEntitydata = {
        name: randomEmailservice.name,
        from: randomEmailservice.from,
        host: randomEmailservice.host,
        port: randomEmailservice.port,
        ssl: randomEmailservice.ssl,
        password: randomEmailservice.password,
      };
      const emailServie = new EmailService(emailserviceenditydata);
      const emailRequestdata: EmailRequestData = {
        From: randomEmailservice.from,
        Receiver: item.address,
        Title: emailTpldata.TplTitle,
        Content: emailTpldata.TplContent,
      };
      emailServie.sendEmail(
        emailRequestdata,
        function (error) {
          if (errorCallback) {
            errorCallback(
              item.address,
              error,
              emailTpldata.TplTitle,
              emailTpldata.TplContent
            );
          }
        },
        function () {
          if (successCallback) {
            successCallback(
              item.address,
              emailTpldata.TplTitle,
              emailTpldata.TplContent
            );
          }
        }
      );
      // // Send the email
      // transporter.sendMail(mailOptions, function (error, info) {
      //     if (error) {
      //         console.error('Error:', error);
      //         if (errorCallback) {
      //             errorCallback(item.address, error.message, emailTpldata.TplTitle, emailTpldata.TplContent)
      //         }
      //     } else {
      //         console.log('Email sent:', info.response);
      //         if (successCallback) {
      //             successCallback(item.address, emailTpldata.TplTitle, emailTpldata.TplContent)
      //         }
      //     }
      // });
    });
  }
  // Function to get a random item from an array.
  // Empty lists must return undefined: crypto.randomInt(0) throws, which
  // prevented sendEmailEnd from being posted and left AI send tools running.
  private getRandomItem<Type>(array: Array<Type>): Type | undefined {
    if (!array || array.length === 0) {
      return undefined;
    }
    const randomIndex = randomInt(array.length);
    return array[randomIndex];
  }
}
