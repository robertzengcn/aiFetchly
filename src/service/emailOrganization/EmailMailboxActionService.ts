import crypto from "crypto";
import { log } from "@/modules/Logger";
import { BaseModule } from "@/modules/baseModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailMessageLocationModule } from "@/modules/EmailMessageLocationModule";
import { EmailOrganizationOperationModule } from "@/modules/EmailOrganizationOperationModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import type { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";
import { ImapEmailMailboxAdapter as DefaultMailboxAdapter } from "@/service/emailOrganization/ImapEmailMailboxAdapter";
import type {
  EmailMailboxAdapter,
  MoveResult,
  PresenceResult,
} from "@/service/emailOrganization/EmailMailboxAdapter";
import {
  hashClaimToken,
  generateClaimToken,
} from "@/service/emailOrganization/EmailForwardEnvelopeHasher";
import {
  EmailOrganizationActionError,
  isRetryableOrganizationErrorCode,
} from "@/service/emailOrganization/EmailOrganizationErrors";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";
import type { EmailActionResult, EmailActionStatus } from "@/entityTypes/emailOrganizationTypes";
import { EmailOrganizationOperationEntity } from "@/entity/EmailOrganizationOperation.entity";

/**
 * Trash and restore execution (technical design §10.1/§10.2).
 *
 * Every action revalidates the verified location against the live server,
 * claims the item transactionally BEFORE the remote move, and persists the
 * destination mapping afterwards. "Deleted" means moved to the provider's
 * Trash folder; nothing here ever expunges (invariant 9). A location change
 * invalidates pending reply approvals for the message (§10.4).
 */

export interface TrashMessageInput {
  readonly messageId: number;
  readonly origin: "direct_request" | "ui_review" | "ui_action" | "tool_confirmation";
  /** Persisted user turn / UI event idempotency anchor; null = fresh action. */
  readonly actionId?: string | null;
  readonly conversationId?: number | null;
}

export interface RestoreFromOperationInput {
  readonly priorOperationId: string;
  readonly destinationFolderPath?: string | null;
  readonly origin: "direct_request" | "ui_review" | "ui_action" | "tool_confirmation";
  readonly actionId?: string | null;
}

export type MailboxActionOutcome = EmailActionResult & {
  readonly priorOperationId?: string;
  /** Human-readable sanitized reason for deterministic pre-flight refusals. */
  readonly error?: string;
};

export class EmailMailboxActionService extends BaseModule {
  private readonly messageModule: EmailReceivedMessageModule;
  private readonly locationModule: EmailMessageLocationModule;
  private readonly operationModule: EmailOrganizationOperationModule;
  private readonly replyDraftModule: EmailReplyDraftModule;
  private readonly adapter: EmailMailboxAdapter;
  private readonly capabilityService: EmailOrganizationCapabilityService | null;

  constructor(options?: {
    adapter?: EmailMailboxAdapter;
    capabilityService?: EmailOrganizationCapabilityService;
  }) {
    super();
    this.messageModule = new EmailReceivedMessageModule();
    this.locationModule = new EmailMessageLocationModule();
    this.operationModule = new EmailOrganizationOperationModule();
    this.replyDraftModule = new EmailReplyDraftModule();
    this.adapter =
      options?.adapter ?? this.createDefaultAdapter();
    this.capabilityService = options?.capabilityService ?? null;
  }

  private createDefaultAdapter(): EmailMailboxAdapter {
    return new DefaultMailboxAdapter();
  }

