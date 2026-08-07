import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { sortBySchema } from "@/schemas/ipc/_shared/pagination";

/** Reply identity profile get. */
export const emailReplyIdentityGetInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: z.number().int().positive("Email service id is required"),
  }),
);

/** Reply identity profile upsert. */
export const emailReplyIdentityUpdateInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: z.number().int().positive("Email service id is required"),
    ownerName: z.string().min(1, "Owner name is required"),
    ownerRole: z.string().nullable().optional(),
    companyName: z.string().nullable().optional(),
    preferredTone: z.string().nullable().optional(),
    signature: z.string().nullable().optional(),
    styleNotes: z.string().nullable().optional(),
    forbiddenPhrases: z.array(z.string()).optional(),
    discloseAutomation: z.number().int().min(0).max(1).optional(),
  }),
);

/** Reply draft detail. */
export const emailReplyDraftDetailInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("Draft id is required"),
  }),
);

/** Reply draft body edit (user edits an AI-generated draft). */
export const emailReplyDraftUpdateInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("Draft id is required"),
    subject: z.string().min(1).max(998),
    bodyText: z.string().min(1),
    bodyHtml: z.string().nullable().optional(),
  }),
);

/** AI draft generation. AI-gated at the handler boundary. */
export const emailReplyDraftCreateInputSchema = lazySchema(() =>
  z.strictObject({
    messageId: z.number().int().positive("Message id is required"),
    tone: z.string().max(100).optional(),
    goal: z.string().max(1000).optional(),
    extraInstructions: z.string().max(2000).optional(),
    useKnowledgeLibrary: z.boolean().optional(),
  }),
);

/** Confirmed reply send (UI Send button). */
export const emailReplySendInputSchema = lazySchema(() =>
  z.strictObject({
    draftId: z.number().int().positive("Draft id is required"),
    emailServiceId: z.number().int().positive().optional(),
  }),
);

/** AI auto-reply audit list. */
export const emailAutoReplyAuditListInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: z.number().int().positive().optional(),
    decisionStatus: z.string().optional(),
    classification: z.string().optional(),
    senderSearch: z.string().optional(),
    dateStart: z.string().optional(),
    dateEnd: z.string().optional(),
    search: z.string().optional(),
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
    sortby: sortBySchema().optional(),
  }),
);

/** AI auto-reply audit detail. */
export const emailAutoReplyAuditDetailInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive("Audit log id is required"),
  }),
);
