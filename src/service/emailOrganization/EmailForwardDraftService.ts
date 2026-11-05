import { log } from "@/modules/Logger";
import { parseStringArrayJson } from "@/utils/jsonArray";
import { BaseModule } from "@/modules/baseModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailMessageLocationModule } from "@/modules/EmailMessageLocationModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailForwardDraftModule } from "@/modules/EmailForwardDraftModule";
import { EmailOrganizationAuthorizationModule } from "@/modules/EmailOrganizationAuthorizationModule";
import type {
  EmailForwardAttachmentManifestEntry,
  EmailForwardAttachmentSelection,
  EmailOrganizationOrigin,
} from "@/entityTypes/emailOrganizationTypes";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";
import type { EmailMailboxAdapter } from "@/service/emailOrganization/EmailMailboxAdapter";
import { ImapEmailMailboxAdapter } from "@/service/emailOrganization/ImapEmailMailboxAdapter";
import { EmailOrganizationArtifactStore, type EmailOrganizationArtifactBackend } from "@/service/emailOrganization/EmailOrganizationArtifactStore";
import { EmailForwardMaterializer } from "@/service/emailOrganization/EmailForwardMaterializer";
import {
  EmailOrganizationActionError,
} from "@/service/emailOrganization/EmailOrganizationErrors";
import {
  buildEnvelopeRecipients,
  ensureFwdPrefix,
  generateForwardMessageId,
  hashForwardEnvelope,
  isValidEmailAddress,
} from "@/service/emailOrganization/EmailForwardEnvelopeHasher";

/**
 * Forward draft orchestration (technical design §6.1, §9.1). Creating or
 * editing a draft materializes the complete source (fresh fetch), freezes a
 * write-once revision, and never touches reply/processed state on the
 * source message (invariant 10, PRD FR-10).
 */

export interface CreateForwardDraftInput {
  /** R14: UI locale for generated header labels (default en). */
  readonly locale?: string | null;
  readonly messageId: number;
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly note?: string | null;
  readonly subject?: string | null;
  readonly attachmentSelection: EmailForwardAttachmentSelection;
  readonly senderServiceId?: number | null;
  readonly provenance: "ai" | "user";
  readonly conversationId?: number | null;
  readonly origin: EmailOrganizationOrigin;
}

export interface ForwardDraftPreview {
  readonly draftId: number;
  readonly revisionId: number;
  readonly revisionNumber: number;
  readonly messageId: number;
  readonly sourceEmailServiceId: number;
  readonly sendingAccountId: number;
  readonly fromName: string | null;
  readonly fromAddress: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  /** R11: private review can inspect Bcc (envelope-only, never forwarded headers). */
  readonly bcc: readonly string[];
  readonly subject: string;
  readonly note: string | null;
  readonly attachmentManifest: readonly EmailForwardAttachmentManifestEntry[];
  readonly selectedAttachmentCount: number;
  readonly selectedAttachmentBytes: number;
  readonly bodyPreviewText: string;
  readonly validationFindings: readonly string[];
  readonly composedHash: string;
  readonly composedMessageId: string;
  readonly expiresAt: string;
  readonly expired: boolean;
}

const UNAPPROVED_ARTIFACT_TTL_MS = EMAIL_ORGANIZATION_LIMITS.unapprovedArtifactTtlMs;

export class EmailForwardDraftService extends BaseModule {
  private readonly messageModule: EmailReceivedMessageModule;
  private readonly locationModule: EmailMessageLocationModule;
  private readonly serviceModule: EmailServiceModule;
  private readonly draftModule: EmailForwardDraftModule;
  private readonly authorizationModule: EmailOrganizationAuthorizationModule;
  private readonly adapter: EmailMailboxAdapter;
  private readonly artifactStore: EmailOrganizationArtifactBackend;
  private readonly materializer: EmailForwardMaterializer;

