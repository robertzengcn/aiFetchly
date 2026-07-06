<template>
  <!--
    WorkspaceTrustCard.vue — Phase 14 (Plan 14-04) inline trust prompt (D-03).
    Mirrors the WorkspaceRequiredCard.vue structure (v-card-item header with
    icon, v-card-text body, v-card-actions with v-spacer + buttons). The card
    is rendered inline inside AiChatV2's workspace panel — NOT a modal (too
    intrusive for a trust decision) and NOT a banner (trust must persist).

    TRS-03 options (button order per plan):
      1. Preview                    — toggles expand (main-side AGENTS.md body)
      2. Keep disabled              — text variant (emits 'dismissed', no IPC)
      3. Trust instructions only    — tonal variant
      4. Trust all workspace AI     — primary flat variant

    TRS-07: the renderer NEVER reads .aifetchly/AGENTS.md. Preview content
    comes ONLY through previewWorkspaceAgents (the IPC channel
    AIFETCHLY_WORKSPACE_TRUST_PREVIEW), which returns the file body string
    supplied by the main process.

    i18n: text uses `t('workspaceTrust.x') || 'English fallback'`. The
    workspaceTrust group is added in Plan 14-05; the fallbacks render
    correctly before translations land.
  -->
  <v-card class="workspace-trust-card" elevation="2" rounded border>
    <v-card-item>
      <div class="workspace-trust-card__header">
        <v-icon size="small" color="warning">mdi-shield-lock-outline</v-icon>
        <span class="text-subtitle-1 font-weight-bold">{{ titleText }}</span>
      </div>
    </v-card-item>

    <v-card-text>
      <p class="text-body-2">{{ bodyText }}</p>
      <p v-if="errorText" class="text-error text-body-2 mt-2">
        <v-icon size="small" start>mdi-alert-circle-outline</v-icon>
        {{ errorText }}
      </p>
    </v-card-text>

    <v-expand-transition>
      <pre
        v-if="showPreview"
        data-testid="trust-card-preview-content"
        class="workspace-trust-card__preview"
      >{{ previewContent }}</pre>
    </v-expand-transition>

    <v-card-actions class="workspace-trust-card__actions">
      <v-btn
        data-testid="trust-card-preview-btn"
        :data-loading="previewLoading ? 'true' : 'false'"
        variant="text"
        :loading="previewLoading"
        :disabled="trustLoading"
        @click="onPreview"
      >
        <v-icon start size="small">{{ showPreview ? "mdi-eye-off-outline" : "mdi-eye-outline" }}</v-icon>
        {{ previewButtonText }}
      </v-btn>
      <v-spacer />
      <v-btn
        data-testid="trust-card-keep-disabled-btn"
        data-loading="false"
        variant="text"
        :disabled="trustLoadingScope !== null || previewLoading"
        @click="onKeepDisabled"
      >
        {{ keepDisabledText }}
      </v-btn>
      <v-btn
        data-testid="trust-card-trust-instructions-btn"
        :data-loading="trustLoadingScope === 'instructions' ? 'true' : 'false'"
        variant="tonal"
        :loading="trustLoadingScope === 'instructions'"
        :disabled="previewLoading"
        @click="onTrustInstructions"
      >
        {{ trustInstructionsText }}
      </v-btn>
      <v-btn
        data-testid="trust-card-trust-all-btn"
        :data-loading="trustLoadingScope === 'all' ? 'true' : 'false'"
        color="primary"
        variant="flat"
        :loading="trustLoadingScope === 'all'"
        :disabled="previewLoading"
        @click="onTrustAll"
      >
        {{ trustAllText }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  previewWorkspaceAgents,
  setWorkspaceTrust,
} from "@/views/api/workspaceWatch";
import type { WorkspaceTrustScope } from "@/entityTypes/aiChatV2Types";

// vue-i18n's `t(key)` returns the KEY itself when the translation is missing
// (default behavior), so `t(key) || 'fallback'` never triggers the fallback
// — the user would see "workspaceTrust.preview" as button text in the gap
// between this plan and Plan 14-05 (which adds the translations). The plan's
// stated intent ("the fallbacks make the card render correctly even before
// translations land") requires checking `te()` first; the helper below
// implements that intent. Rule 1 (auto-fix bug) — the literal `t()||fb`
// pattern from the plan does not achieve its own stated goal.
const { t, te } = useI18n();
function localized(key: string, fallback: string): string {
  return te(key) ? t(key) : fallback;
}