  async trashMessage(input: TrashMessageInput): Promise<MailboxActionOutcome> {
    await this.ensureConnection();
    const message = await this.messageModule.read(input.messageId);
    if (!message) {
      return this.failedResult("SOURCE_NOT_FOUND", "Message not found.");
    }
    const location = await this.locationModule.readByMessageId(message.id);
    if (!location || location.protocol !== "imap") {
      return this.failedResult(
        "CAPABILITY_UNSUPPORTED",
        "Trash requires an IMAP account."
      );
    }
    if (location.state !== "verified" || location.folderPath === null || location.uidValidity === null) {
      return this.failedResult(
        "LOCATION_STALE",
        "Message location is not verified; re-sync the mailbox first."
      );
    }

    // Resolve the destination Trash folder (capability service revalidates).
    const trashFolder = await this.resolveTrashFolder(message.emailServiceId);
    if (trashFolder === null) {
      return this.failedResult(
        "TRASH_NOT_CONFIGURED",
        "No Trash folder could be resolved for this account."
      );
    }

    // Verified no-op: already in Trash (nothing to move, nothing to invent).
    // Claims like any other path so the fenced finalization applies.
    if (location.folderPath === trashFolder) {
      const noopOperation = await this.createOperation(input, message.emailServiceId, [message.id], trashFolder, "trash");
      const claim = await this.operationModule.claimItem({
        operationId: noopOperation.operationId,
        messageId: message.id,
        claimTokenHash: hashClaimToken(generateClaimToken()),
        leaseExpiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.attemptLeaseMs),
        location: {
          version: location.version,
          folderPath: location.folderPath,
          uidValidity: location.uidValidity,
          providerUid: location.providerUid,
        },
        destinationFolderPath: trashFolder,
      });
      if (claim.status === "claimed") {
        await this.operationModule.finalizeItem({
          itemId: claim.itemId,
          operationId: noopOperation.operationId,
          status: "noop",
          attemptId: claim.attemptId,
          resultJson: JSON.stringify({ reason: "already_in_trash", trashFolder }),
        });
      } else if (claim.status === "item_not_pending") {
        await this.operationModule.finalizeItem({
          itemId: (await this.operationModule.listItems(noopOperation.operationId))[0].id,
          operationId: noopOperation.operationId,
          status: "failed",
          errorCode: "LOCAL_COMMIT_PENDING",
          sanitizedError: `No-op item could not be claimed (${claim.status}).`,
        });
      }
      await this.operationModule.recordAudit({
        operationId: noopOperation.operationId,
        messageId: message.id,
        emailServiceId: message.emailServiceId,
        action: "trash_noop",
        detail: { trashFolder },
      });
      return await this.projectResult(noopOperation.operationId);
    }

    const operation = await this.createOperation(input, message.emailServiceId, [message.id], trashFolder, "trash");
    const items = await this.operationModule.listItems(operation.operationId);
    const item = items[0];

