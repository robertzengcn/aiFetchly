import { log } from "@/modules/Logger";
import { BaseModule } from "@/modules/baseModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailMessageLocationModule } from "@/modules/EmailMessageLocationModule";
import type { LegacyBackfillEntry } from "@/model/EmailMessageLocation.model";
import type { EmailOrganizationProtocol } from "@/entityTypes/emailOrganizationTypes";
import { parseNamespacedProviderUid } from "@/service/emailReceive/EmailReplyIdentity";
import { setLocationBackfillReady } from "@/service/emailOrganization/emailOrganizationReadiness";

const BACKFILL_BATCH_SIZE = 500;

/**
 * Derives the location protocol from a stored provider UID.
 *
 * Receive clients namespace provider UIDs (`imap:<folderHash>:<uidValidity>:<uid>`
 * or `pop3:<sha256(uidl)>`); only pre-namespace IMAP syncs stored bare UIDs,
 * so an un-prefixed value is a legacy IMAP row. POP3 rows never had folders.
 */
export function deriveProtocolFromProviderUid(
  providerUid: string
): EmailOrganizationProtocol {
  if (providerUid.startsWith("pop3:")) return "pop3";
  return "imap";
}

/**
 * One-time (idempotent) initialization for the email organization feature
 * (technical design §5.3): backfills a `legacy_unverified` location row for
 * every received message that lacks one. Legacy rows are never eligible for
 * remote mutation until a live re-fetch verifies them, satisfying AC-21.
 */
export class EmailOrganizationStartupService extends BaseModule {
  private messageModule: EmailReceivedMessageModule;
  private locationModule: EmailMessageLocationModule;
  private backfillComplete = false;

  constructor() {
    super();
    this.messageModule = new EmailReceivedMessageModule();
    this.locationModule = new EmailMessageLocationModule();
  }

  /**
   * Runs the location backfill at most once per process. Safe to call
   * concurrently: the model's backfill is transactional and idempotent.
   * R5-10: flips the process-wide readiness gate ONLY on success — remote
   * organization actions stay disabled (fail closed) until this resolves.
   */
  async ensureLocationBackfill(): Promise<number> {
    if (this.backfillComplete) return 0;
    await this.ensureConnection();
    let totalInserted = 0;
    let afterId = 0;
    try {
      for (;;) {
        const batch = await this.messageModule.listForLocationBackfill(
          afterId,
          BACKFILL_BATCH_SIZE
        );
        if (batch.length === 0) break;
        afterId = batch[batch.length - 1].id;

        const missingIds =
          await this.locationModule.findMessageIdsWithoutLocation(
            batch.map((row) => row.id)
          );
        if (missingIds.length > 0) {
          const missingSet = new Set(missingIds);
          const entries: LegacyBackfillEntry[] = batch
            .filter((row) => missingSet.has(row.id))
            .map((row) => {
              const namespaced = parseNamespacedProviderUid(row.providerUid);
              // Store the same identity representation the live sync writes
              // (bare uid for namespaced rows) so the tuple index and later
              // verification see one consistent form.
              return {
                messageId: row.id,
                emailServiceId: row.emailServiceId,
                protocol: deriveProtocolFromProviderUid(row.providerUid),
                folderPath: row.providerFolder,
                uidValidity: namespaced
                  ? namespaced.uidValidity
                  : row.providerUidValidity,
                providerUid: namespaced ? namespaced.uid : row.providerUid,
              };
            });
          totalInserted += await this.locationModule.backfillLegacyLocations(
            entries
          );
        }
        if (batch.length < BACKFILL_BATCH_SIZE) break;
      }
      this.backfillComplete = true;
      setLocationBackfillReady(true);
      if (totalInserted > 0) {
        log.info(
          `[EmailOrganization] location backfill complete: ${totalInserted} legacy_unverified rows inserted`
        );
      }
      return totalInserted;
    } catch (error) {
      // R5-10: the gate stays CLOSED on failure (no organization moves on a
      // database whose location backfill failed). A retry path may call this
      // again in the same process.
      log.error(
        "[EmailOrganization] location backfill failed (organization actions stay disabled):",
        error
      );
      return totalInserted;
    }
  }
}
