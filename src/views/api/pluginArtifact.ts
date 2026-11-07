import { windowInvoke } from "@/views/utils/apirequest";
import {
  PLUGIN_ARTIFACT_DELETE,
  PLUGIN_ARTIFACT_EXPORT,
  PLUGIN_ARTIFACT_LIST,
  PLUGIN_ARTIFACT_PREVIEW,
  PLUGIN_ARTIFACT_LIST_JOURNAL,
} from "@/config/channellist";

/**
 * Renderer API for host-owned plugin file artifacts (design §13.4).
 *
 * The renderer never receives a filesystem path and never supplies one:
 * export runs through the host's native save dialog, and every operation is
 * scoped to a conversation id that the host verifies against artifact
 * ownership. Artifact ids arrive from host-written metadata (`pa_…`), not
 * from user input.
 *
 * `windowInvoke` throws when the host reports failure; the machine messages
 * are user-translatable outcomes, never raw plugin names or MIME types.
 */

export interface PluginArtifactView {
  id: string;
  format: "json" | "csv";
  recordCount: number;
  sizeBytes?: number;
  createdAt?: string;
  expiresAt?: string;
}

/** Host-registered plugin artifacts for this conversation, oldest first. */
export async function listPluginArtifacts(
  conversationId: string
): Promise<PluginArtifactView[]> {
  return (await windowInvoke(PLUGIN_ARTIFACT_LIST, {
    conversationId,
  })) as PluginArtifactView[];
}

export interface PluginArtifactPreview {
  ok: boolean;
  error?: string;
  format?: "json" | "csv";
  rows?: string;
  /** True when the host capped rows/bytes for this preview (B01). */
  truncated?: boolean;
}

/** Bounded preview (first rows only; never the whole artifact). */
export async function previewPluginArtifact(
  conversationId: string,
  artifactId: string
): Promise<PluginArtifactPreview> {
  return (await windowInvoke(PLUGIN_ARTIFACT_PREVIEW, {
    conversationId,
    artifactId,
  })) as PluginArtifactPreview;
}

export interface PluginArtifactExportResult {
  cancelled: boolean;
  sizeBytes?: number;
}

/** Export through the NATIVE save dialog (the renderer supplies no path). */
export async function exportPluginArtifact(
  conversationId: string,
  artifactId: string
): Promise<PluginArtifactExportResult> {
  return (await windowInvoke(PLUGIN_ARTIFACT_EXPORT, {
    conversationId,
    artifactId,
  })) as PluginArtifactExportResult;
}

/** Delete an owned artifact (host verifies conversation ownership). */
export async function deletePluginArtifact(
  conversationId: string,
  artifactId: string
): Promise<{ deleted: boolean }> {
  return (await windowInvoke(PLUGIN_ARTIFACT_DELETE, {
    conversationId,
    artifactId,
  })) as { deleted: boolean };
}

/** G03: interrupted/recovered execution journals for this conversation. */
export interface PluginExecutionJournalView {
  executionId: string;
  status: "running" | "degraded" | "interrupted" | "complete" | "failed" | string;
  at: string | null;
  pluginName: string | null;
  registeredCount: number;
  message: string | null;
}

export async function listPluginExecutionJournals(
  conversationId: string
): Promise<PluginExecutionJournalView[]> {
  return (await windowInvoke(PLUGIN_ARTIFACT_LIST_JOURNAL, {
    conversationId,
  })) as PluginExecutionJournalView[];
}
