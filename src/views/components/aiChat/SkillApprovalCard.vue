<template>
  <div class="skill-approval-card">
    <div class="approval-header">
      <v-icon size="small" color="warning" class="mr-2">mdi-shield-alert</v-icon>
      <span class="approval-title">Skill Permission Request</span>
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
        This skill requires your permission to execute. It may access external resources or perform actions on your behalf.
      </p>
    </div>
    <div class="approval-actions">
      <v-btn
        size="small"
        variant="text"
        color="error"
        :disabled="isProcessing"
        @click="handleDeny"
      >
        Deny
      </v-btn>
      <v-btn
        size="small"
        variant="outlined"
        color="primary"
        :disabled="isProcessing"
        @click="handleAllowOnce"
      >
        Allow Once
      </v-btn>
      <v-btn
        size="small"
        variant="flat"
        color="primary"
        :loading="isProcessing"
        @click="handleAlwaysAllow"
      >
        Always Allow
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

interface Props {
  toolName: string;
  permissionCategory?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "grant", payload: { persistent: boolean }): void;
  (e: "deny"): void;
}>();

const isProcessing = ref(false);

const categoryColor = computed(() => {
  switch (props.permissionCategory) {
    case "network":
      return "orange";
    case "automation":
      return "purple";
    case "filesystem":
      return "brown";
    default:
      return "grey";
  }
});

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

.approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
