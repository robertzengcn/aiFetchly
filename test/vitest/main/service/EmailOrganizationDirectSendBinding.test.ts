import { describe, it, expect } from "vitest";
import {
  resolveDirectSendPayloadBinding,
  type DirectSendBindingDeps,
} from "@/service/emailOrganization/EmailOrganizationDirectSendBinding";
import type {
  EmailForwardDraftEntity,
} from "@/entity/EmailForwardDraft.entity";
import type {
  EmailForwardRevisionEntity,
} from "@/entity/EmailForwardRevision.entity";
import type {
  EmailReceivedMessageEntity,
} from "@/entity/EmailReceivedMessage.entity";

/**
 * R8-01: the PRODUCTION binding resolution (durable reads included — the
 * audit explicitly requires the production method, not the pure check with
 * the trusted inputs forced true).
 *
 * Covered here:
 *  - Chat direct Trash runs when the named sender has exactly one message
 *    (case-insensitive count), and the conversation flag does NOT gate it.
 *  - Chat direct Undo runs when the account has exactly one restorable
 *    Trash operation, and the candidate is the id the count query found —
 *    a model-supplied failed id refuses.
 *  - "send it now" with TWO open drafts in the conversation refuses BOTH
 *    revision ids (ambiguity → review).
 *  - A revision that dropped an attachment refuses unless the sentence
 *    names the dropped content.
 */

const CONVERSATION = 7;

function makeRevision(
  overrides: Partial<EmailForwardRevisionEntity> & { id: number; draftId: number }
): EmailForwardRevisionEntity {
  return {
    toRecipientsJson: JSON.stringify(["finance@example.com"]),
    ccRecipientsJson: null,
    bccRecipientsJson: null,
    sendingAccountId: 900,
    attachmentsJson: "[]",
    ...overrides,
  } as unknown as EmailForwardRevisionEntity;
}

function makeDraft(
  overrides: Partial<EmailForwardDraftEntity> & { id: number }
): EmailForwardDraftEntity {
  return {
    conversationId: CONVERSATION,
    messageId: 42,
    status: "ready",
    currentRevisionId: overrides.id,
    ...overrides,
  } as unknown as EmailForwardDraftEntity;
}

function makeMessage(
  overrides: Partial<EmailReceivedMessageEntity> & { id: number }
): EmailReceivedMessageEntity {
  return {
    emailServiceId: 900,
    fromAddress: "alice@example.com",
    ...overrides,
  } as unknown as EmailReceivedMessageEntity;
}

interface HarnessState {
  revisions: Map<number, EmailForwardRevisionEntity>;
  drafts: Map<number, EmailForwardDraftEntity>;
  messages: Map<number, EmailReceivedMessageEntity>;
  senderCounts: Map<string, number>;
  operationKinds: Map<string, string>;
  restorableIds: string[];
}

function makeDeps(state: HarnessState): DirectSendBindingDeps {
  return {
    readRevision: async (id) => state.revisions.get(id) ?? null,
    readDraft: async (id) => state.drafts.get(id) ?? null,
    readMessage: async (id) => state.messages.get(id) ?? null,
    countBySender: async (_account, fromAddress) =>
      state.senderCounts.get(`${_account}:${fromAddress.toLowerCase()}`) ?? 0,
    readOperation: async (operationId) => {
      const kind = state.operationKinds.get(operationId);
      return kind
        ? { kind, operationId, emailServiceId: 900 }
        : null;
    },
    findRestorableTrashOperationIds: async () => state.restorableIds,
    findOpenDraftsForConversation: async (conversationId) => {
      if (conversationId !== CONVERSATION) return [];
      return [...state.drafts.values()].filter(
        (draft) => draft.conversationId === CONVERSATION
      );
    },
  };
}

