// src/views/api/localAiRuntime.ts
import { windowInvoke } from "@/views/utils/apirequest";
import {
  LOCAL_AI_RUNTIME_LIST,
  LOCAL_AI_RUNTIME_STATUS,
  LOCAL_AI_RUNTIME_PREPARE_INSTALL,
  LOCAL_AI_RUNTIME_INSTALL,
  LOCAL_AI_RUNTIME_CANCEL_INSTALL,
  LOCAL_AI_RUNTIME_CHECK_UPDATE,
  LOCAL_AI_RUNTIME_REPAIR,
  LOCAL_AI_RUNTIME_REMOVE,
  LOCAL_AI_RUNTIME_PROGRESS,
} from "@/config/channellist";
import type {
  LocalAiRuntimeDownloadProgress,
  LocalAiRuntimeId,
  LocalAiRuntimeInstallOffer,
  LocalAiRuntimeInstallRequest,
  LocalAiRuntimeInstallResult,
  LocalAiRuntimeStatus,
  LocalAiRuntimeUpdateOffer,
} from "@/entityTypes/localAiRuntimeTypes";

export async function listLocalAiRuntimes(): Promise<LocalAiRuntimeStatus[]> {
  const resp = await windowInvoke(LOCAL_AI_RUNTIME_LIST);
  return (resp as LocalAiRuntimeStatus[]) ?? [];
}

export async function getLocalAiRuntimeStatus(
  runtimeId: LocalAiRuntimeId,
): Promise<LocalAiRuntimeStatus> {
  return (await windowInvoke(LOCAL_AI_RUNTIME_STATUS, { runtimeId })) as LocalAiRuntimeStatus;
}

export async function prepareLocalAiRuntimeInstall(
  runtimeId: LocalAiRuntimeId,
): Promise<LocalAiRuntimeInstallOffer> {
  return (await windowInvoke(LOCAL_AI_RUNTIME_PREPARE_INSTALL, {
    runtimeId,
  })) as LocalAiRuntimeInstallOffer;
}

export async function installLocalAiRuntime(
  input: LocalAiRuntimeInstallRequest,
): Promise<LocalAiRuntimeInstallResult> {
  return (await windowInvoke(LOCAL_AI_RUNTIME_INSTALL, input)) as LocalAiRuntimeInstallResult;
}

export async function cancelLocalAiRuntimeInstall(
  operationId: string,
): Promise<{ cancelled: boolean }> {
  return (await windowInvoke(LOCAL_AI_RUNTIME_CANCEL_INSTALL, {
    operationId,
  })) as { cancelled: boolean };
}

export async function checkLocalAiRuntimeUpdate(
  runtimeId: LocalAiRuntimeId,
): Promise<LocalAiRuntimeUpdateOffer | null> {
  return ((await windowInvoke(LOCAL_AI_RUNTIME_CHECK_UPDATE, {
    runtimeId,
  })) as LocalAiRuntimeUpdateOffer | null) ?? null;
}

export async function repairLocalAiRuntime(
  runtimeId: LocalAiRuntimeId,
): Promise<LocalAiRuntimeInstallResult> {
  return (await windowInvoke(LOCAL_AI_RUNTIME_REPAIR, { runtimeId })) as LocalAiRuntimeInstallResult;
}

export async function removeLocalAiRuntime(
  runtimeId: LocalAiRuntimeId,
  removeModels: boolean,
): Promise<{ removed: boolean }> {
  return (await windowInvoke(LOCAL_AI_RUNTIME_REMOVE, {
    runtimeId,
    removeModels,
  })) as { removed: boolean };
}

/**
 * Subscribe to install/repair/update progress events. Returns an unsubscribe
 * function that removes the stable wrapper reference (preload pattern).
 */
export function onLocalAiRuntimeProgress(
  callback: (progress: LocalAiRuntimeDownloadProgress) => void,
): () => void {
  const handler = (progress: unknown): void => {
    callback(progress as LocalAiRuntimeDownloadProgress);
  };
  window.api.receive(LOCAL_AI_RUNTIME_PROGRESS, handler);
  return () => {
    window.api.removeListener(LOCAL_AI_RUNTIME_PROGRESS, handler);
  };
}