  constructor(options?: { adapter?: EmailMailboxAdapter; artifactStore?: EmailOrganizationArtifactBackend }) {
    super();
    this.messageModule = new EmailReceivedMessageModule();
    this.locationModule = new EmailMessageLocationModule();
    this.serviceModule = new EmailServiceModule();
    this.draftModule = new EmailForwardDraftModule();
    this.authorizationModule = new EmailOrganizationAuthorizationModule();
    this.adapter = options?.adapter ?? new ImapEmailMailboxAdapter();
    this.artifactStore =
      options?.artifactStore ?? new EmailOrganizationArtifactStore(this.dbpath || ".");
    this.materializer = new EmailForwardMaterializer({
      adapter: this.adapter,
      artifactStore: this.artifactStore,
    });
  }

  async createDraft(input: CreateForwardDraftInput): Promise<ForwardDraftPreview> {
    await this.ensureConnection();
    const normalized = this.normalizeAndValidateRecipients(input.to, input.cc, input.bcc);
    const message = await this.messageModule.read(input.messageId);
    if (!message) {
      throw new EmailOrganizationActionError("SOURCE_NOT_FOUND", "Message not found.", false);
    }
    const sourceAccountId = message.emailServiceId;
    const location = await this.locationModule.readByMessageId(message.id);
    this.assertVerifiedLocation(location);

    const sending = await this.resolveSendingIdentity(input.senderServiceId, sourceAccountId);
    const receiveConfig = await this.serviceModule.getEmailServiceReceiveConfig(sourceAccountId);
    if (!receiveConfig) {
      throw new EmailOrganizationActionError(
        "ACCOUNT_NOT_AVAILABLE",
        "Source account receive configuration is unavailable.",
        false
      );
    }

    const subject = input.subject && input.subject.trim() !== ""
      ? input.subject.trim()
      : ensureFwdPrefix(message.subject);
    const materialized = await this.materializer.materialize({
      sourceMessageId: message.id,
      location: {
        folderPath: location?.folderPath ?? "",
        uidValidity: location?.uidValidity ?? "",
        uid: location?.providerUid ?? "",
      },
      receiveConfig,
      locale: input.locale ?? undefined,
      note: input.note ?? null,
      toRecipients: normalized.to,
      ccRecipients: normalized.cc,
      bccRecipients: normalized.bcc,
      subject,
      attachmentSelection: input.attachmentSelection,
    });

    const expiresAt = new Date(Date.now() + UNAPPROVED_ARTIFACT_TTL_MS);
    const composedMessageId = generateForwardMessageId();
    const composedHash = hashForwardEnvelope({
      sendingAccountId: sending.id,
      fromAddress: sending.fromAddress,
      fromName: sending.fromName,
      replyToAddress: sending.replyToAddress,
      smtpUsername: sending.smtpUsername,
      toRecipients: normalized.to,
      ccRecipients: normalized.cc,
      bccRecipients: normalized.bcc,
      subject,
      note: input.note ?? null,
      bodyTextHash: materialized.bodyTextHash,
      bodyHtmlHash: materialized.bodyHtmlHash,
      attachments: materialized.attachments,
      composedMessageId,
      sourceLocationSnapshotJson: materialized.sourceLocationSnapshotJson,
      sourceFullSourceHash: materialized.sourceFullSourceHash,
    });

    const created = await this.draftModule.createDraftWithRevision(
      {
        messageId: message.id,
        emailServiceId: sourceAccountId,
        status: "ready",
        currentRevisionId: null,
        conversationId: input.conversationId ?? null,
        provenance: input.provenance,
        submittedAt: null,
      },
      {
        draftId: 0,
        revisionNumber: 1,
        sourceLocationSnapshotJson: materialized.sourceLocationSnapshotJson,
        sourceFullSourceHash: materialized.sourceFullSourceHash,
        fromName: sending.fromName,
        fromAddress: sending.fromAddress,
        replyToAddress: sending.replyToAddress,
        smtpUsername: sending.smtpUsername,
        sendingAccountId: sending.id,
        toRecipientsJson: JSON.stringify(normalized.to),
        ccRecipientsJson: JSON.stringify(normalized.cc),
        bccRecipientsJson: JSON.stringify(normalized.bcc),
        envelopeRecipientsJson: JSON.stringify(
          buildEnvelopeRecipients(normalized.to, normalized.cc, normalized.bcc)
        ),
        subject,
        note: input.note ?? null,
        bodyTextArtifactId: materialized.bodyTextArtifactId,
        bodyHtmlArtifactId: materialized.bodyHtmlArtifactId,
        bodyTextHash: materialized.bodyTextHash,
        bodyHtmlHash: materialized.bodyHtmlHash,
        attachmentsJson: JSON.stringify(materialized.attachments),
        composedMessageId,
        composedHash,
        composedByteCount: null,
        validationFindingsJson: JSON.stringify(materialized.validationFindings),
        expiresAt,
      },
      1
    );

    log.info(
      `[EmailForwardDraftService] draft ${created.draft.id} created for message ${message.id} ` +
        `(attachments: ${materialized.selectedAttachmentCount} selected)`
    );
    return this.toPreview(created.draft, created.revision);
  }

