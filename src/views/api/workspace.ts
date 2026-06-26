import { windowInvoke } from "@/views/utils/apirequest";
import {
  AI_WORKSPACE_SET,
  AI_WORKSPACE_GET,
  AI_WORKSPACE_APPROVE,
  AI_WORKSPACE_REVOKE,
  AI_WORKSPACE_LIST,
} from "@/config/channellist";
import type {
  WorkspaceRecord,
  WorkspaceSummary,
} from "@/entityTypes/workspaceTypes";

export async function setWorkspace(payload: {
  conversationId: string;
  rootPath: string;
  label?: string | null;
}): Promise<WorkspaceRecord | null> {
  return windowInvoke(AI_WORKSPACE_SET, payload);
}

export async function getWorkspace(
  conversationId: string
): Promise<WorkspaceRecord | null> {
  return windowInvoke(AI_WORKSPACE_GET, { conversationId });
}

export async function approveWorkspace(
  id: number
): Promise<WorkspaceRecord | null> {
  return windowInvoke(AI_WORKSPACE_APPROVE, { id });
}

export async function revokeWorkspace(
  id: number
): Promise<WorkspaceRecord | null> {
  return windowInvoke(AI_WORKSPACE_REVOKE, { id });
}

export async function listWorkspaces(
  conversationId: string
): Promise<WorkspaceSummary[]> {
  return windowInvoke(AI_WORKSPACE_LIST, { conversationId });
}
