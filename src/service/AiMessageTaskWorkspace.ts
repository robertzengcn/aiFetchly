import fs from "node:fs/promises";
import path from "node:path";
import { WorkspaceModule } from "@/modules/WorkspaceModule";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";

/**
 * Resolve an absolute directory the user (or an approved schedule tool call)
 * chose as the workspace for a scheduled AI message.
 */
export async function canonicalizeWorkspaceDirectory(
  rootPath: string
): Promise<string> {
  const trimmed = rootPath.trim();
  if (!trimmed) {
    throw new Error("Workspace path is empty");
  }
  if (!path.isAbsolute(trimmed)) {
    throw new Error("Workspace path must be an absolute path");
  }
  let realPath: string;
  try {
    realPath = await fs.realpath(trimmed);
  } catch {
    throw new Error(`Workspace path does not exist: ${trimmed}`);
  }
  const stat = await fs.stat(realPath);
  if (!stat.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${realPath}`);
  }
  return realPath;
}

/**
 * Approve `rootPath` as the active workspace for a conversation.
 * Returns the canonical directory that was stored.
 */
export async function bindApprovedWorkspace(
  conversationId: string,
  rootPath: string
): Promise<string> {
  const canonical = await canonicalizeWorkspaceDirectory(rootPath);
  const module = new WorkspaceModule();
  const active = await module.getActiveWorkspace(conversationId);
  // BUGFIX 2026-11-02: only short-circuit when the active row already carries
  // its RESOLVED grouping key. Bindings created before key-at-bind resolution
  // landed had workspaceKey = null; re-running the schedule against the same
  // folder previously kept that stale row forever, and the once-per-process
  // backfill had already run — so the conversation stayed under "Other
  // chats" for the whole session. A null-key active row falls through to the
  // supersede flow, which creates a fresh binding with its resolved key.
  if (active && active.rootPath === canonical && active.workspaceKey) {
    return canonical;
  }
  const record = await module.setWorkspace({
    conversationId,
    rootPath: canonical,
    label: null,
  });
  const approved = await module.approveWorkspace(record.id);
  if (!approved) {
    throw new Error("Failed to approve workspace");
  }
  // BUGFIX 2026-11-02 (Run Now folder refresh): the schedule flows bind the
  // workspace for a conversation that may have NO messages yet, and nothing
  // on the schedule path creates the ai_chat_conversations projection row —
  // getWorkspaceSidebar only renders projected conversations, so the sidebar
  // (manual or event-driven refresh) showed nothing until an app restart.
  // Ensure the row exists with the resolved key; failure is a display hint
  // and must never fail the binding.
  try {
    await new AIChatConversationModule().ensureConversationProjection(
      conversationId,
      record?.workspaceKey ?? null
    );
  } catch (err) {
    console.warn(
      "[ai-workspace] projection ensure after workspace bind failed:",
      err
    );
  }
  return canonical;
}

/** Revoke the conversation's active workspace when the path is cleared. */
export async function clearApprovedWorkspace(
  conversationId: string
): Promise<void> {
  const module = new WorkspaceModule();
  const active = await module.getActiveWorkspace(conversationId);
  if (active) {
    await module.revokeWorkspace(active.id);
  }
}