  async updateDraft(input: {
    draftId: number;
    expectedRevisionId: number;
    to?: readonly string[];
    cc?: readonly string[];
    bcc?: readonly string[];
    note?: string | null;
    subject?: string | null;
    attachmentSelection?: EmailForwardAttachmentSelection;
  }): Promise<ForwardDraftPreview> {
    await this.ensureConnection();
    const draft = await this.draftModule.readDraft(input.draftId);
    if (!draft) {
      throw new EmailOrganizationActionError("SOURCE_NOT_FOUND", "Draft not found.", false);
    }
    if (draft.status !== "draft" && draft.status !== "ready") {
      throw new EmailOrganizationActionError(
        "REVISION_CHANGED",
        "Draft is no longer editable.",
        false
      );
    }
    const currentRevision = await this.draftModule.readRevision(
      draft.currentRevisionId ?? 0
    );
    if (!currentRevision || currentRevision.id !== input.expectedRevisionId) {
      throw new EmailOrganizationActionError(
        "REVISION_CHANGED",
        "The draft changed since it was loaded; reload and retry.",
        false
      );
    }

    const to = input.to ?? parseStringArrayJson(currentRevision.toRecipientsJson);
    const cc = input.cc ?? parseStringArrayJson(currentRevision.ccRecipientsJson);
    const bcc = input.bcc ?? parseStringArrayJson(currentRevision.bccRecipientsJson);
    const normalized = this.normalizeAndValidateRecipients(to, cc, bcc);
    const subject = input.subject && input.subject.trim() !== ""
      ? input.subject.trim()
      : currentRevision.subject;
    const note = input.note !== undefined ? input.note : currentRevision.note;
    const selection = input.attachmentSelection ?? this.selectionFromManifest(
      JSON.parse(currentRevision.attachmentsJson) as EmailForwardAttachmentManifestEntry[]
    );

    const message = await this.messageModule.read(draft.messageId);
    if (!message) {
      throw new EmailOrganizationActionError("SOURCE_NOT_FOUND", "Source message not found.", false);
    }
    const location = await this.locationModule.readByMessageId(message.id);
    this.assertVerifiedLocation(location);
    const receiveConfig = await this.serviceModule.getEmailServiceReceiveConfig(
      message.emailServiceId
    );
    if (!receiveConfig) {
      throw new EmailOrganizationActionError(
        "ACCOUNT_NOT_AVAILABLE",
        "Source account receive configuration is unavailable.",
        false
      );
    }

    const materialized = await this.materializer.materialize({
      sourceMessageId: message.id,
      location: {
        folderPath: location?.folderPath ?? "",
        uidValidity: location?.uidValidity ?? "",
        uid: location?.providerUid ?? "",
      },
      receiveConfig,
      note,
      toRecipients: normalized.to,
      ccRecipients: normalized.cc,
      bccRecipients: normalized.bcc,
      subject,
      attachmentSelection: selection,
    });

    const expiresAt = new Date(Date.now() + UNAPPROVED_ARTIFACT_TTL_MS);
    const composedMessageId = generateForwardMessageId();
    const composedHash = hashForwardEnvelope({
      sendingAccountId: currentRevision.sendingAccountId,
      fromAddress: currentRevision.fromAddress,
      fromName: currentRevision.fromName,
      replyToAddress: currentRevision.replyToAddress,
      smtpUsername: currentRevision.smtpUsername,
      toRecipients: normalized.to,
      ccRecipients: normalized.cc,
      bccRecipients: normalized.bcc,
      subject,
      note,
      bodyTextHash: materialized.bodyTextHash,
      bodyHtmlHash: materialized.bodyHtmlHash,
      attachments: materialized.attachments,
      composedMessageId,
      sourceLocationSnapshotJson: materialized.sourceLocationSnapshotJson,
      sourceFullSourceHash: materialized.sourceFullSourceHash,
    });

    const appended = await this.draftModule.appendRevision(
      draft.id,
      currentRevision.id,
      {
        sourceLocationSnapshotJson: materialized.sourceLocationSnapshotJson,
        sourceFullSourceHash: materialized.sourceFullSourceHash,
        fromName: currentRevision.fromName,
        fromAddress: currentRevision.fromAddress,
        replyToAddress: currentRevision.replyToAddress,
        smtpUsername: currentRevision.smtpUsername,
        sendingAccountId: currentRevision.sendingAccountId,
        toRecipientsJson: JSON.stringify(normalized.to),
        ccRecipientsJson: JSON.stringify(normalized.cc),
        bccRecipientsJson: JSON.stringify(normalized.bcc),
        envelopeRecipientsJson: JSON.stringify(
          buildEnvelopeRecipients(normalized.to, normalized.cc, normalized.bcc)
        ),
        subject,
        note,
        bodyTextArtifactId: materialized.bodyTextArtifactId,
        bodyHtmlArtifactId: materialized.bodyHtmlArtifactId,
        bodyTextHash: materialized.bodyTextHash,
        bodyHtmlHash: materialized.bodyHtmlHash,
        attachmentsJson: JSON.stringify(materialized.attachments),
        composedMessageId,
        composedHash,
        composedByteCount: null,
        validationFindingsJson: JSON.stringify(materialized.validationFindings),
        expiresAt,
      }
    );
    if (!appended.ok) {
      throw new EmailOrganizationActionError(
        "REVISION_CHANGED",
        "The draft changed concurrently; reload and retry.",
        false
      );
    }
    // Any committed edit invalidates prior authorizations (design §6.1) —
    // only AFTER the new revision durably exists, so a failed edit (network
    // blip during materialization) leaves existing approvals intact.
    await this.authorizationModule.revokeAllForDraft(
      draft.id,
      "draft edited; new revision created",
      new Date()
    );
    const refreshedDraft = await this.draftModule.readDraft(draft.id);
    if (!refreshedDraft) {
      throw new EmailOrganizationActionError("SOURCE_NOT_FOUND", "Draft vanished.", false);
    }
    return this.toPreview(refreshedDraft, appended.revision);
  }

