import { defineStore } from "pinia";
import { ref } from "vue";
import type { OpenAIModel } from "@/api/aiChatApi";

/**
 * Shared model-catalog projection (R8 P2-11, FR-REC-005).
 *
 * The context-usage denominator must be THE SAME map everywhere it renders:
 * the composer badge (center surface) and the Context inspector (mounted by
 * the app-shell adapter, which cannot receive surface props). This store is
 * the pass-through the loader publishes to and both renderers read from —
 * one source, so the two percents cannot disagree for the same token count.
 *
 * It deliberately does NOT own the loading lifecycle: each shell keeps its
 * own bounded `loadModels` (loading states, saved-model resolution) and
 * publishes here.
 */
export const useChatModelsStore = defineStore("chatModels", () => {
  /** Model id → context window size (tokens); empty until a loader runs. */
  const modelContextWindows = ref<Map<string, number>>(new Map());
  /** Model id the percent denominator resolves against. */
  const selectedModelId = ref<string | undefined>(undefined);

  /**
   * Publish the loaded catalog. `selectedModel` wins over `defaultModel`
   * when both are given (the user's explicit choice is the live denominator).
   */
  function publishModelCatalog(
    windows: Map<string, number>,
    selectedModel?: string,
    defaultModel?: string
  ): void {
    modelContextWindows.value = windows;
    selectedModelId.value = selectedModel ?? defaultModel;
  }

  /** Keep the denominator in sync when the user changes the model. */
  function setSelectedModelId(model?: string): void {
    selectedModelId.value = model;
  }

  return {
    modelContextWindows,
    selectedModelId,
    publishModelCatalog,
    setSelectedModelId,
  };
});
