import { ref, computed, type Ref } from "vue";
import {
  fetchWorkspaceRolloutFlags,
} from "@/views/api/aiChatWorkspace";

/**
 * Workspace rollout adapters (design §23.1/§23.2, A02):
 * independently controllable presentation/dispatch controls loaded from the
 * main-process rollout flags through the shared set-flag IPC channel.
 *
 * Each adapter answer only changes which optional surfaces render or which
 * dispatch path takes a send — never authorization rules, durable rows, or
 * persisted identity formats. Values resolve once per renderer session;
 * an unreadable response keeps the shipped default (adapters ON) because a
 * transport failure must never silently roll a user back (§23.2 rollback is
 * a deliberate operator action, not an error fallback).
 */
export interface WorkspaceRolloutAdaptersState {
  /** Shared command routing + goal/loop/skill orchestration adapters. */
  readonly sharedOrchestration: Ref<boolean>;
  /** Specialized installation/artifact/report result surfaces. */
  readonly specializedResults: Ref<boolean>;
  /** Voice controls + workspace memory/trust panels. */
  readonly voiceMemory: Ref<boolean>;
  /** True until the first IPC result lands (prevents flash-of-hidden panel). */
  readonly loading: Ref<boolean>;
}

let sharedState: {
  sharedOrchestration: Ref<boolean>;
  specializedResults: Ref<boolean>;
  voiceMemory: Ref<boolean>;
  loading: Ref<boolean>;
  hydrated: boolean;
} | null = null;

async function hydrate(
  state: NonNullable<typeof sharedState>
): Promise<void> {
  try {
    const flags = await fetchWorkspaceRolloutFlags();
    if (flags) {
      // Transport/shape failure keeps defaults; an explicit "false" rolls
      // that adapter back independently.
      state.sharedOrchestration.value = flags.adapters.sharedOrchestration;
      state.specializedResults.value = flags.adapters.specializedResults;
      state.voiceMemory.value = flags.adapters.voiceMemory;
    }
    state.hydrated = true;
  } catch {
    state.hydrated = true;
  } finally {
    state.loading.value = false;
  }
}

/**
 * Module-cached adapter state: every mounted center surface shares one
 * hydration so selection changes and route remounts never re-read IPC.
 */
export function useWorkspaceRolloutAdapters(): WorkspaceRolloutAdaptersState {
  if (!sharedState) {
    sharedState = {
      sharedOrchestration: ref(true),
      specializedResults: ref(true),
      voiceMemory: ref(true),
      loading: ref(true),
      hydrated: false,
    };
    void hydrate(sharedState);
  }
  const state = sharedState;
  return {
    sharedOrchestration: computed(() => state.sharedOrchestration.value),
    specializedResults: computed(() => state.specializedResults.value),
    voiceMemory: computed(() => state.voiceMemory.value),
    loading: computed(() => state.loading.value),
  };
}

/** Test seam: drop the module cache (next call hydrates fresh). */
export function resetWorkspaceRolloutAdaptersForTest(): void {
  sharedState = null;
}
