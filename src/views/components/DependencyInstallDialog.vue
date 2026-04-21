<template>
  <v-card v-if="visible" class="dependency-install-dialog pa-4" elevation="2">
    <v-card-title class="text-h6">
      {{ t('systemDependency.dialog_title') || 'Install System Dependency' }}
    </v-card-title>

    <v-card-text>
      <p class="text-body-2 mb-2">
        {{ reason }}
      </p>

      <v-alert type="info" variant="tonal" density="compact" class="mb-3">
        <strong>{{ dependencyName }}</strong>
        <br />
        <code>{{ installCommand }}</code>
      </v-alert>

      <p class="text-caption text-medium-emphasis">
        {{ t('systemDependency.security_note') || 'Only trusted packages from the local catalog are installed.' }}
      </p>
    </v-card-text>

    <v-card-actions>
      <v-spacer />
      <v-btn variant="text" @click="deny">
        {{ t('systemDependency.deny') || 'Deny' }}
      </v-btn>
      <v-btn color="primary" variant="flat" @click="approve" :loading="loading">
        {{ t('systemDependency.approve') || 'Approve Install' }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ResolveSystemDependencyOutput } from "@/entityTypes/systemDependencyTypes";
import { installSystemDependency } from "@/views/api/systemDependency";

const { t } = useI18n();

const props = defineProps<{
  visible: boolean;
  recommendation: ResolveSystemDependencyOutput | null;
  conversationId: string;
  skillName: string;
}>();

const emit = defineEmits<{
  (e: "result", data: { approved: boolean; status?: string }): void;
}>();

const loading = ref(false);

const dependencyName = computed(() => {
  if (!props.recommendation) return "";
  return `${props.recommendation.dependency_id} (${props.recommendation.missing_binary})`;
});

const reason = computed(() => props.recommendation?.reason ?? "");

const installCommand = computed(() => {
  if (!props.recommendation?.platform_candidates) return "";
  const platform =
    navigator.platform?.toLowerCase().includes("mac") ? "darwin"
    : navigator.platform?.toLowerCase().includes("win") ? "win32"
    : "linux";
  const candidate = props.recommendation.platform_candidates[platform];
  if (!candidate) return "";
  switch (candidate.manager) {
    case "brew":
      return `brew install ${candidate.package}`;
    case "apt":
      return `sudo apt-get install -y ${candidate.package}`;
    case "winget":
      return `winget install --id ${candidate.package}`;
    default:
      return `${candidate.manager} install ${candidate.package}`;
  }
});

import { computed } from "vue";

async function approve(): Promise<void> {
  if (!props.recommendation?.dependency_id) return;
  loading.value = true;
  try {
    const response = await installSystemDependency({
      dependency_id: props.recommendation.dependency_id,
      reason: props.recommendation.reason,
      conversation_id: props.conversationId,
      skill_name: props.skillName,
    });
    emit("result", {
      approved: true,
      status: response.data?.install_status ?? "installation_failed",
    });
  } catch {
    emit("result", { approved: true, status: "installation_failed" });
  } finally {
    loading.value = false;
  }
}

function deny(): void {
  emit("result", { approved: false });
}
</script>