    const claim = await this.operationModule.claimItem({
      operationId: operation.operationId,
      messageId: message.id,
      claimTokenHash: hashClaimToken(generateClaimToken()),
      leaseExpiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.attemptLeaseMs),
      location: {
        version: location.version,
        folderPath: location.folderPath,
        uidValidity: location.uidValidity,
        providerUid: location.providerUid,
      },
      destinationFolderPath: trashFolder,
    });
    if (claim.status !== "claimed") {
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId: operation.operationId,
        status: "failed",
        errorCode: "LOCAL_COMMIT_PENDING",
        sanitizedError: `Item could not be claimed (${claim.status}).`,
      });
      return await this.projectResult(operation.operationId);
    }

    await this.operationModule.recordAudit({
      operationId: operation.operationId,
      itemId: claim.itemId,
      messageId: message.id,
      emailServiceId: message.emailServiceId,
      actor: input.origin === "tool_confirmation" ? "ai" : "user",
      action: "trash_claimed",
      detail: { folderPath: location.folderPath, trashFolder },
    });

    const receiveConfig = await this.resolveReceiveConfig(message.emailServiceId);
    if (!receiveConfig) {
      await this.operationModule.finalizeItem({
        itemId: claim.itemId,
        operationId: operation.operationId,
        status: "failed",
        errorCode: "ACCOUNT_NOT_AVAILABLE",
        sanitizedError: "Account receive configuration unavailable.",
      });
      return await this.projectResult(operation.operationId);
    }

    const presence = await this.adapter.checkMessagePresent(receiveConfig, {
      folderPath: location.folderPath,
      uidValidity: location.uidValidity,
      uid: location.providerUid,
    });
    if (presence.status === "uid_validity_changed") {
      await this.locationModule.markStale(message.id);
      await this.operationModule.finalizeItem({
        itemId: claim.itemId,
        operationId: operation.operationId,
        status: "failed",
        errorCode: "UID_VALIDITY_CHANGED",
        sanitizedError: "Folder UID validity changed; re-select the message.",
      });
      return await this.projectResult(operation.operationId);
    }
    if (presence.status === "absent") {
      await this.operationModule.finalizeItem({
        itemId: claim.itemId,
        operationId: operation.operationId,
        status: "failed",
        errorCode: "SOURCE_NOT_FOUND",
        sanitizedError: "Message is no longer at its verified location.",
      });
      return await this.projectResult(operation.operationId);
    }
    if (presence.status === "failed") {
      await this.operationModule.finalizeItem({
        itemId: claim.itemId,
        operationId: operation.operationId,
        status: "failed",
        errorCode: presence.reasonCode,
        sanitizedError: presence.sanitizedError,
      });
      return await this.projectResult(operation.operationId);
    }

    const move = await this.adapter.moveMessage(
      receiveConfig,
      { folderPath: location.folderPath, uidValidity: location.uidValidity, uid: location.providerUid },
      trashFolder
    );
    await this.persistMoveOutcome(operation.operationId, claim.itemId, message.id, message.emailServiceId, move, trashFolder, input.origin, undefined, claim.attemptId);
    return await this.projectResult(operation.operationId);
  }

  async restoreFromOperation(input: RestoreFromOperationInput): Promise<MailboxActionOutcome> {
    await this.ensureConnection();
    const prior = await this.operationModule.readOperation(input.priorOperationId);
    if (!prior || prior.kind !== "trash") {
      return this.failedResult("OPERATION_NOT_FOUND", "Prior trash operation not found.");
    }
    if (prior.status !== "succeeded" && prior.status !== "partially_succeeded") {
      return this.failedResult(
        "OPERATION_NOT_FOUND",
        "Prior operation has no successful trash outcome to restore."
      );
    }
    const priorItems = await this.operationModule.listItems(prior.operationId);
    const restorable = priorItems.filter(
      (item) => item.status === "succeeded" || item.status === "noop"
    );
    if (restorable.length === 0) {
      return this.failedResult(
        "OPERATION_NOT_FOUND",
        "Prior operation has no restorable items."
      );
    }

    const messageIds = restorable.map((item) => item.messageId);
    const destinationOverride = input.destinationFolderPath ?? null;
    const destinations = new Map<number, string | null>();
    for (const messageId of messageIds) {
      const recorded =
        restorable.find((item) => item.messageId === messageId)?.beforeFolderPath ?? null;
      destinations.set(messageId, destinationOverride ?? recorded);
      if ((destinationOverride ?? recorded) === null) {
        return this.failedResult(
          "DESTINATION_INVALID",
          "No restore destination folder is recorded; pick a folder."
        );
      }
    }

    const operation = await this.operationModule.createOperation({
      operationId: crypto.randomUUID(),
      kind: "restore",
      emailServiceId: prior.emailServiceId,
      origin: input.origin,
      payloadHash: this.restorePayloadHash(prior.operationId, input.destinationFolderPath ?? null),
      idempotencyKey: `restorev1:${prior.operationId}:${input.destinationFolderPath ?? "recorded"}:${input.actionId ?? "fresh"}`,
      sourceUserMessageId: input.actionId ?? null,
      messageIds,
      destinations: Object.fromEntries(destinations),
      policyVersion: "fwv1",
    });
    if (operation.status === "existing") {
      return await this.projectResult(operation.operation.operationId, prior.operationId);
    }
    const createdOperationId = operation.operation.operationId;

    for (const messageId of messageIds) {
      await this.restoreOne(createdOperationId, messageId, destinations.get(messageId) ?? null, prior.operationId, input.origin);
    }
    return await this.projectResult(createdOperationId, prior.operationId);
  }

  private async restoreOne(
    operationId: string,
    messageId: number,
    destinationFolder: string | null,
    priorOperationId: string,
    origin: TrashMessageInput["origin"]
  ): Promise<void> {
    const location = await this.locationModule.readByMessageId(messageId);
    if (!location || location.state !== "verified" || location.folderPath === null || location.uidValidity === null) {
      const items = await this.operationModule.listItems(operationId);
      const item = items.find((entry) => entry.messageId === messageId);
      if (item) {
        await this.operationModule.finalizeItem({
          itemId: item.id,
          operationId,
          status: "failed",
          errorCode: "LOCATION_STALE",
          sanitizedError: "Message location in Trash is not verified.",
        });
      }
      return;
    }

    const items = await this.operationModule.listItems(operationId);
    const item = items.find((entry) => entry.messageId === messageId);
    if (!item) return;

    const claim = await this.operationModule.claimItem({
      operationId,
      messageId,
      claimTokenHash: hashClaimToken(generateClaimToken()),
      leaseExpiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.attemptLeaseMs),
      location: {
        version: location.version,
        folderPath: location.folderPath,
        uidValidity: location.uidValidity,
        providerUid: location.providerUid,
      },
      destinationFolderPath: destinationFolder,
    });
    if (claim.status !== "claimed") return;

    const receiveConfig = await this.resolveReceiveConfig(location.emailServiceId);
    if (!receiveConfig) {
      await this.operationModule.finalizeItem({
        itemId: claim.itemId,
        operationId,
        status: "failed",
        errorCode: "ACCOUNT_NOT_AVAILABLE",
        sanitizedError: "Account receive configuration unavailable.",
      });
      return;
    }

    const move = await this.adapter.moveMessage(
      receiveConfig,
      { folderPath: location.folderPath, uidValidity: location.uidValidity, uid: location.providerUid },
      destinationFolder as string
    );
    await this.persistMoveOutcome(operationId, claim.itemId, messageId, location.emailServiceId, move, destinationFolder as string, origin, priorOperationId, claim.attemptId);
  }

  /** Shared outcome persistence for trash + restore moves. */
  private async persistMoveOutcome(
    operationId: string,
    itemId: number,
    messageId: number,
    emailServiceId: number,
    move: MoveResult,
    destinationFolder: string,
    origin: TrashMessageInput["origin"],
    priorOperationId?: string,
    attemptId?: number
  ): Promise<void> {
    if (move.status === "moved") {
      // Record the provider mapping on the attempt BEFORE local commits: if
      // the process dies between remote success and local persistence, the
      // reconcile path has durable evidence (design §6.2/§10.3).
      if (attemptId !== undefined) {
        await this.operationModule
          .recordAttemptEvidence(
            attemptId,
            JSON.stringify({
              destinationFolder,
              destinationUid: move.destinationUid,
              destinationUidValidity: move.destinationUidValidity,
            })
          )
          .catch((error: unknown) => {
            log.warn(
              `[EmailMailboxActionService] attempt evidence write failed (item ${itemId}):`,
              error instanceof Error ? error.message : String(error)
            );
          });
      }
      const destinationUid = move.destinationUid;
      const applyOk = await this.locationModule.applyMove({
        messageId,
        // Optimistic fence: the claim froze the version; if another writer
        // moved the row meanwhile the apply fails and reconciliation repairs.
        expectedVersion: (await this.locationModule.readByMessageId(messageId))?.version ?? 0,
        folderPath: destinationFolder,
        uidValidity: move.destinationUidValidity,
        providerUid: destinationUid ?? (await this.locationModule.readByMessageId(messageId))?.providerUid ?? "",
        state: destinationUid !== null ? "verified" : "stale",
        lastOperationId: operationId,
      });
      if (!applyOk) {
        log.warn(
          `[EmailMailboxActionService] location version moved concurrently for message ${messageId}; scheduling reconciliation`
        );
      }
      // Reply coordination (design §10.4): the location changed, so any
      // pending reply approval bound to the old location is invalid now.
      try {
        const invalidated = await this.replyDraftModule.invalidateUnsentDraftsForMessage(
          messageId,
          `message moved to ${destinationFolder}`
        );
        if (invalidated > 0) {
          log.info(
            `[EmailMailboxActionService] invalidated ${invalidated} pending reply draft(s) after move of message ${messageId}`
          );
        }
      } catch (error) {
        log.warn(
          `[EmailMailboxActionService] reply invalidation failed for message ${messageId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
      await this.operationModule.finalizeItem({
        itemId,
        operationId,
        status: "succeeded",
        attemptId: null,
        resultJson: JSON.stringify({
          destinationFolder,
          destinationUid,
          destinationUidValidity: move.destinationUidValidity,
          priorOperationId: priorOperationId ?? null,
        }),
      });
      await this.operationModule.recordAudit({
        operationId,
        itemId,
        messageId,
        emailServiceId,
        actor: origin === "tool_confirmation" ? "ai" : "user",
        action: "message_moved",
        status: "succeeded",
        detail: { destinationFolder, priorOperationId: priorOperationId ?? null },
      });
      return;
    }

    if (move.status === "no_move_capability") {
      await this.operationModule.finalizeItem({
        itemId,
        operationId,
        status: "failed",
        errorCode: "CAPABILITY_UNSUPPORTED",
        sanitizedError: "Server does not support native MOVE.",
      });
      return;
    }
    if (move.status === "uid_validity_changed") {
      await this.locationModule.markStale(messageId);
      await this.operationModule.finalizeItem({
        itemId,
        operationId,
        status: "failed",
        errorCode: "UID_VALIDITY_CHANGED",
        sanitizedError: "Folder UID validity changed; re-select the message.",
      });
      return;
    }
    if (move.status === "source_missing") {
      await this.operationModule.finalizeItem({
        itemId,
        operationId,
        status: "failed",
        errorCode: "SOURCE_NOT_FOUND",
        sanitizedError: "Message is no longer at its verified location.",
      });
      return;
    }
    if (move.status === "failed" && move.reasonCode === "OUTCOME_UNKNOWN") {
      await this.operationModule.finalizeItem({
        itemId,
        operationId,
        status: "outcome_unknown",
        errorCode: "OUTCOME_UNKNOWN",
        sanitizedError: move.sanitizedError,
      });
      await this.operationModule.recordAudit({
        operationId,
        itemId,
        messageId,
        emailServiceId,
        action: "move_outcome_pending",
        status: "outcome_unknown",
        reasonCode: "OUTCOME_UNKNOWN",
      });
      return;
    }
    await this.operationModule.finalizeItem({
      itemId,
      operationId,
      status: "failed",
      errorCode: move.status === "failed" ? move.reasonCode : "PROVIDER_REJECTED",
      sanitizedError: move.status === "failed" ? move.sanitizedError : "move failed",
    });
  }

  /** Startup/lease reconciliation (design §13): expired claims become unknown. */
  async reconcileExpiredClaims(): Promise<number> {
    await this.ensureConnection();
    const expired = await this.operationModule.findExpiredClaims(new Date());
    let reconciled = 0;
    for (const { attempt, item } of expired) {
      // The dispatch may or may not have happened; evidence, not timers,
      // decides. Conservative: mark unknown, never replay.
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId: item.operationId,
        status: "outcome_unknown",
        errorCode: "OUTCOME_UNKNOWN",
        sanitizedError: "Claim lease expired without a durable result.",
        attemptId: attempt.id,
      });
      reconciled += 1;
    }
    return reconciled;
  }

  /**
   * Evidence-based reconciliation for one operation with unknown items
   * (design §10.3): probe the source folder — if the message left and a
   * destination mapping exists on the attempt result, record success.
   */
  async reconcileOperation(operationId: string): Promise<MailboxActionOutcome> {
    await this.ensureConnection();
    const operation = await this.operationModule.readOperation(operationId);
    if (!operation) {
      return this.failedResult("OPERATION_NOT_FOUND", "Operation not found.");
    }
    const items = await this.operationModule.listItems(operationId);
    const receiveConfig = await this.resolveReceiveConfig(operation.emailServiceId);
    if (!receiveConfig) {
      return this.failedResult("ACCOUNT_NOT_AVAILABLE", "Account unavailable.");
    }

    for (const item of items) {
      if (item.status !== "outcome_unknown") continue;
      if (item.beforeFolderPath === null || item.beforeUidValidity === null || item.beforeProviderUid === null) {
        continue;
      }
      const presence: PresenceResult = await this.adapter.checkMessagePresent(receiveConfig, {
        folderPath: item.beforeFolderPath,
        uidValidity: item.beforeUidValidity,
        uid: item.beforeProviderUid,
      });
      const attemptRows = await this.operationModule.listAttemptsForItem(item.id);
      const mappingEvidence = attemptRows
        .map((attempt) => attempt.resultJson)
        .filter((json): json is string => json !== null)
        .map((json) => {
          try {
            return JSON.parse(json) as { destinationUid?: string | null };
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed !== null && typeof parsed.destinationUid === "string");

      if (presence.status === "absent" && mappingEvidence && item.destinationFolderPath !== null) {
        // Design §10.3: source absent + a strongly verified destination
        // mapping reconciles to success. Absence alone (destination unknown,
        // e.g. the user deleted the message in another client) must NOT be
        // recorded as a successful move.
        const applyOk = await this.locationModule.applyMove({
          messageId: item.messageId,
          expectedVersion: item.beforeLocationVersion ?? 0,
          folderPath: item.destinationFolderPath,
          uidValidity: null,
          providerUid: mappingEvidence.destinationUid as string,
          state: "verified",
          lastOperationId: operationId,
        });
        if (!applyOk) {
          await this.operationModule.finalizeItem({
            itemId: item.id,
            operationId,
            status: "outcome_unknown",
            errorCode: "LOCAL_COMMIT_PENDING",
            sanitizedError: "Location changed during reconciliation; retry.",
          });
          continue;
        }
        await this.operationModule.finalizeItem({
          itemId: item.id,
          operationId,
          status: "succeeded",
          resultJson: JSON.stringify({ reconciled: true, destinationFolder: item.destinationFolderPath }),
        });
        await this.operationModule.recordAudit({
          operationId,
          itemId: item.id,
          messageId: item.messageId,
          emailServiceId: operation.emailServiceId,
          action: "reconciled_move",
          status: "succeeded",
          detail: { destinationFolder: item.destinationFolderPath },
        });
      } else if (presence.status === "absent") {
        // Source empty, destination unknown or ambiguous → outcome unknown
        // (design §10.3). Do not invent a destination.
        await this.operationModule.finalizeItem({
          itemId: item.id,
          operationId,
          status: "outcome_unknown",
          errorCode: "OUTCOME_UNKNOWN",
          sanitizedError: "Source folder is empty but no destination mapping exists; manual resolution required.",
        });
      } else if (presence.status === "present") {
        // Still at source: the move did not happen. Mark failed so the user
        // can retry under a fresh authorization (proven non-dispatch here).
        await this.operationModule.finalizeItem({
          itemId: item.id,
          operationId,
          status: "failed",
          errorCode: "NETWORK_BEFORE_DISPATCH",
          sanitizedError: "Message still at source; the move did not complete.",
        });
      }
    }
    return await this.projectResult(operationId);
  }

  // ---- helpers ----

  private async createOperation(
    input: TrashMessageInput,
    emailServiceId: number,
    messageIds: number[],
    trashFolder: string,
    kind: "trash"
  ): Promise<EmailOrganizationOperationEntity> {
    const actionId = input.actionId ?? `fresh-${crypto.randomUUID()}`;
    const payloadHash = this.trashPayloadHash(messageIds, trashFolder);
    const result = await this.operationModule.createOperation({
      operationId: crypto.randomUUID(),
      kind,
      emailServiceId,
      origin: input.origin,
      payloadHash,
      idempotencyKey: `trashv1:${emailServiceId}:${messageIds.join(",")}:v-${actionId}`,
      conversationId: input.conversationId ?? null,
      sourceUserMessageId: input.actionId ?? null,
      messageIds,
      destinations: Object.fromEntries(messageIds.map((id) => [id, trashFolder])),
      policyVersion: "fwv1",
    });
    return result.operation;
  }

  private trashPayloadHash(messageIds: readonly number[], trashFolder: string): string {
    return crypto
      .createHash("sha256")
      .update(`trashv1|${messageIds.join(",")}|${trashFolder}`)
      .digest("hex");
  }

  private restorePayloadHash(priorOperationId: string, destination: string | null): string {
    return crypto
      .createHash("sha256")
      .update(`restorev1|${priorOperationId}|${destination ?? "recorded"}`)
      .digest("hex");
  }

  private async resolveTrashFolder(emailServiceId: number): Promise<string | null> {
    if (this.capabilityService) {
      const capabilities = await this.capabilityService.getCapabilities(emailServiceId);
      return capabilities.trashFolderPath;
    }
    // Without a capability service, resolve Trash from a live folder probe.
    const receiveConfig = await this.resolveReceiveConfig(emailServiceId);
    if (!receiveConfig) return null;
    const listing = await this.adapter.listFolders(receiveConfig);
    if (listing.status !== "listed") return null;
    return listing.folders.find((folder) => folder.specialUse === "\\Trash")?.path ?? null;
  }

  private async resolveReceiveConfig(
    emailServiceId: number
  ): Promise<EmailReceiveConnectionConfig | null> {
    if (this.capabilityService) {
      return await this.capabilityService.getReceiveConfig(emailServiceId);
    }
    const { EmailServiceModule } = await import("@/modules/emailServiceModule");
    return await new EmailServiceModule().getEmailServiceReceiveConfig(emailServiceId);
  }

  private async projectResult(
    operationId: string,
    priorOperationId?: string
  ): Promise<MailboxActionOutcome> {
    const operation = await this.operationModule.readOperation(operationId);
    if (!operation) {
      return this.failedResult("OPERATION_NOT_FOUND", "Operation vanished.");
    }
    const status = operation.status;
    const success = status === "succeeded";
    // The tool contract's EmailActionStatus has no prepared/authorized
    // states; pre-execution states surface as running (open work exists).
    const actionStatus: EmailActionStatus =
      status === "prepared" || status === "awaiting_approval" || status === "authorized"
        ? "running"
        : status;
    return {
      success,
      operationId,
      status: actionStatus,
      completed: operation.completedCount,
      failed: operation.failedCount,
      unresolved: operation.unknownCount,
      pending: operation.pendingCount,
      cancelled: operation.cancelledCount,
      errorCode: operation.errorCode ?? undefined,
      retryable: isRetryableOrganizationErrorCode(operation.errorCode),
      ...(priorOperationId !== undefined ? { priorOperationId } : {}),
    };
  }

  private failedResult(code: string, message: string): MailboxActionOutcome {
    // No operation was created; surface a deterministic failure envelope.
    return {
      success: false,
      operationId: "",
      status: "failed",
      completed: 0,
      failed: 1,
      unresolved: 0,
      pending: 0,
      cancelled: 0,
      errorCode: code,
      retryable: false,
      error: message,
    };
  }
}
