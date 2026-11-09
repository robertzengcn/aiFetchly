import { log } from "@/modules/Logger";
import { BaseModule } from "@/modules/baseModule";
import { EmailForwardDraftModel } from "@/model/EmailForwardDraft.model";
import { EmailForwardDraftEntity } from "@/entity/EmailForwardDraft.entity";
import { EmailForwardRevisionEntity } from "@/entity/EmailForwardRevision.entity";

/** Strips BaseEntity methods from entity row shapes. */
type DataFields<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: T[K];
};
type DraftInsert = DataFields<
  Omit<EmailForwardDraftEntity, "id" | "createdAt" | "updatedAt">
>;
type RevisionInsert = DataFields<
  Omit<EmailForwardRevisionEntity, "id" | "createdAt" | "updatedAt">
>;
type RevisionAppend = DataFields<
  Omit<
    EmailForwardRevisionEntity,
    "id" | "createdAt" | "updatedAt" | "draftId" | "revisionNumber"
  >
>;

/** Business facade over forward drafts and revisions. */
export class EmailForwardDraftModule extends BaseModule {
  private draftModel: EmailForwardDraftModel;

  constructor() {
    super();
    this.draftModel = new EmailForwardDraftModel(this.dbpath);
  }

  async createDraftWithRevision(
    draft: DraftInsert,
    revision: RevisionInsert,
    expectedRevisionNumber: number
  ): Promise<{ draft: EmailForwardDraftEntity; revision: EmailForwardRevisionEntity }> {
    try {
      await this.ensureConnection();
      return await this.draftModel.createDraftWithRevision(
        draft,
        revision,
        expectedRevisionNumber
      );
    } catch (error) {
      log.error("Error creating forward draft:", error);
      throw error;
    }
  }

  async appendRevision(
    draftId: number,
    expectedCurrentRevisionId: number | null,
    revision: RevisionAppend
  ): Promise<{ ok: true; revision: EmailForwardRevisionEntity } | { ok: false }> {
    try {
      await this.ensureConnection();
      return await this.draftModel.appendRevision(
        draftId,
        expectedCurrentRevisionId,
        revision
      );
    } catch (error) {
      log.error("Error appending forward revision:", error);
      throw error;
    }
  }

  async readDraft(id: number): Promise<EmailForwardDraftEntity | null> {
    try {
      await this.ensureConnection();
      return await this.draftModel.readDraft(id);
    } catch (error) {
      log.error("Error reading forward draft:", error);
      throw error;
    }
  }

  /**
   * R5-08: durable resume anchor — newest still-open draft for a message
   * (survives page remounts and restarts; terminal states never match).
   */
  async findOpenDraftForMessage(messageId: number): Promise<EmailForwardDraftEntity | null> {
    try {
      await this.ensureConnection();
      return await this.draftModel.findOpenDraftForMessage(messageId);
    } catch (error) {
      log.error("Error finding open draft for message:", error);
      throw error;
    }
  }

  async readRevision(id: number): Promise<EmailForwardRevisionEntity | null> {
    try {
      await this.ensureConnection();
      return await this.draftModel.readRevision(id);
    } catch (error) {
      log.error("Error reading forward revision:", error);
      throw error;
    }
  }

  async listRevisionsForPurge(
    draftId: number
  ): Promise<Array<{ bodyTextArtifactId: string | null; bodyHtmlArtifactId: string | null; attachmentsJson: string }>> {
    try {
      await this.ensureConnection();
      return await this.draftModel.listRevisionsForPurge(draftId);
    } catch (error) {
      log.error("Error listing revisions for purge:", error);
      throw error;
    }
  }

  /** R4-01: atomic ready→dispatching fence (edits/discard refuse while set). */
  async markDispatching(draftId: number, revisionId: number): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.draftModel.markDispatching(draftId, revisionId);
    } catch (error) {
      log.error("Error marking draft dispatching:", error);
      throw error;
    }
  }

  /** R5-02: revision bound to an operation's payload hash (reconcile input). */
  async findRevisionByPayloadHash(
    draftId: number,
    composedHash: string
  ): Promise<EmailForwardRevisionEntity | null> {
    try {
      await this.ensureConnection();
      return await this.draftModel.findRevisionByPayloadHash(draftId, composedHash);
    } catch (error) {
      log.error("Error finding revision by payload hash:", error);
      throw error;
    }
  }

  /** R4-01: returns a pre-SMTP-fenced draft to ready. */
  async releaseDispatching(draftId: number, revisionId: number): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.draftModel.releaseDispatching(draftId, revisionId);
    } catch (error) {
      log.error("Error releasing draft dispatching:", error);
      throw error;
    }
  }

  /**
   * R5-01: all recipients rejected — release the fence into the editable
   * `failed` state (delivery is definitively not going to happen).
   */
  async markSendFailed(draftId: number, revisionId: number): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.draftModel.markSendFailed(draftId, revisionId);
    } catch (error) {
      log.error("Error marking forward draft send-failed:", error);
      throw error;
    }
  }

  /**
   * R5-01 last-resort fence exit when the CAS transitions above all lose on
   * a draft we still fence; never strands the draft in `dispatching`.
   */
  async forceTerminalFromDispatching(
    draftId: number,
    terminal: "submitted" | "failed"
  ): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.draftModel.forceTerminalFromDispatching(draftId, terminal);
    } catch (error) {
      log.error("Error forcing draft terminal state:", error);
      throw error;
    }
  }

  async markSubmitted(draftId: number, revisionId: number): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.draftModel.markSubmitted(draftId, revisionId);
    } catch (error) {
      log.error("Error marking forward draft submitted:", error);
      throw error;
    }
  }

  async markDiscarded(draftId: number): Promise<boolean> {
    try {
      await this.ensureConnection();
      return await this.draftModel.markDiscarded(draftId);
    } catch (error) {
      log.error("Error discarding forward draft:", error);
      throw error;
    }
  }
}
