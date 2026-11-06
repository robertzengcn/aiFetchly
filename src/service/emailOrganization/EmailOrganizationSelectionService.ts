import crypto from "crypto";
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { BaseModule } from "@/modules/baseModule";
import { EmailOrganizationSelectionModel } from "@/model/EmailOrganizationSelection.model";
import { EmailOrganizationSelectionEntity } from "@/entity/EmailOrganizationSelection.entity";
import { EmailMessageLocationModule } from "@/modules/EmailMessageLocationModule";
import { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import { EmailOrganizationOperationModule } from "@/modules/EmailOrganizationOperationModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailOrganizationActionError } from "@/service/emailOrganization/EmailOrganizationErrors";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";
import { log } from "@/modules/Logger";

/**
 * Frozen bulk selections (PRD FR-18, design §11): an expiring, immutable set
 * of exact message ids + location versions on ONE account, at most 100
 * items. A search result alone is never an authorization — the frozen
 * selection is what a bulk action consumes.
 */

export const emailOrganizationSelectionWriteSchema = lazySchema(() =>
  z.object({
    selectionId: z.string().min(8).max(64),
    emailServiceId: z.number().int().positive(),
    kind: z.enum(["trash", "restore"]),
    messageIdsJson: z.string(),
    locationVersionsJson: z.string(),
    destinationsJson: z.string().nullable().optional(),
    payloadHash: z.string().length(64),
    filtersSummaryJson: z.string().nullable().optional(),
    ownerContext: z.string().max(255).nullable().optional(),
    expiresAt: z.coerce.date(),
  })
);

export interface PrepareSelectionInput {
  readonly emailServiceId: number;
  readonly kind: "trash" | "restore";
  /** Exact message ids from trusted search/UI context. Duplicates removed. */
  readonly messageIds: readonly number[];
  /** Search filter/coverage summary persisted for the preview/audit. */
  readonly filtersSummary?: Record<string, unknown>;
  readonly ownerContext?: string | null;
}

export interface SelectionPreviewItem {
  readonly messageId: number;
  readonly subject: string;
  readonly fromAddress: string;
  readonly currentFolderPath: string | null;
  readonly destinationFolderPath: string | null;
}

export interface SelectionPreview {
  readonly selectionId: string;
  readonly kind: "trash" | "restore";
  readonly emailServiceId: number;
  readonly count: number;
  readonly payloadHash: string;
  readonly expiresAt: string;
  readonly filtersSummary: Record<string, unknown> | null;
  /** R13: the authoritative frozen set, resolved for inspection. */
  readonly items: readonly SelectionPreviewItem[];
}

const SELECTION_TTL_MS = EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs;

export class EmailOrganizationSelectionService extends BaseModule {
  private readonly selectionModel: EmailOrganizationSelectionModel;
  private readonly locationModule: EmailMessageLocationModule;
  private readonly capabilityService: EmailOrganizationCapabilityService;
  private readonly operationModule: EmailOrganizationOperationModule;
  private readonly messageModule: EmailReceivedMessageModule;

  constructor(options?: { capabilityService?: EmailOrganizationCapabilityService }) {
    super();
    this.selectionModel = new EmailOrganizationSelectionModel(this.dbpath);
    this.locationModule = new EmailMessageLocationModule();
    this.operationModule = new EmailOrganizationOperationModule();
    this.messageModule = new EmailReceivedMessageModule();
    this.capabilityService =
      options?.capabilityService ?? new EmailOrganizationCapabilityService();
  }

  /**
   * Freezes the exact set: dedupes ids, resolves each message's current
   * verified location version, and persists the hash-bound row. Locations
   * are revalidated per-item at execution time; the freeze pins what the
   * user approved.
   */
  async prepareSelection(input: PrepareSelectionInput): Promise<SelectionPreview> {
    await this.ensureConnection();
    const uniqueIds = Array.from(new Set(input.messageIds)).sort((a, b) => a - b);
    if (uniqueIds.length === 0) {
      throw new EmailOrganizationActionError(
        "VALIDATION_FAILED",
        "A selection requires at least one message.",
        false
      );
    }
    if (uniqueIds.length > 100) {
      // PRD §7: larger requests are split into separately visible selections.
      throw new EmailOrganizationActionError(
        "VALIDATION_FAILED",
        `A bulk action contains at most 100 messages (got ${uniqueIds.length}); split the request into separate visible selections.`,
        false
      );
    }
    // One account only (PRD §7 bulk mutation limit).
    const locations = await this.locationModule.readByMessageIds(uniqueIds);
    const byMessageId = new Map(locations.map((row) => [row.messageId, row]));
    const versions: Record<number, number> = {};
    for (const messageId of uniqueIds) {
      const location = byMessageId.get(messageId);
      if (!location || location.emailServiceId !== input.emailServiceId) {
        throw new EmailOrganizationActionError(
          "SOURCE_NOT_FOUND",
          `Message ${messageId} does not belong to account ${input.emailServiceId}.`,
          false
        );
      }
      if (location.state !== "verified") {
        throw new EmailOrganizationActionError(
          "LOCATION_STALE",
          `Message ${messageId} has no verified location; re-sync before selecting.`,
          false
        );
      }
      versions[messageId] = location.version;
    }

    let destinations: Record<number, string> | null = null;
    if (input.kind === "trash") {
      const capabilities = await this.capabilityService.getCapabilities(input.emailServiceId);
      if (capabilities.trashFolderPath === null) {
        throw new EmailOrganizationActionError(
          "TRASH_NOT_CONFIGURED",
          "No Trash folder could be resolved for this account.",
          false
        );
      }
      const trashFolder: string = capabilities.trashFolderPath;
      destinations = Object.fromEntries(uniqueIds.map((id) => [id, trashFolder]));
    } else {
      // Restore destinations freeze at prepare time from durable trash
      // provenance (review S4): never accepted from the caller at execution.
      const recorded = await this.operationModule.findSucceededTrashDestinations(uniqueIds);
      const missing = uniqueIds.filter((id) => recorded[id] === undefined);
      if (missing.length > 0) {
        throw new EmailOrganizationActionError(
          "OPERATION_NOT_FOUND",
          `No successful AiFetchly Trash record for message(s) ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}; restore needs recorded provenance.`,
          false
        );
      }
      destinations = Object.fromEntries(
        uniqueIds.map((id) => [id, recorded[id].folder])
      );
    }

    const payloadHash = crypto
      .createHash("sha256")
      .update(
        `selv1|${input.kind}|${input.emailServiceId}|${uniqueIds.join(",")}|${uniqueIds
          .map((id) => versions[id])
          .join(",")}|${destinations ? Object.values(destinations).join(",") : ""}`
      )
      .digest("hex");

    const filtersSummaryJson = input.filtersSummary
      ? JSON.stringify(input.filtersSummary)
      : null;
    if (filtersSummaryJson !== null && filtersSummaryJson.length > 4096) {
      // Review: bound the persisted coverage summary (unbounded JSON writes).
      throw new EmailOrganizationActionError(
        "VALIDATION_FAILED",
        "The filters summary exceeds 4 KiB; send a compact provenance summary.",
        false
      );
    }
    const entity = await this.selectionModel.create({
      selectionId: crypto.randomUUID() as string,
      emailServiceId: input.emailServiceId,
      kind: input.kind,
      messageIdsJson: JSON.stringify(uniqueIds),
      locationVersionsJson: JSON.stringify(versions),
      destinationsJson: destinations ? JSON.stringify(destinations) : null,
      payloadHash,
      filtersSummaryJson,
      ownerContext: input.ownerContext ?? null,
      expiresAt: new Date(Date.now() + SELECTION_TTL_MS),
    });
    log.info(
      `[EmailOrganizationSelectionService] selection ${entity.selectionId} frozen: ${uniqueIds.length} message(s), kind=${input.kind}`
    );
    return await this.toPreview(entity);
  }

  /** Loads a selection and enforces expiry. Expired selections are dead. */
  async readValidSelection(
    selectionId: string
  ): Promise<EmailOrganizationSelectionEntity> {
    await this.ensureConnection();
    const entity = await this.selectionModel.read(selectionId);
    if (!entity) {
      throw new EmailOrganizationActionError(
        "OPERATION_NOT_FOUND",
        "Selection not found.",
        false
      );
    }
    if (entity.expiresAt.getTime() <= Date.now()) {
      throw new EmailOrganizationActionError(
        "APPROVAL_EXPIRED",
        "The selection expired; prepare it again from the current mailbox state.",
        false
      );
    }
    return entity;
  }

  parseSelection(entity: EmailOrganizationSelectionEntity): {
    messageIds: number[];
    versions: Record<number, number>;
    destinations: Record<number, string> | null;
  } {
    const messageIds = JSON.parse(entity.messageIdsJson) as number[];
    const versions = JSON.parse(entity.locationVersionsJson) as Record<number, number>;
    const destinations = entity.destinationsJson
      ? (JSON.parse(entity.destinationsJson) as Record<number, string>)
      : null;
    return { messageIds, versions, destinations };
  }

  /** Retention: purge expired selections (called from the startup sweep). */
  async purgeExpired(): Promise<number> {
    await this.ensureConnection();
    const model = new EmailOrganizationSelectionModel(this.dbpath);
    return await model.purgeExpiredSelections(new Date());
  }

  private async toPreview(
    entity: EmailOrganizationSelectionEntity
  ): Promise<SelectionPreview> {
    const messageIds = JSON.parse(entity.messageIdsJson) as number[];
    const destinations = entity.destinationsJson
      ? (JSON.parse(entity.destinationsJson) as Record<number, string>)
      : null;
    const messages = await this.messageModule.readByIds(messageIds);
    const locations = await this.locationModule.readByMessageIds(messageIds);
    const locationByMessageId = new Map(locations.map((row) => [row.messageId, row]));
    return {
      selectionId: entity.selectionId,
      kind: entity.kind,
      emailServiceId: entity.emailServiceId,
      count: messageIds.length,
      payloadHash: entity.payloadHash,
      expiresAt: entity.expiresAt.toISOString(),
      filtersSummary: entity.filtersSummaryJson
        ? (JSON.parse(entity.filtersSummaryJson) as Record<string, unknown>)
        : null,
      items: messageIds.map((messageId) => {
        const message = messages.find((row) => row.id === messageId);
        const location = locationByMessageId.get(messageId);
        return {
          messageId,
          subject: message?.subject ?? "(unavailable)",
          fromAddress: message?.fromAddress ?? "",
          currentFolderPath: location?.folderPath ?? null,
          destinationFolderPath: destinations?.[messageId] ?? null,
        };
      }),
    };
  }
}

