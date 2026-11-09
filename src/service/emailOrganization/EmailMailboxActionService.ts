import crypto from "crypto";
import { runWithAccountLock } from "@/service/emailOrganization/accountMutex";
import { log } from "@/modules/Logger";
import { BaseModule } from "@/modules/baseModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailMessageLocationModule } from "@/modules/EmailMessageLocationModule";
import { EmailOrganizationOperationModule } from "@/modules/EmailOrganizationOperationModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailForwardDraftModule } from "@/modules/EmailForwardDraftModule";
import { parseStringArrayJson } from "@/utils/jsonArray";
import { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";
import { ImapEmailMailboxAdapter as DefaultMailboxAdapter } from "@/service/emailOrganization/ImapEmailMailboxAdapter";
import {
  EmailOrganizationSelectionService,
} from "@/service/emailOrganization/EmailOrganizationSelectionService";
import type { EmailOrganizationSelectionEntity } from "@/entity/EmailOrganizationSelection.entity";
import type { EmailOrganizationOperationEntity } from "@/entity/EmailOrganizationOperation.entity";
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
  private readonly capabilityService: EmailOrganizationCapabilityService;

  constructor(options?: {
    adapter?: EmailMailboxAdapter;
    capabilityService?: EmailOrganizationCapabilityService;
  }) {
    super();
    this.messageModule = new EmailReceivedMessageModule();
    this.locationModule = new EmailMessageLocationModule();
    this.operationModule = new EmailOrganizationOperationModule();
    this.replyDraftModule = new EmailReplyDraftModule();
    this.adapter = options?.adapter ?? new DefaultMailboxAdapter();
    // R5-05: production ALWAYS resolves Trash through the capability
    // service's writable-and-unambiguous policy. The default shares the
    // injected adapter so tests exercise the real wiring with a fake
    // adapter alone (no capabilityService injection shortcut).
    this.capabilityService =
      options?.capabilityService ??
      new EmailOrganizationCapabilityService({ adapter: this.adapter });
  }

  /** R07: per-account coordination spanning preflight→claim→I/O→persist. */
  private async runSerialized<T>(
    emailServiceId: number,
    work: () => Promise<T>
  ): Promise<T> {
    return await runWithAccountLock(emailServiceId, work);
  }

  async trashMessage(input: TrashMessageInput): Promise<MailboxActionOutcome> {
    await this.ensureConnection();
    return await this.runSerialized(
      (await this.messageModule.read(input.messageId))?.emailServiceId ?? 0,
      async () => await this.trashMessageInternal(input)
    );
  }

  private async trashMessageInternal(input: TrashMessageInput): Promise<MailboxActionOutcome> {
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
    // Live-verified (R06): the cached location is confirmed against the
    // server before a no-op is recorded.
    if (location.folderPath === trashFolder) {
      const receiveConfigForNoop = await this.resolveReceiveConfig(message.emailServiceId);
      if (!receiveConfigForNoop) {
        // T06: missing config is an unavailable state, never a verified no-op.
        return this.failedResult(
          "ACCOUNT_NOT_AVAILABLE",
          "Account receive configuration is unavailable; the no-op could not be verified."
        );
      }
      const noopPresence = await this.adapter.checkMessagePresent(receiveConfigForNoop, {
        folderPath: location.folderPath,
        uidValidity: location.uidValidity,
        uid: location.providerUid,
      });
      if (noopPresence.status === "absent") {
        return this.failedResult(
          "SOURCE_NOT_FOUND",
          "The cached Trash location no longer holds this message."
        );
      }
      if (noopPresence.status === "uid_validity_changed") {
        await this.locationModule.markStale(message.id);
        return this.failedResult(
          "UID_VALIDITY_CHANGED",
          "Trash folder UID validity changed; re-sync before acting."
        );
      }
      if (noopPresence.status === "failed") {
        return this.failedResult(
          "OUTCOME_UNKNOWN",
          "The Trash presence check failed; the no-op could not be verified."
        );
      }
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
        const currentItem = (await this.operationModule.listItems(noopOperation.operationId))[0];
        if (currentItem.status === "pending") {
          await this.operationModule.finalizeItem({
            itemId: currentItem.id,
            operationId: noopOperation.operationId,
            status: "failed",
            errorCode: "LOCAL_COMMIT_PENDING",
            sanitizedError: `No-op item could not be claimed (${claim.status}).`,
          });
        }
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

    // R4-04: a duplicate call on a message with an open (nonterminal)
    // operation returns that operation's durable outcome instead of creating
    // a fresh one whose claim-refusal would destroy unknown state.
    const openOperation = await this.operationModule
      .findOpenOperationForMessage(message.id);
    if (openOperation !== null) {
      return await this.projectResult(openOperation.operationId);
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
      // R4-04: claim refusal is NOT proof of non-dispatch. Only a still-
      // pending item may be finalized failed; claimed (concurrent execution)
      // and unknown (awaiting reconciliation) items keep their durable
      // outcome — a duplicate call must never destroy an unknown state.
      const current = await this.operationModule.findItemById(item.id);
      if (current !== null && current.status !== "pending") {
        return await this.projectResult(operation.operationId);
      }
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

    // R5-04: durable dispatch evidence — reconciliation may only treat
    // "still at source" as proven non-dispatch when this marker is absent.
    await this.operationModule.markAttemptDispatched(claim.attemptId);

    const move = await this.adapter.moveMessage(
      receiveConfig,
      { folderPath: location.folderPath, uidValidity: location.uidValidity, uid: location.providerUid },
      trashFolder
    );
    await this.persistMoveOutcome(operation.operationId, claim.itemId, message.id, message.emailServiceId, move, trashFolder, input.origin, undefined, claim.attemptId, location.version);
    return await this.projectResult(operation.operationId);
  }

  /**
   * Bulk Trash over a frozen selection (PRD FR-19, design §11): one account,
   * at most 100 items, executed strictly one move at a time with a
   * cancellation check before every claim (FR-20). Stale-version targets are
   * revalidated and individually reported (AC-14); partial completion is
   * never an aggregate success.
   */
  /**
   * R12: prompt-start variant — creates the durable operation synchronously
   * and executes the bulk loop detached, so the caller gets the operation id
   * immediately and can monitor/cancel while it runs.
   */
  async startTrashSelection(input: {
    selectionId: string;
    origin: TrashMessageInput["origin"];
    actionId?: string | null;
  }): Promise<{ operationId: string } | MailboxActionOutcome> {
    await this.ensureConnection();
    const selectionService = new EmailOrganizationSelectionService();
    const selection = await selectionService.readValidSelection(input.selectionId);
    if (selection.kind !== "trash") {
      return this.failedResult(
        "VALIDATION_FAILED",
        `Selection was frozen for '${selection.kind}', not 'trash'.`
      );
    }
    const parsed = selectionService.parseSelection(selection);
    const destinations: Record<number, string> = {};
    for (const messageId of parsed.messageIds) {
      const destination = parsed.destinations?.[messageId];
      if (typeof destination !== "string") {
        return this.failedResult(
          "DESTINATION_INVALID",
          `Selection item ${messageId} has no recorded destination.`
        );
      }
      destinations[messageId] = destination;
    }
    const operationId = await this.createBulkOperation(
      selection,
      parsed.messageIds,
      destinations,
      input.origin,
      input.actionId ?? null,
      "trash"
    );
    void this.runSerialized(selection.emailServiceId, async () => {
      // R4-10: revalidate expiry after queue admission — a selection that
      // waited past its TTL never starts moving messages.
      await selectionService.readValidSelection(input.selectionId);
      await this.executeBulkLoop(operationId, selection, parsed.messageIds, destinations, input.origin, "trash");
    }).catch(async (error: unknown) => {
      log.error("[EmailMailboxActionService] detached bulk execution failed:", error);
      // R4-11: persist the failure durably so pending work is recoverable.
      await this.operationModule.cancelPending(operationId).catch(() => undefined);
    });
    return { operationId };
  }

  async startRestoreSelection(input: {
    selectionId: string;
    origin: TrashMessageInput["origin"];
    actionId?: string | null;
  }): Promise<{ operationId: string } | MailboxActionOutcome> {
    await this.ensureConnection();
    const selectionService = new EmailOrganizationSelectionService();
    const selection = await selectionService.readValidSelection(input.selectionId);
    if (selection.kind !== "restore") {
      return this.failedResult(
        "VALIDATION_FAILED",
        `Selection was frozen for '${selection.kind}', not 'restore'.`
      );
    }
    const parsed = selectionService.parseSelection(selection);
    if (parsed.destinations === null) {
      return this.failedResult(
        "DESTINATION_INVALID",
        "The selection does not record restore destinations."
      );
    }
    const operationId = await this.createBulkOperation(
      selection,
      parsed.messageIds,
      parsed.destinations,
      input.origin,
      input.actionId ?? null,
      "restore"
    );
    void this.runSerialized(selection.emailServiceId, async () => {
      // R4-10: revalidate expiry after queue admission.
      await selectionService.readValidSelection(input.selectionId);
      await this.executeBulkLoop(
        operationId,
        selection,
        parsed.messageIds,
        parsed.destinations as Record<number, string>,
        input.origin,
        "restore"
      );
    }).catch(async (error: unknown) => {
      log.error("[EmailMailboxActionService] detached bulk execution failed:", error);
      // R4-11: persist the failure durably so pending work is recoverable.
      await this.operationModule.cancelPending(operationId).catch(() => undefined);
    });
    return { operationId };
  }

  /** Operation creation shared by the awaited and prompt-start bulk paths. */
  private async createBulkOperation(
    selection: EmailOrganizationSelectionEntity,
    messageIds: number[],
    destinations: Record<number, string>,
    origin: TrashMessageInput["origin"],
    actionId: string | null,
    kind: "trash" | "restore"
  ): Promise<string> {
    const actionKey = actionId ?? `fresh-${crypto.randomUUID()}`;
    const payloadHash = crypto
      .createHash("sha256")
      .update(`bulk-${kind}|${selection.payloadHash}|${actionKey}`)
      .digest("hex");
    const operationResult = await this.operationModule.createOperation({
      operationId: crypto.randomUUID(),
      kind,
      emailServiceId: selection.emailServiceId,
      origin,
      payloadHash,
      idempotencyKey: `bulk${kind}v1:${selection.selectionId}:${actionKey}`,
      sourceUserMessageId: actionId,
      messageIds,
      destinations,
      policyVersion: "fwv1",
    });
    return operationResult.operation.operationId;
  }

  private async executeBulkLoop(
    operationId: string,
    selection: EmailOrganizationSelectionEntity,
    messageIds: number[],
    destinations: Record<number, string>,
    origin: TrashMessageInput["origin"],
    kind: "trash" | "restore"
  ): Promise<void> {
    // R5-05: restore destinations are validated once per bulk run — folders
    // that vanished or are read-only fail their items DESTINATION_INVALID.
    const unwritable = kind === "restore"
      ? await this.resolveUnwritableRestoreDestinations(selection.emailServiceId, Object.values(destinations))
      : undefined;
    for (const messageId of messageIds) {
      const operation = await this.operationModule.readOperation(operationId);
      if (operation?.cancelRequestedAt !== null && operation?.cancelRequestedAt !== undefined) {
        await this.operationModule.cancelPending(operationId);
        break;
      }
      await this.bulkOne(operationId, messageId, destinations[messageId] ?? null, selection, kind, origin, unwritable);
    }
  }

  /**
   * R5-05: restore destinations must exist AND be writable at execution
   * time. Returns the subset of destination folders that are missing or
   * read-only (unknown listing → every destination counts as unusable).
   */
  private async resolveUnwritableRestoreDestinations(
    emailServiceId: number,
    destinationFolders: readonly string[]
  ): Promise<Set<string>> {
    const all = new Set(destinationFolders);
    const receiveConfig = await this.resolveReceiveConfig(emailServiceId);
    if (!receiveConfig) return all;
    const listing = await this.adapter.listFolders(receiveConfig);
    if (listing.status !== "listed") return all;
    const byPath = new Map(listing.folders.map((folder) => [folder.path, folder]));
    const unwritable = new Set<string>();
    for (const folder of all) {
      const info = byPath.get(folder);
      if (info === undefined || !info.writable) {
        unwritable.add(folder);
      }
    }
    return unwritable;
  }

  async trashSelection(input: {
    selectionId: string;
    origin: TrashMessageInput["origin"];
    actionId?: string | null;
  }): Promise<MailboxActionOutcome> {
    await this.ensureConnection();
    const selectionService = new EmailOrganizationSelectionService();
    const selection = await selectionService.readValidSelection(input.selectionId);
    return await this.runSerialized(selection.emailServiceId, async () => {
    // R4-10: revalidate AFTER acquiring the account lock — queued work can
    // wait behind other operations and must not start past its 15-minute
    // approval window.
    await selectionService.readValidSelection(input.selectionId);
    if (selection.kind !== "trash") {
      // Consent integrity: a selection frozen for one action must never be
      // executed under another (a trash selection executed as restore would
      // move messages INTO Trash under a restore confirmation).
      return this.failedResult(
        "VALIDATION_FAILED",
        `Selection was frozen for '${selection.kind}', not 'trash'.`
      );
    }
    const parsed = selectionService.parseSelection(selection);
    const destinations: Record<number, string> = {};
    for (const messageId of parsed.messageIds) {
      const destination = parsed.destinations?.[messageId];
      if (typeof destination !== "string") {
        return this.failedResult(
          "DESTINATION_INVALID",
          `Selection item ${messageId} has no recorded destination.`
        );
      }
      destinations[messageId] = destination;
    }
    return await this.executeBulk(selection, parsed.messageIds, destinations, input.origin, input.actionId ?? null, "trash");
    });
  }

  /**
   * Bulk restore over a frozen restore selection: destinations are the
   * recorded original folders shown at freeze time (design §11).
   */
  async restoreSelection(input: {
    selectionId: string;
    origin: TrashMessageInput["origin"];
    actionId?: string | null;
  }): Promise<MailboxActionOutcome> {
    await this.ensureConnection();
    const selectionService = new EmailOrganizationSelectionService();
    const selection = await selectionService.readValidSelection(input.selectionId);
    return await this.runSerialized(selection.emailServiceId, async () => {
    // R4-10: revalidate after the account lock (same rule as trash bulk).
    await selectionService.readValidSelection(input.selectionId);
    if (selection.kind !== "restore") {
      return this.failedResult(
        "VALIDATION_FAILED",
        `Selection was frozen for '${selection.kind}', not 'restore'.`
      );
    }
    const parsed = selectionService.parseSelection(selection);
    if (parsed.destinations === null) {
      return this.failedResult(
        "DESTINATION_INVALID",
        "The selection does not record restore destinations."
      );
    }
    return await this.executeBulk(selection, parsed.messageIds, parsed.destinations, input.origin, input.actionId ?? null, "restore");
    });
  }

  /** Shared sequential bulk executor with per-item cancel checks (FR-20). */
  private async executeBulk(
    selection: EmailOrganizationSelectionEntity,
    messageIds: number[],
    destinations: Record<number, string>,
    origin: TrashMessageInput["origin"],
    actionId: string | null,
    kind: "trash" | "restore"
  ): Promise<MailboxActionOutcome> {
    const actionKey = actionId ?? `fresh-${crypto.randomUUID()}`;
    const payloadHash = crypto
      .createHash("sha256")
      .update(`bulk-${kind}|${selection.payloadHash}|${actionKey}`)
      .digest("hex");
    const operationResult = await this.operationModule.createOperation({
      operationId: crypto.randomUUID(),
      kind,
      emailServiceId: selection.emailServiceId,
      origin,
      payloadHash,
      idempotencyKey: `bulk${kind}v1:${selection.selectionId}:${actionKey}`,
      sourceUserMessageId: actionId,
      messageIds,
      destinations,
      policyVersion: "fwv1",
    });
    if (operationResult.status === "existing") {
      return await this.projectResult(operationResult.operation.operationId);
    }
    const operationId = operationResult.operation.operationId;
    // R5-05: restore destination validation, shared with the detached path.
    const unwritable = kind === "restore"
      ? await this.resolveUnwritableRestoreDestinations(selection.emailServiceId, Object.values(destinations))
      : undefined;

    for (const messageId of messageIds) {
      // FR-20: check the durable cancel flag before the NEXT claim; already
      // completed items stay completed, in-flight items keep reconciling.
      const operation = await this.operationModule.readOperation(operationId);
      if (operation?.cancelRequestedAt !== null && operation?.cancelRequestedAt !== undefined) {
        await this.operationModule.cancelPending(operationId);
        break;
      }
      await this.bulkOne(operationId, messageId, destinations[messageId] ?? null, selection, kind, origin, unwritable);
    }
    return await this.projectResult(operationId);
  }

  /** One preflighted, claimed, moved bulk item with individual reporting. */
  private async bulkOne(
    operationId: string,
    messageId: number,
    destinationFolder: string | null,
    selection: EmailOrganizationSelectionEntity,
    kind: "trash" | "restore",
    origin: TrashMessageInput["origin"],
    unwritableDestinations?: ReadonlySet<string>
  ): Promise<void> {
    const items = await this.operationModule.listItems(operationId);
    const item = items.find((entry) => entry.messageId === messageId);
    if (!item) return;

    const location = await this.locationModule.readByMessageId(messageId);
    let frozenVersion: number | null;
    try {
      frozenVersion = await this.selectionFrozenVersion(selection, messageId);
    } catch (error) {
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId,
        status: "failed",
        errorCode: error instanceof Error && error.name === "EmailOrganizationActionError"
          ? (error as Error & { code: string }).code
          : "LOCATION_STALE",
        sanitizedError: error instanceof Error ? error.message.slice(0, 240) : String(error),
      });
      return;
    }
    if (!location || location.state !== "verified" || location.folderPath === null || location.uidValidity === null) {
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId,
        status: "failed",
        errorCode: "LOCATION_STALE",
        sanitizedError: "Message location is not verified at execution time.",
      });
      return;
    }
    if (frozenVersion !== null && location.version !== frozenVersion) {
      // AC-14: a moved/changed target is revalidated and reported alone.
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId,
        status: "failed",
        errorCode: "LOCATION_STALE",
        sanitizedError: `Location changed since the selection was frozen (v${frozenVersion} → v${location.version}).`,
      });
      return;
    }
    if (destinationFolder === null) {
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId,
        status: "failed",
        errorCode: "DESTINATION_INVALID",
        sanitizedError: "No destination folder recorded for this item.",
      });
      return;
    }
    // R5-05: a restore destination that vanished or is read-only now fails
    // that item alone (DESTINATION_INVALID), never a silent best-effort move.
    if (kind === "restore" && unwritableDestinations?.has(destinationFolder) === true) {
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId,
        status: "failed",
        errorCode: "DESTINATION_INVALID",
        sanitizedError: `Restore destination "${destinationFolder}" is missing or read-only.`,
      });
      return;
    }
    if (kind === "restore") {
      // R5-03: execution re-binds the CURRENT occurrence to the recorded
      // Trash result — folder, uid AND uidValidity must all match the
      // durable provenance right now; an archived/moved message refuses.
      const recorded = await this.operationModule.findSucceededTrashDestinations([messageId]);
      const lineage = recorded[messageId];
      if (
        lineage === undefined ||
        lineage.destinationUid === null ||
        lineage.destinationUidValidity === null ||
        location.folderPath !== lineage.folder ||
        location.providerUid !== lineage.destinationUid ||
        location.uidValidity !== lineage.destinationUidValidity
      ) {
        await this.operationModule.finalizeItem({
          itemId: item.id,
          operationId,
          status: "failed",
          errorCode: "LOCATION_STALE",
          sanitizedError: "Message is no longer the recorded result of its Trash operation; restore the current operation instead.",
        });
        return;
      }
    }

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
    if (claim.status !== "claimed") {
      // R4-04: only still-pending items finalize failed; claimed/unknown
      // keep their durable outcome.
      const current = await this.operationModule.findItemById(item.id);
      if (current !== null && current.status === "pending") {
        await this.operationModule.finalizeItem({
          itemId: item.id,
          operationId,
          status: "failed",
          errorCode: "LOCAL_COMMIT_PENDING",
          sanitizedError: `Item could not be claimed (${claim.status}).`,
        });
      }
      return;
    }

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
    // R5-04: dispatch marker goes on immediately before the wire command.
    await this.operationModule.markAttemptDispatched(claim.attemptId);

    const move = await this.adapter.moveMessage(
      receiveConfig,
      { folderPath: location.folderPath, uidValidity: location.uidValidity, uid: location.providerUid },
      destinationFolder
    );
    await this.persistMoveOutcome(operationId, claim.itemId, messageId, location.emailServiceId, move, destinationFolder, origin, undefined, claim.attemptId, location.version);
  }

  /**
   * Fail closed (review): a malformed frozen-version row must not downgrade
   * bulk execution to unpinned current-state execution. Null is only
   * returned when the message legitimately has no frozen entry.
   */
  /**
   * R4-02 + R5-04: reply invalidation for a location change. Returns TRUE
   * only when the invalidation landed. A failure persists a durable
   * obligation (reply admission refuses until it is resolved) and every
   * later repair path retries it — a move is never a clean success while
   * old approvals may still send.
   */
  private async invalidateRepliesForMove(
    messageId: number,
    destinationFolder: string,
    itemId: number,
    operationId: string,
    emailServiceId: number
  ): Promise<boolean> {
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
      // The invalidation landed: any open obligation for this message clears.
      await this.replyDraftModule.resolveInvalidationObligations(messageId).catch(() => undefined);
      return true;
    } catch (error) {
      log.error(
        `[EmailMailboxActionService] reply invalidation FAILED for message ${messageId}:`,
        error instanceof Error ? error.message : String(error)
      );
      // R5-04: the obligation survives the process — reply admission checks
      // it before every send until a repair resolves it.
      await this.replyDraftModule
        .recordInvalidationObligation({ messageId, emailServiceId, destinationFolder })
        .catch(() => undefined);
      await this.operationModule
        .recordAudit({
          operationId,
          itemId,
          messageId,
          action: "reply_invalidation_failed",
          status: "failed",
          reasonCode: "LOCAL_COMMIT_PENDING",
          detail: { destinationFolder },
        })
        .catch(() => undefined);
      return false;
    }
  }

  private async selectionFrozenVersion(
    selection: EmailOrganizationSelectionEntity,
    messageId: number
  ): Promise<number | null> {
    let versions: Record<string, number>;
    try {
      versions = JSON.parse(selection.locationVersionsJson) as Record<string, number>;
    } catch {
      throw new EmailOrganizationActionError(
        "LOCATION_STALE",
        "The frozen selection's version record is unreadable; prepare the selection again.",
        false
      );
    }
    const version = versions[String(messageId)];
    if (typeof version !== "number") {
      throw new EmailOrganizationActionError(
        "LOCATION_STALE",
        `Message ${messageId} has no frozen version in this selection; prepare it again.`,
        false
      );
    }
    return version;
  }

  async restoreFromOperation(input: RestoreFromOperationInput): Promise<MailboxActionOutcome> {
    await this.ensureConnection();
    const priorProbe = await this.operationModule.readOperation(input.priorOperationId);
    return await this.runSerialized(
      priorProbe?.emailServiceId ?? 0,
      async () => await this.restoreFromOperationInternal(input)
    );
  }

  private async restoreFromOperationInternal(
    input: RestoreFromOperationInput
  ): Promise<MailboxActionOutcome> {
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
    // R06: only GENUINE successful moves restore — no-ops carry no original
    // provenance (their before-folder is Trash itself) and must never be
    // treated as restorable origin history.
    const restorable = priorItems.filter((item) => item.status === "succeeded");
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
      const priorItem = restorable.find((item) => item.messageId === messageId);
      const recorded = priorItem?.beforeFolderPath ?? null;
      destinations.set(messageId, destinationOverride ?? recorded);
      if ((destinationOverride ?? recorded) === null) {
        return this.failedResult(
          "DESTINATION_INVALID",
          "No restore destination folder is recorded; pick a folder."
        );
      }
      // R06 + R5-03: stale-Undo binding — the message must STILL be where
      // the prior trash operation left it. uid, UIDVALIDITY and the
      // originating operation id are ALL required; a missing field fails
      // closed (a historical Trash row that is not the current occurrence
      // must never be movable by an old Undo).
      const current = await this.locationModule.readByMessageId(messageId);
      let afterUid: string | null = null;
      let afterUidValidity: string | null = null;
      if (priorItem) {
        const attempts = await this.operationModule.listAttemptsForItem(priorItem.id);
        for (const attempt of attempts) {
          if (attempt.resultJson === null) continue;
          try {
            const evidence = JSON.parse(attempt.resultJson) as {
              destinationUid?: string | null;
              destinationUidValidity?: string | null;
            };
            // T05: bind the full after-locator (uid + uidValidity).
            if (typeof evidence.destinationUid === "string") {
              afterUid = evidence.destinationUid;
            }
            if (typeof evidence.destinationUidValidity === "string") {
              afterUidValidity = evidence.destinationUidValidity;
            }
          } catch {
            // malformed evidence: fall through with uid null
          }
        }
      }
      if (afterUid === null || afterUidValidity === null) {
        return this.failedResult(
          "LOCATION_STALE",
          "The Trash record has no verified destination locator; use the message's current location to move it."
        );
      }
      const lineageIntact =
        current !== null &&
        current.state === "verified" &&
        current.folderPath === priorItem?.destinationFolderPath &&
        current.providerUid === afterUid &&
        // T05: a UIDVALIDITY reset with the same numeric UID must not pass.
        current.uidValidity === afterUidValidity &&
        // R5-03: the current row must have been AUTHORED by this exact
        // operation — an older successful Trash row does not bind newer state.
        current.lastOperationId === prior.operationId;
      if (!lineageIntact) {
        return this.failedResult(
          "LOCATION_STALE",
          `Message ${messageId} moved since this Trash operation; use its current operation to restore.`
        );
      }
    }

    // R5-05: the restore destination must exist and be writable NOW (a
    // removed/renamed original folder fails closed before any move).
    const unwritableRestoreDestinations = await this.resolveUnwritableRestoreDestinations(
      prior.emailServiceId,
      [...new Set([...destinations.values()].filter((folder): folder is string => folder !== null))]
    );
    if (unwritableRestoreDestinations.size > 0) {
      return this.failedResult(
        "DESTINATION_INVALID",
        `Restore destination(s) missing or read-only: ${[...unwritableRestoreDestinations].slice(0, 3).join(", ")}.`
      );
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

    // R5-04: dispatch marker goes on immediately before the wire command.
    await this.operationModule.markAttemptDispatched(claim.attemptId);

    const move = await this.adapter.moveMessage(
      receiveConfig,
      { folderPath: location.folderPath, uidValidity: location.uidValidity, uid: location.providerUid },
      destinationFolder as string
    );
    await this.persistMoveOutcome(operationId, claim.itemId, messageId, location.emailServiceId, move, destinationFolder as string, origin, priorOperationId, claim.attemptId, location.version);
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
    attemptId?: number,
    claimFrozenVersion?: number | null
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
      if (destinationUid === null) {
        // R5-03: the server confirmed the move but returned no uid map —
        // there is NO verified destination locator, so the item is unknown
        // (never `succeeded`): the null-uid restore check must not treat
        // this as lineage. The cached location flips to stale honestly.
        const currentRow = await this.locationModule.readByMessageId(messageId);
        await this.locationModule
          .applyMove({
            messageId,
            expectedVersion: claimFrozenVersion ?? currentRow?.version ?? 0,
            folderPath: destinationFolder,
            uidValidity: move.destinationUidValidity ?? currentRow?.uidValidity ?? "",
            providerUid: currentRow?.providerUid ?? "",
            state: "stale",
            lastOperationId: operationId,
          })
          .catch(() => undefined);
        await this.operationModule.finalizeItem({
          itemId,
          operationId,
          status: "outcome_unknown",
          errorCode: "OUTCOME_UNKNOWN",
          sanitizedError: "The move was issued but the server returned no destination uid map; reconcile.",
          attemptId: attemptId ?? null,
        });
        await this.operationModule.recordAudit({
          operationId,
          itemId,
          messageId,
          emailServiceId,
          action: "move_outcome_pending",
          status: "outcome_unknown",
          reasonCode: "OUTCOME_UNKNOWN",
          detail: { destinationFolder },
        });
        return;
      }
      // Optimistic fence against the CLAIM-FROZEN version: a fresh read
      // here would always pass and silently overwrite a concurrent move.
      const currentRow = await this.locationModule.readByMessageId(messageId);
      const applyOk = await this.locationModule.applyMove({
        messageId,
        expectedVersion: claimFrozenVersion ?? currentRow?.version ?? 0,
        folderPath: destinationFolder,
        uidValidity: move.destinationUidValidity,
        providerUid: destinationUid ?? currentRow?.providerUid ?? "",
        state: destinationUid !== null ? "verified" : "stale",
        lastOperationId: operationId,
      });
      if (!applyOk) {
        // Another writer moved the location between claim and apply: the
        // remote move DID happen, so the item is honestly unknown and the
        // reconcile path (with the attempt evidence) repairs state.
        log.warn(
          `[EmailMailboxActionService] location version moved concurrently for message ${messageId}; recording unknown for reconciliation`
        );
        await this.operationModule.finalizeItem({
          itemId,
          operationId,
          status: "outcome_unknown",
          errorCode: "LOCAL_COMMIT_PENDING",
          sanitizedError: "Location changed concurrently during the move; reconcile.",
        });
        return;
      }
      // Reply coordination (design §10.4): the location changed, so any
      // pending reply approval bound to the old location is invalid now.
      // R5-04: a failed invalidation is NOT a clean success — the item stays
      // unknown until the durable obligation lands (reconcile retries it).
      const repliesInvalidated = await this.invalidateRepliesForMove(
        messageId,
        destinationFolder,
        itemId,
        operationId,
        emailServiceId
      );
      if (!repliesInvalidated) {
        await this.operationModule.finalizeItem({
          itemId,
          operationId,
          status: "outcome_unknown",
          errorCode: "REPLY_INVALIDATION_PENDING",
          sanitizedError: "The move completed but pending reply approvals could not be invalidated; reconcile.",
        });
        await this.operationModule.recordAudit({
          operationId,
          itemId,
          messageId,
          emailServiceId,
          action: "move_outcome_pending",
          status: "outcome_unknown",
          reasonCode: "REPLY_INVALIDATION_PENDING",
          detail: { destinationFolder },
        });
        return;
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
   * R4-11 + R5-04: settle ORPHANED pending work — nonterminal operations
   * with pending items but no live executor. An operation only counts as
   * orphaned when its heartbeat (updatedAt, refreshed on every claim/
   * finalize/cancel) is older than the settle threshold AND it holds no
   * claimed items — work that is merely waiting for the account lock or
   * progressing through a bulk loop is never cancelled by the timer.
   */
  async settleOrphanedPendingOperations(): Promise<number> {
    await this.ensureConnection();
    const operations = await this.operationModule.findNonTerminalOperations();
    const staleBefore = new Date(Date.now() - EMAIL_ORGANIZATION_LIMITS.orphanSettleThresholdMs);
    let settled = 0;
    for (const operation of operations) {
      try {
        await this.runSerialized(operation.emailServiceId, async () => {
          // Expired claims inside a nonterminal operation reconcile first.
          await this.reconcileExpiredClaims();
          const items = await this.operationModule.listItems(operation.operationId);
          const pending = items.filter((item) => item.status === "pending");
          if (pending.length === 0) return;
          // In-flight claimed items belong to a live (or crashed) executor
          // whose outcome reconciles by lease — never swept here.
          const hasLiveClaim = items.some((item) => item.status === "claimed");
          if (hasLiveClaim) return;
          // R5-04: freshness gate — an operation touched within the settle
          // threshold (including one created seconds ago in this process,
          // queued behind the account lock) is NOT orphaned.
          const lastActivity = operation.updatedAt ?? operation.requestedAt;
          if (lastActivity.getTime() > staleBefore.getTime()) return;
          await this.operationModule.cancelPending(operation.operationId);
          settled += pending.length;
        });
      } catch (error) {
        log.warn(
          `[EmailMailboxActionService] orphan settle failed for ${operation.operationId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    return settled;
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
    // R04: kind guard — MOVE reconciliation applies only to mailbox moves.
    // Forward/SMTP uncertainty is NEVER resolved from the source mailbox
    // (source presence does not prove a submission did not happen).
    if (operation.kind === "forward") {
      // R5-02: forward uncertainty resolves from durable SMTP/Sent evidence
      // only — the Sent search never resubmits and never touches source mail.
      return await this.runSerialized(operation.emailServiceId, async () =>
        await this.reconcileForwardOperationInternal(operation, operationId)
      );
    }
    if (operation.kind !== "trash" && operation.kind !== "restore") {
      return this.failedResult(
        "OUTCOME_UNKNOWN",
        "This operation kind has no mailbox reconciliation path; status remains unknown."
      );
    }
    // R07: reconciliation mutates the same rows as in-flight moves — it runs
    // under the same per-account lock.
    return await this.runSerialized(operation.emailServiceId, async () =>
      await this.reconcileOperationInternal(operation, operationId)
    );
  }

  /**
   * R5-02 (design §9.4/§10.3): evidence-only reconciliation for forward
   * operations. Searches the SENDING account's Sent folder for the frozen
   * composed Message-ID; finding it proves the server accepted the DATA
   * (never proof per recipient). A missing copy is NOT proof of non-delivery
   * — the outcome stays unknown. SMTP is never called again.
   */
  private async reconcileForwardOperationInternal(
    operation: EmailOrganizationOperationEntity,
    operationId: string
  ): Promise<MailboxActionOutcome> {
    const items = await this.operationModule.listItems(operationId);
    const unresolved = items.filter((item) => item.status === "outcome_unknown");
    if (unresolved.length === 0) {
      return await this.projectResult(operationId);
    }
    if (operation.draftId === null) {
      return this.failedResult("OUTCOME_UNKNOWN", "Forward operation has no draft binding; status remains unknown.");
    }

    const draft = await new EmailForwardDraftModule().readDraft(operation.draftId);
    if (!draft) {
      return this.failedResult("OUTCOME_UNKNOWN", "Forward draft is gone; status remains unknown.");
    }
    const revision = await new EmailForwardDraftModule().findRevisionByPayloadHash(
      draft.id,
      operation.payloadHash
    );
    if (!revision) {
      return this.failedResult("OUTCOME_UNKNOWN", "The frozen forward revision is gone; status remains unknown.");
    }

    const receiveConfig = await this.resolveReceiveConfig(revision.sendingAccountId);
    if (!receiveConfig) {
      return this.failedResult("ACCOUNT_NOT_AVAILABLE", "Sending account receive configuration is unavailable.");
    }
    const listing = await this.adapter.listFolders(receiveConfig);
    if (listing.status !== "listed") {
      return this.failedResult("ACCOUNT_NOT_AVAILABLE", "Sent folder discovery failed; status remains unknown.");
    }
    const sentFolder = listing.folders.find((folder) => folder.specialUse === "\\Sent")?.path;
    if (sentFolder === undefined) {
      // No discoverable Sent folder: absence of a copy is not evidence of
      // non-delivery — leave the honest unknown.
      return await this.projectResult(operationId);
    }
    const search = await this.adapter.searchUids(receiveConfig, sentFolder, {
      messageIdHeader: revision.composedMessageId,
      cap: 5,
    });
    if (search.status !== "listed") {
      return this.failedResult("ACCOUNT_NOT_AVAILABLE", "Sent search failed; status remains unknown.");
    }
    const sentCopyFound = search.candidates.length > 0;

    for (const item of unresolved) {
      // Accepted envelope recipients recorded at submit time (SMTP truth).
      const accepted = parseStringArrayJson(item.acceptedRecipientsJson);
      const rejected = parseStringArrayJson(item.rejectedRecipientsJson);
      const unknownRecipients = parseStringArrayJson(item.unknownRecipientsJson);
      if (!sentCopyFound || accepted.length === 0) {
        // A missing Sent copy is never proof of non-delivery (design §10.3).
        await this.operationModule.finalizeItem({
          itemId: item.id,
          operationId,
          status: "outcome_unknown",
          errorCode: "OUTCOME_UNKNOWN",
          sanitizedError: "No durable SMTP/Sent evidence of delivery; manual resolution required.",
        });
        continue;
      }
      const outcome: "succeeded" | "partially_succeeded" =
        rejected.length === 0 && unknownRecipients.length === 0
          ? "succeeded"
          : "partially_succeeded";
      await this.operationModule.finalizeItem({
        itemId: item.id,
        operationId,
        status: outcome,
        resultJson: JSON.stringify({
          reconciled: true,
          reconciledFrom: "sent_copy_evidence",
          sentCopyFound: true,
        }),
      });
      await this.operationModule.recordAudit({
        operationId,
        itemId: item.id,
        messageId: item.messageId,
        emailServiceId: operation.emailServiceId,
        action: "forward_reconciled_from_sent_evidence",
        status: outcome,
        detail: { sentFolder },
      });
    }
    return await this.projectResult(operationId);
  }

  private async reconcileOperationInternal(
    operation: EmailOrganizationOperationEntity,
    operationId: string
  ): Promise<MailboxActionOutcome> {
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
      // R04: use the FULL saved locator mapping (uid + uidValidity), never
      // just the destination uid.
      const mappingEvidence = attemptRows
        .map((attempt) => attempt.resultJson)
        .filter((json): json is string => json !== null)
        .map((json) => {
          try {
            return JSON.parse(json) as {
              destinationUid?: string | null;
              destinationUidValidity?: string | null;
            };
          } catch {
            return null;
          }
        })
        .find(
          (parsed) =>
            parsed !== null &&
            typeof parsed.destinationUid === "string" &&
            typeof parsed.destinationUidValidity === "string"
        );

      if (presence.status === "absent" && mappingEvidence && item.destinationFolderPath !== null) {
        // Design §10.3 + R04: source absent + a strongly verified destination
        // mapping reconciles only when the mapped destination is PRESENT on
        // the server right now; otherwise the outcome stays unknown.
        const destinationPresence = await this.adapter.checkMessagePresent(receiveConfig, {
          folderPath: item.destinationFolderPath,
          uidValidity: mappingEvidence.destinationUidValidity as string,
          uid: mappingEvidence.destinationUid as string,
        });
        if (destinationPresence.status !== "present") {
          await this.operationModule.finalizeItem({
            itemId: item.id,
            operationId,
            status: "outcome_unknown",
            errorCode: "OUTCOME_UNKNOWN",
            sanitizedError:
              "Source empty but the mapped destination is not verifiable on the server; manual resolution required.",
          });
          continue;
        }
        // T04: crash after applyMove but before item finalization leaves the
        // location at version v+1 pointing at the exact destination — the
        // before-version CAS can never succeed again. Accept an
        // already-applied locator with matching lineage as idempotent
        // success instead of looping on LOCAL_COMMIT_PENDING forever.
        const currentRow = await this.locationModule.readByMessageId(item.messageId);
        const alreadyApplied =
          currentRow !== null &&
          currentRow.folderPath === item.destinationFolderPath &&
          currentRow.providerUid === (mappingEvidence.destinationUid as string) &&
          currentRow.uidValidity === (mappingEvidence.destinationUidValidity as string) &&
          currentRow.lastOperationId === operationId;
        if (alreadyApplied) {
          await this.operationModule.finalizeItem({
            itemId: item.id,
            operationId,
            status: "succeeded",
            resultJson: JSON.stringify({
              reconciled: true,
              idempotentLocalRepair: true,
              destinationFolder: item.destinationFolderPath,
            }),
          });
          // R4-02: every successful repair path invalidates pending replies —
          // the location changed, so old approvals must not send. R5-04: the
          // retry also resolves the durable obligation on success.
          await this.invalidateRepliesForMove(
            item.messageId,
            item.destinationFolderPath ?? "Trash",
            item.id,
            operationId,
            operation.emailServiceId
          );
          await this.operationModule.recordAudit({
            operationId,
            itemId: item.id,
            messageId: item.messageId,
            emailServiceId: operation.emailServiceId,
            action: "reconciled_move",
            status: "succeeded",
            detail: { idempotentLocalRepair: true, destinationFolder: item.destinationFolderPath },
          });
          continue;
        }
        const applyOk = await this.locationModule.applyMove({
          messageId: item.messageId,
          expectedVersion: item.beforeLocationVersion ?? 0,
          folderPath: item.destinationFolderPath,
          uidValidity: mappingEvidence.destinationUidValidity as string,
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
        // R4-02: reconcile-side reply invalidation (same as ordinary MOVE).
        await this.invalidateRepliesForMove(
          item.messageId,
          item.destinationFolderPath,
          item.id,
          operationId,
          operation.emailServiceId
        );
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
        // R5-04: `failed` requires PROOF the command never reached the
        // server. A dispatched attempt whose message is still at source may
        // still be completing server-side — it stays unknown until a later
        // observation. Only an attempt that was never dispatched (claimed,
        // no dispatch marker) is proven non-dispatch.
        const attempts = await this.operationModule.listAttemptsForItem(item.id);
        const wasDispatched = attempts.some((attempt) => attempt.phase === "dispatched");
        if (wasDispatched) {
          await this.operationModule.finalizeItem({
            itemId: item.id,
            operationId,
            status: "outcome_unknown",
            errorCode: "OUTCOME_UNKNOWN",
            sanitizedError: "Move was dispatched but the message is still at source; a later observation decides.",
          });
        } else {
          await this.operationModule.finalizeItem({
            itemId: item.id,
            operationId,
            status: "failed",
            errorCode: "NETWORK_BEFORE_DISPATCH",
            sanitizedError: "Message still at source and no dispatch evidence; the move did not run.",
          });
        }
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

  /**
   * R5-05: the Trash destination is ALWAYS resolved by the capability
   * service — exactly one writable special-use \\Trash folder, else null
   * (read-only Trash, ambiguity and POP3 all refuse). There is no second
   * resolver that could bypass the writable check.
   */
  private async resolveTrashFolder(emailServiceId: number): Promise<string | null> {
    const capabilities = await this.capabilityService.getCapabilities(emailServiceId);
    return capabilities.trashFolderPath;
  }

  private async resolveReceiveConfig(
    emailServiceId: number
  ): Promise<EmailReceiveConnectionConfig | null> {
    return await this.capabilityService.getReceiveConfig(emailServiceId);
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
