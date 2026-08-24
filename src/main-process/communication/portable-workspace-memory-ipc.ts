import { ipcMain } from "electron";
import { z } from "zod";
import { PortableWorkspaceMemoryService } from "@/service/PortableWorkspaceMemoryService";
import {
  AI_PORTABLE_WORKSPACE_MEMORY_STATUS,
  AI_PORTABLE_WORKSPACE_MEMORY_ENABLE_PREVIEW,
  AI_PORTABLE_WORKSPACE_MEMORY_ENABLE,
  AI_PORTABLE_WORKSPACE_MEMORY_EXPORT_PREVIEW,
  AI_PORTABLE_WORKSPACE_MEMORY_EXPORT,
  AI_PORTABLE_WORKSPACE_MEMORY_RESCAN,
  AI_PORTABLE_WORKSPACE_MEMORY_DIAGNOSTICS_LIST,
  AI_PORTABLE_WORKSPACE_MEMORY_CONFLICTS_LIST,
  AI_PORTABLE_WORKSPACE_MEMORY_CONFLICT_RESOLVE,
  AI_PORTABLE_WORKSPACE_MEMORY_POLICY_UPDATE,
  AI_PORTABLE_WORKSPACE_MEMORY_PROMOTE,
  AI_PORTABLE_WORKSPACE_MEMORY_PRIVATIZE,
  AI_PORTABLE_WORKSPACE_MEMORY_REVIEW_APPROVE,
  AI_PORTABLE_WORKSPACE_MEMORY_REVIEW_REJECT,
  AI_PORTABLE_WORKSPACE_MEMORY_GIT_STATUS,
  AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_PREVIEW,
  AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_APPLY,
  AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_REMOVE,
  AI_PORTABLE_WORKSPACE_MEMORY_IDENTITY_REGENERATE,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

let service: PortableWorkspaceMemoryService | null = null;

function getService(): PortableWorkspaceMemoryService {
  if (!service) service = new PortableWorkspaceMemoryService();
  return service;
}

/** Test-only: drop the cached singleton. */
export function _resetPortableWorkspaceMemorySingletonsForTesting(): void {
  service = null;
}

function safeParse<T = unknown>(data: unknown): T | null {
  if (typeof data !== "string" || data.length === 0) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Strict request schemas (design §20.1). Every request carries ONLY a
 * conversationId plus operation-specific values. Unknown fields — especially
 * `workspaceRoot`, `workspaceKey`, `scopeId`, and absolute paths — are
 * rejected outright so a forged scope can never ride a request (FR-055).
 */
const conversationSchema = z.object(
  {
    conversationId: z.string().min(1).max(200),
  },
  { description: "conversation request" }
);

const strictConversation = conversationSchema.strict();

const enableSchema = z
  .object({
    conversationId: z.string().min(1).max(200),
    defaultStorageMode: z.enum([
      "private-only",
      "portable-local",
      "portable-team",
      "ask-each-time",
    ]),
    importPolicy: z.enum(["automatic", "review-new", "review-all"]),
    exportScope: z.enum(["none", "active", "all"]),
    visibility: z.enum(["local", "team"]),
    installBridges: z.array(z.enum(["AGENTS.md", "CLAUDE.md"])).max(2),
  })
  .strict();

const exportSchema = z
  .object({
    conversationId: z.string().min(1).max(200),
    scope: z.enum(["active", "all"]),
    visibility: z.enum(["local", "team"]),
  })
  .strict();

const policySchema = z
  .object({
    conversationId: z.string().min(1).max(200),
    portableEnabled: z.boolean().optional(),
    defaultStorageMode: z
      .enum([
        "private-only",
        "portable-local",
        "portable-team",
        "ask-each-time",
      ])
      .optional(),
    importPolicy: z.enum(["automatic", "review-new", "review-all"]).optional(),
  })
  .strict();

const memoryOpSchema = z
  .object({
    conversationId: z.string().min(1).max(200),
    memoryId: z.string().min(1).max(100),
  })
  .strict();

const promoteSchema = memoryOpSchema.extend({
  visibility: z.enum(["local", "team"]),
});
const mergedDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(8000),
  type: z.enum([
    "project",
    "decision",
    "workflow",
    "convention",
    "reference",
    "warning",
  ]),
  status: z.enum(["active", "archived", "contradicted"]),
  confidence: z.number().int().min(0).max(100),
  visibility: z.enum(["local", "team"]),
});

