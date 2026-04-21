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
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import type { ResolveSystemDependencyOutput } from "@/entityTypes/systemDependencyTypes";
import {
  onDependencyPrompt,
  respondToDependencyPrompt,
  type DependencyPromptPayload,
} from "@/views/api/systemDependency";

const { t } = useI18n();

const props = defineProps<{
  visible: boolean;
  recommendation: ResolveSystemDependencyOutput | null;
  conversationId: string;
  skillName: string;
}>();

const emit = defineEmits<{
  (e: "result", data: { approved: boolean; status?: string }): void;
  (e: "update:visible", value: boolean): void;
}>();

const loading = ref(false);
/** The toolId from the main process prompt — needed to send the response back. */
const pendingToolId = ref<string | null>(null);

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

/** Unsubscribe function for the prompt listener. */
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  unsubscribe = onDependencyPrompt((payload: DependencyPromptPayload) => {
    pendingToolId.value = payload.toolId;
    // The parent component should update visible/recommendation props
    // when this event is received via a separate event emitted upward.
    // For now, directly update the visible state and emit the payload up.
    emit("update:visible", true);
  });
});

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
});

async function approve(): Promise<void> {
  if (!pendingToolId.value) return;
  loading.value = true;
  try {
    const response = await respondToDependencyPrompt(
      pendingToolId.value,
      true
    );
    emit("result", {
      approved: true,
      status: response.ok ? "installed" : "installation_failed",
    });
  } catch {
    emit("result", { approved: true, status: "installation_failed" });
  } finally {
    loading.value = false;
    pendingToolId.value = null;
    emit("update:visible", false);
  }
}

function deny(): void {
  if (pendingToolId.value) {
    void respondToDependencyPrompt(pendingToolId.value, false);
  }
  pendingToolId.value = null;
  emit("result", { approved: false });
  emit("update:visible", false);
}
</script>