  async readDraftDetail(draftId: number): Promise<ForwardDraftPreview> {
    await this.ensureConnection();
    const draft = await this.draftModule.readDraft(draftId);
    if (!draft) {
      throw new EmailOrganizationActionError("SOURCE_NOT_FOUND", "Draft not found.", false);
    }
    const revision = draft.currentRevisionId
      ? await this.draftModule.readRevision(draft.currentRevisionId)
      : null;
    if (!revision) {
      throw new EmailOrganizationActionError("SOURCE_NOT_FOUND", "Draft revision missing.", false);
    }
    return this.toPreview(draft, revision);
  }

  async discardDraft(draftId: number): Promise<void> {
    await this.ensureConnection();
    const draft = await this.draftModule.readDraft(draftId);
    if (!draft) return;
    const revision = draft.currentRevisionId
      ? await this.draftModule.readRevision(draft.currentRevisionId)
      : null;
    const discarded = await this.draftModule.markDiscarded(draftId);
    if (!discarded) {
      // A concurrent submit won the CAS; leaving approvals intact is correct.
      throw new EmailOrganizationActionError(
        "REVISION_CHANGED",
        "The draft was submitted concurrently and can no longer be discarded.",
        false
      );
    }
    await this.authorizationModule.revokeAllForDraft(draftId, "draft discarded", new Date());
    // R17: retention hygiene purges artifacts of ALL revisions (editing
    // produces prior revisions whose bytes are also dead weight).
    const allRevisions = await this.draftModule.listRevisionsForPurge(draftId);
    const artifactIds: string[] = [];
    for (const rev of allRevisions) {
      if (rev.bodyTextArtifactId !== null) artifactIds.push(rev.bodyTextArtifactId);
      if (rev.bodyHtmlArtifactId !== null) artifactIds.push(rev.bodyHtmlArtifactId);
      artifactIds.push(
        ...parseAttachmentArtifactIds(rev.attachmentsJson).filter(
          (id): id is string => id !== null
        )
      );
    }
    for (const artifactId of artifactIds.filter((id): id is string => id !== null)) {
      await this.artifactStore.purge(artifactId).catch(() => {
        // best-effort; the retention sweep is the backstop
      });
    }
  }

