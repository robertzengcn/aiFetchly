/**
 * E2E-only seeding IPC (Playwright Electron E2E, design §8).
 *
 * These channels are registered ONLY when process.env.AIFETCHLY_E2E === "1"
 * (the same gate E2EMain checks before bootstrapping the test environment).
 * They exist because the sanitized E2E environment cannot run the production
 * create path for some rows: email-service creation encrypts the SMTP
 * credential via UserSecretKeyService, which requires the remote
 * /api/user/secret-key backend — absent in the loopback-only E2E network.
 *
 * The seed writes the row directly through the production Model layer
 * (EmailServiceModel.create) with a PLAINTEXT password. That stays
 * credential-compatible with production reads: EmailServiceModule's
 * decryptRequiredCredential passes non-"ENC1:"-prefixed stored values back
 * verbatim, so the worker credential loader returns the seeded row as-is.
 *
 * Defense-in-depth, in order:
 *   1. registerE2ESeedIpcHandlers() returns before registering anything
 *      unless AIFETCHLY_E2E === "1" (never true in prod or dev runs).
 *   2. The registration call site in communication/index.ts is itself
 *      behind the same env check.
 *   3. preload's static validChannels whitelist only forwards
 *      e2e:seed-email-service when this module registered a handler; outside
 *      E2E the invoke fails with "No handler registered".
 *   4. The handler validates input with a strict Zod schema before touching
 *      the Model layer, and writes only via Token/USERSDBPATH (the isolated
 *      per-test root) — never a real user database.
 */

import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";
import {
  E2E_SEED_EMAIL_SERVICE,
  E2E_SEED_RECEIVED_MESSAGE,
  E2E_SEED_AUTO_REPLY_AUDIT,
} from "@/config/channellist";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  e2eSeedEmailServiceInputSchema,
  e2eSeedReceivedMessageInputSchema,
  e2eSeedAutoReplyAuditInputSchema,
} from "@/schemas/ipc/e2eSeed";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailReceivedMessageModel } from "@/model/EmailReceivedMessage.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailAutoReplyAuditLogModel } from "@/model/EmailAutoReplyAuditLog.model";
import { EmailAutoReplyAuditLogEntity } from "@/entity/EmailAutoReplyAuditLog.entity";

/** True only inside the Playwright Electron E2E bootstrap. */
function isE2eRuntime(): boolean {
  return process.env.AIFETCHLY_E2E === "1";
}

/**
 * Register the E2E-only seed channels. No-op outside AIFETCHLY_E2E=1.
 *
 * @param dbpathOverride Optional explicit database path (unit tests inject a
 *        temp directory so no real database is ever touched).
 */
export function registerE2ESeedIpcHandlers(dbpathOverride?: string): void {
  if (!isE2eRuntime()) {
    return;
  }

  registerValidatedHandler(
    E2E_SEED_EMAIL_SERVICE,
    e2eSeedEmailServiceInputSchema,
    async (input): Promise<{ id: number }> => {
      const dbpath = dbpathOverride ?? new Token().getValue(USERSDBPATH) ?? "";
      const entity = new EmailServiceEntity();
      entity.name = input.name;
      entity.from = input.from;
      // Plaintext by design: EmailServiceModule.decryptRequiredCredential
      // returns non-ENC1 values verbatim, so the production credential loader
      // hands this to the SMTP worker unchanged (see file header).
      entity.password = input.password;
      entity.host = input.host;
      entity.port = input.port;
      entity.ssl = input.ssl ?? 1;
      entity.status = input.status ?? 1;
      // P0.3 identity columns: the scenarios seed a service whose SMTP
      // username differs from From (scenario 1) and/or a Reply-To
      // independent of From. null when absent mirrors the production
      // create/update merge (candidate.smtpUsername ?? null).
      entity.smtpUsername = input.smtpUsername ?? null;
      entity.replyTo = input.replyTo ?? null;
      const model = new EmailServiceModel(dbpath);
      const id = await model.create(entity);
      return { id };
    }
  );

  // T10 E2E: seed one received message through the production upsert path.
  // `replyStatus` is seeded verbatim (not derived from isAnswered) so the
  // local-first §7.1 detection outcome is deterministic without a mailbox.
  registerValidatedHandler(
    E2E_SEED_RECEIVED_MESSAGE,
    e2eSeedReceivedMessageInputSchema,
    async (input): Promise<{ id: number }> => {
      const dbpath = dbpathOverride ?? new Token().getValue(USERSDBPATH) ?? "";
      const entity = new EmailReceivedMessageEntity();
      entity.emailServiceId = input.emailServiceId;
      entity.providerUid = input.providerUid;
      entity.messageId = input.messageId;
      entity.fromAddress = input.fromAddress;
      entity.toAddressesJson = JSON.stringify(input.toAddresses);
      entity.subject = input.subject;
      entity.receivedAt = new Date();
      entity.isUnread = 0;
      entity.replyStatus = input.replyStatus;
      entity.isAnswered = input.isAnswered ?? 0;
      const model = new EmailReceivedMessageModel(dbpath);
      const saved = await model.upsertByProviderUid(entity);
      return { id: saved.id };
    }
  );

  // T10 E2E: seed one auto-reply audit row carrying the structured typed
  // metadata exactly as the production refusal writers emit it (stage + code
  // as proper JSON fields in metadataJson).
  registerValidatedHandler(
    E2E_SEED_AUTO_REPLY_AUDIT,
    e2eSeedAutoReplyAuditInputSchema,
    async (input): Promise<{ id: number }> => {
      const dbpath = dbpathOverride ?? new Token().getValue(USERSDBPATH) ?? "";
      const entity = new EmailAutoReplyAuditLogEntity();
      entity.emailServiceId = input.emailServiceId;
      entity.messageId = input.messageId;
      entity.draftId = input.draftId ?? null;
      entity.ruleId = input.ruleId ?? null;
      entity.action = input.action;
      entity.decisionStatus = input.decisionStatus;
      entity.classification = input.classification ?? null;
      entity.confidence = input.confidence ?? null;
      entity.reason = input.reason ?? null;
      entity.generatedSubject = input.generatedSubject ?? null;
      entity.generatedBodyPreview = input.generatedBodyPreview ?? null;
      entity.requiresUserApproval = input.requiresUserApproval ?? 1;
      entity.errorMessage = input.errorMessage ?? null;
      entity.metadataJson = input.metadataJson ?? null;
      const model = new EmailAutoReplyAuditLogModel(dbpath);
      const id = await model.create(entity);
      return { id };
    }
  );
}
