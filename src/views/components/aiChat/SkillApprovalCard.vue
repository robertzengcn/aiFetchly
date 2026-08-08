<template>
  <div class="skill-approval-card">
    <div class="approval-header">
      <v-icon size="small" color="warning" class="mr-2">mdi-shield-alert</v-icon>
      <span class="approval-title">{{
        isShellCategory
          ? t('skills.shell_approval_title')
          : t('skills.approval_title')
      }}</span>
    </div>
    <div class="approval-body">
      <div class="skill-info">
        <v-chip size="small" color="primary" variant="tonal" class="mr-2">
          {{ toolName }}
        </v-chip>
        <v-chip v-if="permissionCategory" size="small" :color="categoryColor" variant="outlined">
          {{ permissionCategory }}
        </v-chip>
      </div>
      <p class="approval-description mt-2">
        {{
          isShellCategory
            ? t('skills.shell_approval_description')
            : t('skills.approval_description')
        }}
      </p>
      <!-- Filesystem workspace preview -->
      <div v-if="workspaceRoot" class="skill-approval__fs mt-2">
        <v-icon size="small" start>mdi-folder</v-icon>
        <span class="text-caption">{{ workspaceRoot }}</span>
        <span v-if="relativePath" class="text-caption text--secondary font-italic"> / {{ relativePath }}</span>
      </div>
      <!-- Shell command preview -->
      <div v-if="isShellCategory && shellPreview" class="shell-preview mt-3">
        <div class="shell-preview-row">
          <span class="shell-preview-label">{{ t('skills.shell_command_label') }}:</span>
          <code class="shell-preview-value shell-command-code">{{ shellPreview.command }}</code>
        </div>
        <div v-if="shellPreview.cwd" class="shell-preview-row">
          <span class="shell-preview-label">{{ t('skills.shell_cwd_label') }}:</span>
          <code class="shell-preview-value">{{ shellPreview.cwd }}</code>
        </div>
        <div class="shell-preview-row">
          <span class="shell-preview-label">{{ t('skills.shell_type_label') }}:</span>
          <code class="shell-preview-value">{{ shellPreview.shell }}</code>
        </div>
        <div class="shell-preview-row">
          <span class="shell-preview-label">{{ t('skills.shell_timeout_label') }}:</span>
          <code class="shell-preview-value">{{ formatTimeout(shellPreview.timeout_ms) }}</code>
        </div>
      </div>
      <!-- File-transfer permission preview (e.g. attach_local_images) -->
      <div v-if="permissionPreview" class="permission-preview mt-3">
        <div class="permission-preview-row permission-preview-title">
          {{ t(permissionPreview.titleKey) }}
        </div>
        <div class="permission-preview-row permission-preview-desc">
          {{
            t(permissionPreview.descriptionKey, {
              destination: permissionPreview.destinationLabel,
            })
          }}
        </div>
        <div
          v-for="(item, i) in permissionPreview.items"
          :key="i"
          class="permission-preview-row"
        >
          <v-icon size="x-small" start>mdi-file-image</v-icon>
          <code class="permission-preview-item">{{ item }}</code>
        </div>
      </div>
    </div>
    <div class="approval-actions">
      <v-btn
        size="small"
        variant="text"
        color="error"
        :disabled="isDisabled"
        @click="handleDeny"
      >
        {{ t('skills.approval_deny') }}
      </v-btn>
      <v-btn
        size="small"
        variant="outlined"
        color="primary"
        :disabled="isDisabled"
        @click="handleAllowOnce"
      >
        {{ t('skills.approval_allow_once') }}
      </v-btn>
      <v-btn
        size="small"
        variant="flat"
        color="primary"
        :loading="isLoading"
        :disabled="isDisabled"
        @click="handleAlwaysAllow"
      >
        {{ isShellCategory ? t('skills.approval_always_allow_session') : t('skills.approval_always_allow') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

interface ShellPreview {
  command: string;
  cwd?: string;
  shell: string;
  timeout_ms: number;
}

/**
 * Metadata-only, display-only preview for tools that transfer local files
 * off-device (e.g. attach_local_images). Lets the approval card describe the
 * call beyond the generic category prompt — which files, and where they go.
 * `items` are unvalidated requested values; the tool re-validates after grant.
 */
interface PermissionPreview {
  kind: "file_transfer";
  titleKey: string;
  descriptionKey: string;
  items: readonly string[];
  destinationLabel: string;
}

interface Props {
  toolName: string;
  permissionCategory?: string;
  shellPreview?: ShellPreview;
  permissionPreview?: PermissionPreview;
  workspaceRoot?: string;
  relativePath?: string;
  disabled?: boolean;
  loading?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "grant", payload: { persistent: boolean }): void;
  (e: "deny"): void;
}>();

const isProcessing = ref(false);
const isLoading = computed(() => isProcessing.value || props.loading === true);
const isDisabled = computed(() => isLoading.value || props.disabled === true);

const isShellCategory = computed(() => props.permissionCategory === "shell");

const categoryColor = computed(() => {
  switch (props.permissionCategory) {
    case "network":
      return "orange";
    case "automation":
      return "purple";
    case "filesystem":
      return "brown";
    case "shell":
      return "red-darken-2";
    default:
      return "grey";
  }
});

function formatTimeout(ms: number): string {
  if (ms >= 60000) {
    return `${Math.round(ms / 1000)}s`;
  }
  return `${ms}ms`;
}

async function handleAllowOnce(): Promise<void> {
  if (isDisabled.value) return;
  isProcessing.value = true;
  try {
    await window.api.invoke("skill:grant-permission", {
      skillName: props.toolName,
      persistent: false,
    });
    emit("grant", { persistent: false });
  } finally {
    isProcessing.value = false;
  }
}

async function handleAlwaysAllow(): Promise<void> {
  if (isDisabled.value) return;
  isProcessing.value = true;
  try {
    // Shell "Always Allow" is session-only for safety; other categories persist.
    const persistent = !isShellCategory.value;
    await window.api.invoke("skill:grant-permission", {
      skillName: props.toolName,
      persistent,
    });
    emit("grant", { persistent });
  } finally {
    isProcessing.value = false;
  }
}

async function handleDeny(): Promise<void> {
  if (isDisabled.value) return;
  isProcessing.value = true;
  try {
    await window.api.invoke("skill:deny-permission", {
      skillName: props.toolName,
    });
    emit("deny");
  } finally {
    isProcessing.value = false;
  }
}
</script>

<style scoped>
.skill-approval-card {
  border: 1px solid rgb(var(--v-theme-warning), 0.4);
  border-radius: 8px;
  padding: 12px;
  margin: 8px 0;
  background: rgb(var(--v-theme-surface-variant));
}

.approval-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.approval-title {
  font-weight: 600;
  font-size: 0.9rem;
}

.approval-body {
  margin-bottom: 12px;
}

.skill-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.approval-description {
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 0;
}

.skill-approval__fs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  word-break: break-all;
}

.font-italic {
  font-style: italic;
}

.shell-preview {
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.shell-preview-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.82rem;
}

.shell-preview-label {
  color: rgba(var(--v-theme-on-surface), 0.6);
  min-width: 100px;
  flex-shrink: 0;
}

.shell-preview-value {
  font-size: 0.82rem;
  word-break: break-all;
}

.shell-command-code {
  font-weight: 600;
  color: rgb(var(--v-theme-error));
}

.permission-preview {
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.permission-preview-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
}

.permission-preview-title {
  font-weight: 600;
}

.permission-preview-desc {
  color: rgba(var(--v-theme-on-surface), 0.7);
  align-items: flex-start;
}

.permission-preview-item {
  font-size: 0.8rem;
  word-break: break-all;
  /* Clamp long paths so a wide path never resizes the approval card. */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.approval-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

/* On very narrow chat boxes, allow individual button text to wrap so a
   single long button (e.g. "Always allow this session") never overflows. */
.approval-actions :deep(.v-btn) {
  flex-shrink: 1;
  min-width: 0;
}

.approval-actions :deep(.v-btn__content) {
  white-space: normal;
  line-height: 1.1;
}
</style>