  private assertVerifiedLocation(
    location: Awaited<ReturnType<EmailMessageLocationModule["readByMessageId"]>>
  ): void {
    if (!location) {
      throw new EmailOrganizationActionError(
        "SOURCE_NOT_FOUND",
        "Message has no recorded location; re-sync the mailbox first.",
        false
      );
    }
    if (location.protocol !== "imap") {
      throw new EmailOrganizationActionError(
        "CAPABILITY_UNSUPPORTED",
        "Forwarding requires an IMAP account; POP3 sources are not supported yet.",
        false
      );
    }
    if (location.state !== "verified") {
      throw new EmailOrganizationActionError(
        "LOCATION_STALE",
        "Message location is not verified; re-sync before forwarding.",
        false
      );
    }
    if (location.folderPath === null || location.uidValidity === null) {
      throw new EmailOrganizationActionError(
        "LOCATION_STALE",
        "Message location identity is incomplete.",
        false
      );
    }
  }

  private async resolveSendingIdentity(
    senderServiceId: number | null | undefined,
    sourceAccountId: number
  ): Promise<{
    id: number;
    fromAddress: string;
    fromName: string | null;
    replyToAddress: string | null;
    smtpUsername: string | null;
  }> {
    const accountId = senderServiceId ?? sourceAccountId;
    const service = await this.serviceModule.getEmailService(accountId);
    if (!service || service.status !== 1) {
      throw new EmailOrganizationActionError(
        "ACCOUNT_NOT_AVAILABLE",
        "Sending account is unavailable or inactive.",
        false
      );
    }
    const smtpConfigured =
      typeof service.host === "string" &&
      service.host.trim() !== "" &&
      Number.parseInt(service.port ?? "", 10) > 0;
    if (!smtpConfigured) {
      throw new EmailOrganizationActionError(
        "CAPABILITY_UNSUPPORTED",
        "Sending account has no usable SMTP configuration.",
        false
      );
    }
    return {
      id: service.id,
      fromAddress: service.from,
      fromName: service.name ?? null,
      replyToAddress: service.replyTo ?? null,
      smtpUsername: service.smtpUsername ?? null,
    };
  }