describe("resolveDirectSendPayloadBinding — production resolution (R8-01)", () => {
  it("direct Trash RUNS for the single named sender (the production caller no longer hides it)", async () => {
    const state: HarnessState = {
      revisions: new Map(),
      drafts: new Map(),
      messages: new Map([
        [41, makeMessage({ id: 41, fromAddress: "bob@example.com" })],
      ]),
      senderCounts: new Map([["900:bob@example.com", 1]]),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const allowed = await resolveDirectSendPayloadBinding(
      {
        toolName: "move_email_to_trash",
        args: { message_id: 41 },
        userText: "delete the email from bob@example.com",
      },
      makeDeps(state)
    );
    expect(allowed).toBe(true);
  });

  it("direct Trash refuses when the sender is ambiguous under case-insensitive counting", async () => {
    const state: HarnessState = {
      revisions: new Map(),
      drafts: new Map(),
      messages: new Map([
        [41, makeMessage({ id: 41, fromAddress: "Bob@Example.com" })],
      ]),
      // Bob@x.com and bob@x.com are ONE person: the count is 2 after the
      // case-insensitive fix, so the gate refuses.
      senderCounts: new Map([["900:bob@example.com", 2]]),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const allowed = await resolveDirectSendPayloadBinding(
      {
        toolName: "move_email_to_trash",
        args: { message_id: 41 },
        userText: "delete the email from bob@example.com",
      },
      makeDeps(state)
    );
    expect(allowed).toBe(false);
  });

  it("direct Undo RUNS for the single restorable operation — the candidate comes from the count query", async () => {
    const state: HarnessState = {
      revisions: new Map(),
      drafts: new Map(),
      messages: new Map(),
      senderCounts: new Map(),
      operationKinds: new Map([["op-real-123456", "trash"]]),
      restorableIds: ["op-real-123456"],
    };
    const allowed = await resolveDirectSendPayloadBinding(
      {
        toolName: "restore_email",
        args: { operation_id: "op-real-123456" },
        userText: "undo that deletion",
      },
      makeDeps(state)
    );
    expect(allowed).toBe(true);
  });

  it("direct Undo refuses a model-supplied FAILED id even when the account has one OTHER restorable operation", async () => {
    const state: HarnessState = {
      revisions: new Map(),
      drafts: new Map(),
      messages: new Map(),
      senderCounts: new Map(),
      operationKinds: new Map([["op-failed-9999", "trash"]]),
      // The account's one restorable operation is NOT the referenced one.
      restorableIds: ["op-real-123456"],
    };
    const allowed = await resolveDirectSendPayloadBinding(
      {
        toolName: "restore_email",
        args: { operation_id: "op-failed-9999" },
        userText: "undo that deletion",
      },
      makeDeps(state)
    );
    expect(allowed).toBe(false);
  });

  it("'send it now' with TWO open drafts in the conversation refuses BOTH revision ids", async () => {
    const draftA = makeDraft({ id: 1 });
    const draftB = makeDraft({ id: 2 });
    const state: HarnessState = {
      revisions: new Map([
        [11, makeRevision({ id: 11, draftId: 1 })],
        [22, makeRevision({ id: 22, draftId: 2 })],
      ]),
      drafts: new Map([
        [1, draftA],
        [2, draftB],
      ]),
      messages: new Map([[42, makeMessage({ id: 42 })]]),
      senderCounts: new Map(),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const deps = makeDeps(state);
    const refusedA = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "send it now",
        conversationId: CONVERSATION,
      },
      deps
    );
    const refusedB = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 2, revision_id: 22 },
        userText: "send it now",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(refusedA).toBe(false);
    expect(refusedB).toBe(false);
  });

  it("'send it now' with exactly ONE open draft binds its CURRENT revision", async () => {
    const draft = makeDraft({ id: 1, currentRevisionId: 11 });
    const state: HarnessState = {
      revisions: new Map([
        [11, makeRevision({ id: 11, draftId: 1 })],
        [9, makeRevision({ id: 9, draftId: 1 })], // superseded
      ]),
      drafts: new Map([[1, draft]]),
      messages: new Map([[42, makeMessage({ id: 42 })]]),
      senderCounts: new Map(),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const deps = makeDeps(state);
    const allowed = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "send it now",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(allowed).toBe(true);
    // A superseded revision is not what the user reviewed → review path.
    const stale = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 9 },
        userText: "send it now",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(stale).toBe(false);
  });

  // ---- R9-01: the single-draft rule is unconditional; drops need exclusion ----

  it("R9-01: two open drafts BOTH enveloped to finance refuse the addressed sentence (audit test)", async () => {
    const draftA = makeDraft({ id: 1, currentRevisionId: 11 });
    const draftB = makeDraft({ id: 2, currentRevisionId: 22 });
    const state: HarnessState = {
      revisions: new Map([
        [11, makeRevision({ id: 11, draftId: 1 })],
        [22, makeRevision({ id: 22, draftId: 2 })],
      ]),
      drafts: new Map([
        [1, draftA],
        [2, draftB],
      ]),
      messages: new Map([[42, makeMessage({ id: 42 })]]),
      senderCounts: new Map(),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const deps = makeDeps(state);
    const refusedA = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "forward this to finance@example.com now",
        conversationId: CONVERSATION,
      },
      deps
    );
    const refusedB = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 2, revision_id: 22 },
        userText: "forward this to finance@example.com now",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(refusedA).toBe(false);
    expect(refusedB).toBe(false);
  });

  it("R9-01: 'forward this invoice' with invoice.pdf deselected REFUSES (stem is the request noun, not an exclusion)", async () => {
    const draft = makeDraft({ id: 1, currentRevisionId: 11 });
    const revision = makeRevision({
      id: 11,
      draftId: 1,
      attachmentsJson: JSON.stringify([
        { displayName: "invoice.pdf", selected: false, partId: "p1" },
      ]),
    });
    const state: HarnessState = {
      revisions: new Map([[11, revision]]),
      drafts: new Map([[1, draft]]),
      messages: new Map([[42, makeMessage({ id: 42 })]]),
      senderCounts: new Map(),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const deps = makeDeps(state);
    const refused = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "forward this invoice to finance@example.com now",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(refused).toBe(false);
  });

  it("R9-01: 'keep the logo' with logo.png deselected REFUSES (no exclusion phrase)", async () => {
    const draft = makeDraft({ id: 1, currentRevisionId: 11 });
    const revision = makeRevision({
      id: 11,
      draftId: 1,
      attachmentsJson: JSON.stringify([
        { displayName: "logo.png", selected: false, partId: "p2" },
      ]),
    });
    const state: HarnessState = {
      revisions: new Map([[11, revision]]),
      drafts: new Map([[1, draft]]),
      messages: new Map([[42, makeMessage({ id: 42 })]]),
      senderCounts: new Map(),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const deps = makeDeps(state);
    const refused = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "forward this to finance@example.com now and keep the logo",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(refused).toBe(false);
  });

  it("R9-01: one-letter stems inside 'forward' never authorize a drop (a.pdf)", async () => {
    const draft = makeDraft({ id: 1, currentRevisionId: 11 });
    const revision = makeRevision({
      id: 11,
      draftId: 1,
      attachmentsJson: JSON.stringify([
        { displayName: "a.pdf", selected: false, partId: "p1" },
      ]),
    });
    const state: HarnessState = {
      revisions: new Map([[11, revision]]),
      drafts: new Map([[1, draft]]),
      messages: new Map([[42, makeMessage({ id: 42 })]]),
      senderCounts: new Map(),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const deps = makeDeps(state);
    const refused = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "forward this to finance@example.com now",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(refused).toBe(false);
  });

  it("R9-01: an exclusion phrase with the whole-word stem still allows the drop", async () => {
    const draft = makeDraft({ id: 1, currentRevisionId: 11 });
    const revision = makeRevision({
      id: 11,
      draftId: 1,
      attachmentsJson: JSON.stringify([
        { displayName: "logo.png", selected: false, partId: "p2" },
      ]),
    });
    const state: HarnessState = {
      revisions: new Map([[11, revision]]),
      drafts: new Map([[1, draft]]),
      messages: new Map([[42, makeMessage({ id: 42 })]]),
      senderCounts: new Map(),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const deps = makeDeps(state);
    const allowed = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "forward this to finance@example.com now without the logo",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(allowed).toBe(true);
  });

  it("R10-01: 'without delay' with invoice.pdf deselected REFUSES (audit test)", async () => {
    const draft = makeDraft({ id: 1, currentRevisionId: 11 });
    const revision = makeRevision({
      id: 11,
      draftId: 1,
      attachmentsJson: JSON.stringify([
        { displayName: "invoice.pdf", selected: false, partId: "p1" },
      ]),
    });
    const state: HarnessState = {
      revisions: new Map([[11, revision]]),
      drafts: new Map([[1, draft]]),
      messages: new Map([[42, makeMessage({ id: 42 })]]),
      senderCounts: new Map(),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const deps = makeDeps(state);
    const refused = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "forward this invoice to finance@example.com now without delay",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(refused).toBe(false);
  });

  it("R10-01: two deselected files, one exclusion — only logo.png is authorized, invoice.pdf refuses", async () => {
    const draft = makeDraft({ id: 1, currentRevisionId: 11 });
    const revision = makeRevision({
      id: 11,
      draftId: 1,
      attachmentsJson: JSON.stringify([
        { displayName: "invoice.pdf", selected: false, partId: "p1" },
        { displayName: "logo.png", selected: false, partId: "p2" },
      ]),
    });
    const state: HarnessState = {
      revisions: new Map([[11, revision]]),
      drafts: new Map([[1, draft]]),
      messages: new Map([[42, makeMessage({ id: 42 })]]),
      senderCounts: new Map(),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const deps = makeDeps(state);
    const refused = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "forward this invoice to finance@example.com now without the logo",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(refused).toBe(false);
  });

  it("a revision that dropped an attachment refuses unless the sentence names it", async () => {
    const draft = makeDraft({ id: 1, currentRevisionId: 11 });
    const revision = makeRevision({
      id: 11,
      draftId: 1,
      attachmentsJson: JSON.stringify([
        { displayName: "invoice.pdf", selected: true, partId: "p1" },
        { displayName: "logo.png", selected: false, partId: "p2" },
      ]),
    });
    const state: HarnessState = {
      revisions: new Map([[11, revision]]),
      drafts: new Map([[1, draft]]),
      messages: new Map([[42, makeMessage({ id: 42 })]]),
      senderCounts: new Map(),
      operationKinds: new Map(),
      restorableIds: [],
    };
    const deps = makeDeps(state);
    // The sentence does not mention the dropped logo → review.
    const silentDrop = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "send it now",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(silentDrop).toBe(false);
    // The sentence names the dropped content ("without the logo") → direct.
    const namedDrop = await resolveDirectSendPayloadBinding(
      {
        toolName: "send_email_forward",
        args: { draft_id: 1, revision_id: 11 },
        userText: "send it now without the logo",
        conversationId: CONVERSATION,
      },
      deps
    );
    expect(namedDrop).toBe(true);
  });
});
