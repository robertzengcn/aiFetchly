import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Input schemas for the email organization IPC surface (design §8.2).
 * Renderer-facing fields are camelCase; no field accepts authorization
 * tokens, filesystem paths, raw UIDs or provider commands.
 */

const positiveInt = z.number().int().positive();
const recipientList = z.array(z.string().min(3).max(320)).max(20);

export const emailOrgAccountInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: positiveInt,
  })
);

export const emailOrgAttachmentSelectionSchema = lazySchema(() =>
  z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }),
    z.object({ mode: z.literal("none") }),
    z.object({
      mode: z.literal("parts"),
      partIds: z.array(z.string().min(1).max(64)).min(1).max(20),
    }),
  ])
);

export const emailForwardDraftCreateInputSchema = lazySchema(() =>
  z.strictObject({
    messageId: positiveInt,
    // Optional at review time: the dialog is inspectable before recipients
    // are typed; delivery refuses an empty envelope at send time.
    to: recipientList.optional(),
    cc: recipientList.optional(),
    bcc: recipientList.optional(),
    note: z.string().max(2000).nullable().optional(),
    subject: z.string().max(998).nullable().optional(),
    senderServiceId: positiveInt.nullable().optional(),
    attachments: emailOrgAttachmentSelectionSchema().optional(),
  })
);

export const emailForwardDraftUpdateInputSchema = lazySchema(() =>
  z.strictObject({
    draftId: positiveInt,
    expectedRevisionId: positiveInt,
    to: recipientList.optional(),
    cc: recipientList.optional(),
    bcc: recipientList.optional(),
    note: z.string().max(2000).nullable().optional(),
    subject: z.string().max(998).nullable().optional(),
    attachments: emailOrgAttachmentSelectionSchema().optional(),
  })
);

export const emailForwardDraftDetailInputSchema = lazySchema(() =>
  z.strictObject({
    draftId: positiveInt,
  })
);

export const emailOrgAuthorizeInputSchema = lazySchema(() =>
  z.strictObject({
    draftId: positiveInt,
    revisionId: positiveInt,
  })
);

export const emailOrgSendInputSchema = lazySchema(() =>
  z.strictObject({
    draftId: positiveInt,
    revisionId: positiveInt,
    authorizationId: positiveInt,
  })
);

export const emailOrgTrashInputSchema = lazySchema(() =>
  z.strictObject({
    messageId: positiveInt,
    /** Optional UI-event idempotency anchor (double-click protection). */
    actionId: z.string().max(255).nullable().optional(),
  })
);

export const emailOrgRestoreInputSchema = lazySchema(() =>
  z.strictObject({
    operationId: z.string().min(8).max(64),
    destinationFolderPath: z.string().min(1).max(255).nullable().optional(),
  })
);

export const emailOrgOperationInputSchema = lazySchema(() =>
  z.strictObject({
    operationId: z.string().min(8).max(64),
  })
);

export const emailOrgSearchInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: positiveInt,
    source: z.enum(["local", "server"]).default("local"),
    folderPaths: z.array(z.string().min(1).max(255)).max(20).optional(),
    fromAddress: z.string().max(320).optional(),
    subject: z.string().max(200).optional(),
    receivedFrom: z.string().max(40).optional(),
    receivedTo: z.string().max(40).optional(),
    unreadOnly: z.boolean().optional(),
    hasAttachments: z.boolean().optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  })
);

export const emailOrgSelectionPrepareInputSchema = lazySchema(() =>
  z.strictObject({
    emailServiceId: positiveInt,
    kind: z.enum(["trash", "restore"]),
    messageIds: z.array(positiveInt).min(1).max(100),
    filtersSummary: z.record(z.string(), z.unknown()).optional(),
  })
);
