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
    </div>
    <div class="approval-actions">
      <v-btn
        size="small"
        variant="text"
        color="error"
        :disabled="isProcessing"
        @click="handleDeny"
      >
        {{ t('skills.approval_deny') }}
      </v-btn>
      <v-btn
        size="small"
        variant="outlined"
        color="primary"
        :disabled="isProcessing"
        @click="handleAllowOnce"
      >
        {{ t('skills.approval_allow_once') }}
      </v-btn>
      <!-- Shell skills do not support persistent grants -->
      <v-btn
        v-if="!isShellCategory"
        size="small"
        variant="flat"
        color="primary"
        :loading="isProcessing"
        @click="handleAlwaysAllow"
      >
        {{ t('skills.approval_always_allow') }}
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

interface Props {
  toolName: string;
  permissionCategory?: string;
  shellPreview?: ShellPreview;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "grant", payload: { persistent: boolean }): void;
  (e: "deny"): void;
}>();

const isProcessing = ref(false);

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
  isProcessing.value = true;
  try {
    await window.api.invoke("skill:grant-permission", {
      skillName: props.toolName,
      persistent: true,
    });
    emit("grant", { persistent: true });
  } finally {
    isProcessing.value = false;
  }
}

async function handleDeny(): Promise<void> {
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

.approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
