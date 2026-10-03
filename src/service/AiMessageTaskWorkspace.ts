import fs from "node:fs/promises";
import path from "node:path";
import { WorkspaceModule } from "@/modules/WorkspaceModule";

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
  if (active && active.rootPath === canonical) {
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
