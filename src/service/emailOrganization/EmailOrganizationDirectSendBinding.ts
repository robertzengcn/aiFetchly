import { parseStringArrayJson } from "@/utils/jsonArray";
import type { EmailForwardDraftEntity } from "@/entity/EmailForwardDraft.entity";
import type { EmailForwardRevisionEntity } from "@/entity/EmailForwardRevision.entity";
import type { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import {
  isDirectSendPayloadBound,
} from "@/service/emailOrganization/EmailOrganizationIntentResolver";

/**
 * R8-01: the PRODUCTION direct-send payload binding (design §8.1, FR-12).
 * Extracted from AIChatQueryLoop so tests exercise the real resolution —
 * durable reads included — instead of calling the pure check with the
 * trusted inputs forced true.
 *
 * The function resolves every trusted input from durable state:
 *  - forward: the frozen revision's envelope, the conversation-scoped draft,
 *    the source message's sender + account, the dropped-attachment names,
 *    and (when the sentence names no address) the single-open-draft rule.
 *  - trash: the target message's sender + a case-insensitive unique-sender
 *    count on the account.
 *  - restore: the account-wide restorable Trash operation IDS — the
 *    candidate is the id the count query found, never the model's id.
 * Any durable read failure fails closed to the review path.
 */

export interface DirectSendBindingDeps {
  readonly readRevision: (revisionId: number) => Promise<EmailForwardRevisionEntity | null>;
  readonly readDraft: (draftId: number) => Promise<EmailForwardDraftEntity | null>;
  readonly readMessage: (messageId: number) => Promise<EmailReceivedMessageEntity | null>;
  readonly countBySender: (emailServiceId: number, fromAddress: string) => Promise<number>;
  readonly readOperation: (operationId: string) => Promise<{ kind: string; operationId: string; emailServiceId: number } | null>;
  readonly findRestorableTrashOperationIds: (emailServiceId: number) => Promise<string[]>;
  readonly findOpenDraftsForConversation: (conversationId: number) => Promise<EmailForwardDraftEntity[]>;
}

export interface DirectSendBindingInput {
  readonly toolName: string;
  readonly args: unknown;
  readonly userText: string;
  readonly conversationId?: number | string | null;
}

export async function resolveDirectSendPayloadBinding(
  input: DirectSendBindingInput,
  deps: DirectSendBindingDeps
): Promise<boolean> {
  const record = (typeof input.args === "object" && input.args !== null
    ? input.args
    : {}) as Record<string, unknown>;
  let trustedPayloadAddresses: string[] = [];
  let singleRestoreCandidateId: string | null = null;
  let draftBelongsToConversation = false;
  let sourceAddress: string | null = null;
  let senderMessageCount: number | null = null;
  let droppedAttachmentNames: string[] = [];
  try {
    if (input.toolName === "send_email_forward") {
      // The frozen revision the model references carries the envelope.
      const revisionId = Number(record.revision_id);
      if (!Number.isInteger(revisionId) || revisionId <= 0) return false;
      const revision = await deps.readRevision(revisionId);
      if (!revision) return false;
      trustedPayloadAddresses = [
        ...parseStringArrayJson(revision.toRecipientsJson),
        ...parseStringArrayJson(revision.ccRecipientsJson),
        ...parseStringArrayJson(revision.bccRecipientsJson),
      ];
      // R7-01: the payload must be THIS conversation's review — a UI-page
      // draft or another conversation's draft takes the review card.
      const draft = await deps.readDraft(revision.draftId);
      const conversationNumber =
        typeof input.conversationId === "number"
          ? input.conversationId
          : Number(input.conversationId);
      draftBelongsToConversation =
        draft !== null &&
        draft.conversationId !== null &&
        Number.isFinite(conversationNumber) &&
        draft.conversationId === conversationNumber;
      // R7-01: source identity — the sending account must be the source
      // message's account, and the source sender is excluded from the
      // sentence's recipient set (named provenance is not a recipient).
      const sourceMessage = await deps.readMessage(draft?.messageId ?? 0);
      if (!sourceMessage) return false;
      if (revision.sendingAccountId !== sourceMessage.emailServiceId) return false;
      sourceAddress = sourceMessage.fromAddress.trim().toLowerCase();
      // R8-01: the manifest entries the revision deselected — a direct send
      // may only drop what the sentence names.
      let manifest: Array<{ displayName: string; selected: boolean }> = [];
      try {
        manifest = JSON.parse(revision.attachmentsJson) as Array<{
          displayName: string;
          selected: boolean;
        }>;
      } catch {
        return false;
      }
      droppedAttachmentNames = manifest
        .filter((entry) => entry.selected === false)
        .map((entry) => String(entry.displayName ?? ""));
      // R9-01: the single-open-draft + current-revision rule runs for EVERY
      // direct forward — addressed ("forward this to finance@x now") and
      // address-free ("send it now") alike. Two open drafts (even with the
      // same envelope) make the target ambiguous; a stale revision is not
      // what the user reviewed. Both refuse to the review path.
      if (!Number.isFinite(conversationNumber)) return false;
      const openDrafts = await deps.findOpenDraftsForConversation(
        conversationNumber
      );
      if (openDrafts.length !== 1) return false;
      if (openDrafts[0].id !== draft?.id) return false;
      if (revision.id !== draft.currentRevisionId) return false;
    } else if (input.toolName === "move_email_to_trash") {
      const messageId = Number(record.message_id);
      if (!Number.isInteger(messageId) || messageId <= 0) return false;
      const message = await deps.readMessage(messageId);
      if (!message) return false;
      // Bind the target identity: the sender the sentence must name, and
      // it must be UNIQUE on the account (case-insensitive since R8-01) —
      // two messages from the same sender make the request ambiguous.
      trustedPayloadAddresses = [message.fromAddress.trim().toLowerCase()];
      senderMessageCount = await deps.countBySender(
        message.emailServiceId,
        message.fromAddress
      );
      // Chat has no UI selection: a frozen bulk selection always takes
      // the review path (the PRD's 12-message flow runs in the UI bulk
      // dialog, which shows the exact frozen set before executing).
      if (record.selection_id !== undefined) return false;
    } else if (input.toolName === "restore_email") {
      // R7-01/R8-01: "undo that" is direct only with exactly ONE restorable
      // Trash operation on the REFERENCED operation's account — an
      // account-wide count (no window), including partial successes — and
      // the candidate is THE id the count query found (never the model's
      // id, so a failed Trash id cannot slip through on a technicality).
      const operationId = typeof record.operation_id === "string" ? record.operation_id : "";
      if (operationId === "") return false;
      const referenced = await deps.readOperation(operationId);
      if (!referenced || referenced.kind !== "trash") return false;
      const restorableIds = await deps.findRestorableTrashOperationIds(
        referenced.emailServiceId
      );
      if (restorableIds.length !== 1) return false;
      singleRestoreCandidateId = restorableIds[0];
    } else {
      return false;
    }
  } catch {
    // Any durable-state read failure fails closed to the review path.
    return false;
  }
  return isDirectSendPayloadBound({
    toolName: input.toolName,
    args: input.args,
    userText: input.userText,
    trustedPayloadAddresses,
    singleRestoreCandidateId,
    draftBelongsToConversation,
    sourceAddress,
    senderMessageCount,
    droppedAttachmentNames,
  });
}