/**
 * Props:
 *   - workspaceId: the token returned by acquireWorkspaceWatch (serialised
 *     DB primary key). Used for preview + setTrust. NEVER a filesystem path.
 *   - conversationId: the active chat id. Reserved for forward-compat (the
 *     trust card currently routes everything through workspaceId).
 */
const props = defineProps<{
  workspaceId: string;
  conversationId: string;
}>();

/**
 * Emits:
 *   - 'trusted' with the scope ("instructions" | "all") — parent hides the
 *     card and persists the trust state via the existing workspace state.
 *   - 'dismissed' — parent hides the card and persists the dismissal so it
 *     does not reappear on every chat open (Plan 14-04 Task 2 wires this in
 *     AiChatV2.vue; Phase 17 replaces the persistence layer with the
 *     per-capability AIFetchlyWorkspaceTrust entity).
 */
const emit = defineEmits<{
  (e: "trusted", scope: WorkspaceTrustScope): void;
  (e: "dismissed"): void;
}>();

// Static labels. Computed once via the `localized` helper so the fallback
// fires when the workspaceTrust i18n group is absent (Plan 14-05 adds it).
const titleText = localized(
  "workspaceTrust.title",
  "Workspace AiFetchly configuration"
);
const bodyText = localized(
  "workspaceTrust.body",
  "This workspace defines AiFetchly configuration. Review it before enabling its commands."
);
const previewButtonText = localized("workspaceTrust.preview", "Preview");
const keepDisabledText = localized(
  "workspaceTrust.keepDisabled",
  "Keep disabled"
);
const trustInstructionsText = localized(
  "workspaceTrust.trustInstructions",
  "Trust instructions only"
);
const trustAllText = localized(
  "workspaceTrust.trustAll",
  "Trust all workspace AI config"
);

// Preview state — fetched ONCE on first expand, then cached. Subsequent
// toggles just show/hide the existing content (no re-fetch).
const showPreview = ref(false);
const previewContent = ref<string>("");
const previewLoading = ref(false);
const previewFetched = ref(false);

// Trust-button loading state. trustLoadingScope is null when no trust IPC
// is in flight, otherwise the scope of the in-flight call.
const trustLoadingScope = ref<WorkspaceTrustScope | null>(null);

// Error text surfaced inline (non-fatal). Set when an IPC call rejects.
const errorText = ref<string | null>(null);

async function onPreview(): Promise<void> {
  // Toggle visibility.
  if (showPreview.value) {
    showPreview.value = false;
    return;
  }
  // Expand.
  errorText.value = null;
  // First expansion: fetch the AGENTS.md body via the main process (TRS-07).
  if (!previewFetched.value) {
    previewLoading.value = true;
    try {
      previewContent.value = await previewWorkspaceAgents(props.workspaceId);
      previewFetched.value = true;
    } catch (err) {
      errorText.value =
        err instanceof Error ? err.message : "Failed to load preview.";
      // Failed fetch does NOT flip previewFetched — the user can retry.
      return;
    } finally {
      previewLoading.value = false;
    }
  }
  showPreview.value = true;
}

function onKeepDisabled(): void {
  // No IPC — dismissal persistence is the parent's responsibility.
  emit("dismissed");
}

async function onTrustInstructions(): Promise<void> {
  await trust("instructions");
}

async function onTrustAll(): Promise<void> {
  await trust("all");
}

async function trust(scope: WorkspaceTrustScope): Promise<void> {
  errorText.value = null;
  trustLoadingScope.value = scope;
  try {
    const result = await setWorkspaceTrust({
      workspaceId: props.workspaceId,
      scope,
    });
    if (!result.ok) {
      // Concurrent revoke — record vanished mid-flight. Keep the card
      // visible so the user can retry (or the parent can re-resolve).
      errorText.value = localized(
        "workspaceTrust.trustFailed",
        "Failed to update trust. Please try again."
      );
      return;
    }
    emit("trusted", scope);
  } catch (err) {
    errorText.value =
      err instanceof Error
        ? err.message
        : localized(
            "workspaceTrust.trustFailed",
            "Failed to update trust."
          );
  } finally {
    trustLoadingScope.value = null;
  }
}
</script>

<style scoped>
.workspace-trust-card {
  width: 100%;
}
.workspace-trust-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.workspace-trust-card__actions {
  padding: 8px 16px;
  flex-wrap: wrap;
  gap: 4px;
}
.workspace-trust-card__preview {
  margin: 0 16px 8px 16px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