  private normalizeAndValidateRecipients(
    to: readonly string[],
    cc: readonly string[] | undefined,
    bcc: readonly string[] | undefined
  ): { to: string[]; cc: string[]; bcc: string[] } {
    const cleanTo = to.map((address) => address.trim()).filter((address) => address !== "");
    const cleanCc = (cc ?? []).map((address) => address.trim()).filter((address) => address !== "");
    const cleanBcc = (bcc ?? []).map((address) => address.trim()).filter((address) => address !== "");
    // Empty recipients are allowed while drafting (the review dialog is
    // inspectable before recipients are typed); delivery refuses an empty
    // envelope at send time.
    const envelope = buildEnvelopeRecipients(cleanTo, cleanCc, cleanBcc);
    if (envelope.length > EMAIL_ORGANIZATION_LIMITS.maxRecipients) {
      throw new EmailOrganizationActionError(
        "TOO_MANY_RECIPIENTS",
        `A forward supports at most ${EMAIL_ORGANIZATION_LIMITS.maxRecipients} unique recipients.`,
        false
      );
    }
    for (const address of [...cleanTo, ...cleanCc, ...cleanBcc]) {
      if (!isValidEmailAddress(address)) {
        throw new EmailOrganizationActionError(
          "VALIDATION_FAILED",
          `Invalid recipient address: ${address.replace(/@.*/, "@[redacted]")}`,
          false
        );
      }
    }
    return { to: cleanTo, cc: cleanCc, bcc: cleanBcc };
  }

  private selectionFromManifest(
    manifest: readonly EmailForwardAttachmentManifestEntry[]
  ): EmailForwardAttachmentSelection {
    const selected = manifest.filter((entry) => entry.selected).map((entry) => entry.partId);
    if (selected.length === 0) {
      return { mode: "none" };
    }
    return { mode: "parts", partIds: selected };
  }

  private async toPreview(
    draft: Awaited<ReturnType<EmailForwardDraftModule["readDraft"]>>,
    revision: NonNullable<Awaited<ReturnType<EmailForwardDraftModule["readRevision"]>>>
  ): Promise<ForwardDraftPreview> {
    const manifest = JSON.parse(revision.attachmentsJson) as EmailForwardAttachmentManifestEntry[];
    const bodyText = await this.readArtifactText(revision.bodyTextArtifactId);
    const expired =
      revision.expiresAt !== null && revision.expiresAt.getTime() <= Date.now();
    return {
      draftId: draft?.id ?? 0,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      messageId: draft?.messageId ?? 0,
      sourceEmailServiceId: draft?.emailServiceId ?? 0,
      sendingAccountId: revision.sendingAccountId,
      fromName: revision.fromName,
      fromAddress: revision.fromAddress,
      to: parseStringArrayJson(revision.toRecipientsJson),
      cc: parseStringArrayJson(revision.ccRecipientsJson),
      bcc: parseStringArrayJson(revision.bccRecipientsJson),
      subject: revision.subject,
      note: revision.note,
      attachmentManifest: manifest.map((entry) => ({ ...entry, artifactId: null })),
      selectedAttachmentCount: manifest.filter((entry) => entry.selected).length,
      selectedAttachmentBytes: manifest
        .filter((entry) => entry.selected)
        .reduce((sum, entry) => sum + entry.decodedSize, 0),
      bodyPreviewText: expired ? "" : bodyText.slice(0, 4000),
      validationFindings: parseStringArrayJson(revision.validationFindingsJson),
      composedHash: revision.composedHash,
      composedMessageId: revision.composedMessageId,
      expiresAt: revision.expiresAt ? revision.expiresAt.toISOString() : "",
      expired,
    };
  }

  private async readArtifactText(artifactId: string | null): Promise<string> {
    if (artifactId === null) return "";
    try {
      const bytes = await this.artifactStore.get(artifactId);
      return bytes.toString("utf8");
    } catch (error) {
      log.warn(
        `[EmailForwardDraftService] artifact read failed (${artifactId.slice(0, 8)}…):`,
        error instanceof Error ? error.message : String(error)
      );
      return "";
    }
  }
}

function parseAttachmentArtifactIds(attachmentsJson: string): Array<string | null> {
  try {
    const parsed = JSON.parse(attachmentsJson) as Array<{ artifactId: string | null }>;
    return Array.isArray(parsed) ? parsed.map((entry) => entry.artifactId) : [];
  } catch {
    return [];
  }
}