const conflictResolveSchema = memoryOpSchema
  .extend({
    action: z.enum(["use-file", "use-app", "merge"]),
    // mergedDocument is REQUIRED for use-app/merge (PRD §14.7: the caller
    // supplies the chosen/merged bytes), optional for use-file.
    mergedDocument: z
      .union([
        z.literal("use-file").transform(() => undefined),
        mergedDocumentSchema,
      ])
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      (val.action === "use-app" || val.action === "merge") &&
      !val.mergedDocument
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${val.action} requires a mergedDocument`,
      });
    }
  });

const bridgeSchema = z
  .object({
    conversationId: z.string().min(1).max(200),
    target: z.enum(["AGENTS.md", "CLAUDE.md"]),
    expectedBeforeHash: z.string().max(64).optional(),
  })
  .strict();

/**
 * Register portable workspace-memory IPC handlers. None of these operations
 * invoke an AI model, so no USER_AI_ENABLED gate applies (design §20.4); the
 * AI-gated auto-dream channel lives in ai-workspace-memory-ipc.ts.
 */
export function registerPortableWorkspaceMemoryIpcHandlers(): void {
  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_STATUS,
    async (_e, data: unknown) => {
      try {
        const input = strictConversation.safeParse(safeParse(data) ?? {});
        if (!input.success) return denied("conversationId is required");
        return ok(await getService().getStatus(input.data.conversationId));
      } catch (err) {
        return denied(err instanceof Error ? err.message : "status failed");
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_ENABLE_PREVIEW,
    async (_e, data: unknown) => {
      try {
        const input = strictConversation.safeParse(safeParse(data) ?? {});
        if (!input.success) return denied("conversationId is required");
        return ok(await getService().previewEnable(input.data.conversationId));
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "enable preview failed"
        );
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_ENABLE,
    async (_e, data: unknown) => {
      try {
        const input = enableSchema.safeParse(safeParse(data));
        if (!input.success) {
          return denied("invalid enable request payload");
        }
        return ok(await getService().enable(input.data));
      } catch (err) {
        return denied(err instanceof Error ? err.message : "enable failed");
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_EXPORT_PREVIEW,
    async (_e, data: unknown) => {
      try {
        const input = strictConversation.safeParse(safeParse(data) ?? {});
        if (!input.success) return denied("conversationId is required");
        return ok(await getService().previewExport(input.data.conversationId));
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "export preview failed"
        );
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_EXPORT,
    async (_e, data: unknown) => {
      try {
        const input = exportSchema.safeParse(safeParse(data));
        if (!input.success) return denied("invalid export request payload");
        return ok(await getService().exportMemories(input.data));
      } catch (err) {
        return denied(err instanceof Error ? err.message : "export failed");
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_RESCAN,
    async (_e, data: unknown) => {
      try {
        const input = strictConversation.safeParse(safeParse(data) ?? {});
        if (!input.success) return denied("conversationId is required");
        return ok(await getService().rescan(input.data.conversationId));
      } catch (err) {
        return denied(err instanceof Error ? err.message : "rescan failed");
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_DIAGNOSTICS_LIST,
    async (_e, data: unknown) => {
      try {
        const input = strictConversation.safeParse(safeParse(data) ?? {});
        if (!input.success) return denied("conversationId is required");
        return ok(
          await getService().listDiagnostics(input.data.conversationId)
        );
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "diagnostics failed"
        );
      }
    }
  );
  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_CONFLICTS_LIST,
    async (_e, data: unknown) => {
      try {
        const input = strictConversation.safeParse(safeParse(data) ?? {});
        if (!input.success) return denied("conversationId is required");
        return ok(await getService().listConflicts(input.data.conversationId));
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "conflicts list failed"
        );
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_CONFLICT_RESOLVE,
    async (_e, data: unknown) => {
      try {
        const input = conflictResolveSchema.safeParse(safeParse(data));
        if (!input.success) {
          return denied("invalid conflict resolution payload");
        }
        await getService().resolveConflict(input.data);
        return ok(null);
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "conflict resolve failed"
        );
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_POLICY_UPDATE,
    async (_e, data: unknown) => {
      try {
        const input = policySchema.safeParse(safeParse(data));
        if (!input.success) return denied("invalid policy request payload");
        return ok(await getService().updatePolicy(input.data));
      } catch (err) {
        return denied(err instanceof Error ? err.message : "policy failed");
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_PROMOTE,
    async (_e, data: unknown) => {
      try {
        const input = promoteSchema.safeParse(safeParse(data));
        if (!input.success) return denied("invalid promote request payload");
        await getService().promote(input.data);
        return ok(null);
      } catch (err) {
        return denied(err instanceof Error ? err.message : "promote failed");
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_PRIVATIZE,
    async (_e, data: unknown) => {
      try {
        const input = memoryOpSchema.safeParse(safeParse(data));
        if (!input.success) return denied("invalid privatize request payload");
        await getService().privatize(input.data);
        return ok(null);
      } catch (err) {
        return denied(err instanceof Error ? err.message : "privatize failed");
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_REVIEW_APPROVE,
    async (_e, data: unknown) => {
      try {
        const input = memoryOpSchema.safeParse(safeParse(data));
        if (!input.success) return denied("invalid review request payload");
        await getService().approveReview(input.data);
        return ok(null);
      } catch (err) {
        return denied(err instanceof Error ? err.message : "review failed");
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_REVIEW_REJECT,
    async (_e, data: unknown) => {
      try {
        const input = memoryOpSchema.safeParse(safeParse(data));
        if (!input.success) return denied("invalid review request payload");
        await getService().rejectReview(input.data);
        return ok(null);
      } catch (err) {
        return denied(err instanceof Error ? err.message : "review failed");
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_GIT_STATUS,
    async (_e, data: unknown) => {
      try {
        const input = strictConversation.safeParse(safeParse(data) ?? {});
        if (!input.success) return denied("conversationId is required");
        return ok(await getService().getGitStatus(input.data.conversationId));
      } catch (err) {
        return denied(err instanceof Error ? err.message : "git status failed");
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_PREVIEW,
    async (_e, data: unknown) => {
      try {
        const input = bridgeSchema.safeParse(safeParse(data));
        if (!input.success) return denied("invalid bridge request payload");
        return ok(await getService().previewBridge(input.data));
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "bridge preview failed"
        );
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_APPLY,
    async (_e, data: unknown) => {
      try {
        const input = bridgeSchema.safeParse(safeParse(data));
        if (!input.success) return denied("invalid bridge request payload");
        return ok(await getService().applyBridge(input.data));
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "bridge apply failed"
        );
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_BRIDGE_REMOVE,
    async (_e, data: unknown) => {
      try {
        const input = bridgeSchema.safeParse(safeParse(data));
        if (!input.success) return denied("invalid bridge request payload");
        return ok(await getService().removeBridge(input.data));
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "bridge remove failed"
        );
      }
    }
  );

  ipcMain.handle(
    AI_PORTABLE_WORKSPACE_MEMORY_IDENTITY_REGENERATE,
    async (_e, data: unknown) => {
      try {
        const input = strictConversation.safeParse(safeParse(data) ?? {});
        if (!input.success) return denied("conversationId is required");
        return ok(await getService().regenerateIdentity(input.data));
      } catch (err) {
        return denied(
          err instanceof Error ? err.message : "identity regeneration failed"
        );
      }
    }
  );
}
