<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t('skills.title') }}</span>
        <v-btn icon size="small" variant="text" @click="goBack">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <!-- Loading -->
        <div v-if="isLoading" class="text-center pa-4">
          <v-progress-circular indeterminate color="primary"></v-progress-circular>
          <p class="mt-2">{{ t('common.loading') }}</p>
        </div>

        <!-- Empty state -->
        <div v-else-if="skills.length === 0" class="text-center pa-4">
          <v-icon size="64" color="grey-lighten-2">mdi-view-dashboard</v-icon>
          <p class="mt-4 text-grey">{{ t('skills.no_skill_installed') }}</p>
          <p class="text-grey">{{ t('skills.no_skill_description') }}</p>
          <v-btn color="primary" class="mt-4" @click="triggerImport">
            <v-icon left>mdi-upload</v-icon>
            {{ t('skills.import_button') }}
          </v-btn>
        </div>

        <!-- Skills table -->
        <div v-else>
          <div class="d-flex justify-end mb-4">
            <v-btn color="primary" variant="outlined" @click="triggerImport">
              <v-icon left>mdi-upload</v-icon>
              {{ t('skills.import_button') }}
            </v-btn>
          </div>

          <v-table>
            <thead>
              <tr>
                <th>{{ t('skills.column_name') }}</th>
                <th>{{ t('skills.column_source') }}</th>
                <th>{{ t('skills.column_category') }}</th>
                <th>{{ t('skills.column_version') }}</th>
                <th>{{ t('skills.column_status') }}</th>
                <th>{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="skill in skills" :key="skill.name">
                <td>
                  {{ skill.name }}
                  <v-chip
                    v-if="skill.pluginName"
                    size="x-small"
                    color="info"
                    class="ml-2"
                  >
                    {{ t("plugins.via_plugin", { name: skill.pluginName }) }}
                  </v-chip>
                </td>
                <td>
                  <v-chip :color="skill.source === 'built-in' ? 'primary' : 'secondary'" size="small">
                    {{ skill.source === 'built-in' ? t('skills.built_in') : t('skills.user_installed') }}
                  </v-chip>
                </td>
                <td>{{ skill.category }}</td>
                <td>{{ skill.version }}</td>
                <td>
                  <v-chip :color="skill.enabled ? 'success' : 'grey'" size="small">
                    {{ skill.enabled ? t('skills.column_enabled') : t('skills.column_disabled') }}
                  </v-chip>
                </td>
                <td>
                  <v-btn-toggle
                    v-if="skill.source !== 'built-in'"
                    v-model="skill.enabled"
                    color="primary"
                    variant="outlined"
                    density="compact"
                    split
                    @update:model-value="handleToggle(skill)"
                  >
                    <v-btn :value="true" size="small">
                      <v-icon>mdi-check</v-icon>
                    </v-btn>
                    <v-btn :value="false" size="small">
                      <v-icon>mdi-close</v-icon>
                    </v-btn>
                  </v-btn-toggle>
                  <v-btn
                    v-if="skill.source !== 'built-in'"
                    icon
                    size="small"
                    variant="text"
                    color="error"
                    @click="handleUninstall(skill)"
                  >
                    <v-icon>mdi-delete</v-icon>
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card-text>
    </v-card>

    <!-- Import dialog -->
    <input
      ref="fileInput"
      type="file"
      accept=".zip"
      style="display: none"
      @change="handleFileSelect"
    />
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

const { t } = useI18n();
const router = useRouter();

interface SkillEntry {
  name: string;
  source: string;
  category: string;
  version: string;
  enabled: boolean;
  manifestJson?: string;
  pluginName?: string;
}

const isLoading = ref(false);
const skills = ref<SkillEntry[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

async function fetchSkills(): Promise<void> {
  isLoading.value = true;
  try {
    const response = await window.api.invoke("skill:list-installed", {});
    if (response.status && Array.isArray(response.data?.skills)) {
      skills.value = response.data.skills.map((s: Record<string, unknown>) => ({
        name: String(s.name),
        source: String(s.source),
        category: JSON.parse(String(s.manifest_json || "{}")).permissions?.[0] || "pure",
        version: String(s.version),
        enabled: s.enabled === 1,
        manifestJson: String(s.manifest_json ?? ""),
        pluginName: s.pluginName ? String(s.pluginName) : undefined,
      }));
    }
  } finally {
    isLoading.value = false;
  }
}

async function handleToggle(skill: SkillEntry): Promise<void> {
  try {
    const response = await window.api.invoke("skill:toggle", {
      skillName: skill.name,
      enabled: skill.enabled,
    });
    if (response.status) {
      await fetchSkills();
    }
  } catch (error) {
    console.error("Toggle error:", error);
  }
}

async function handleUninstall(skill: SkillEntry): Promise<void> {
  if (!confirm(t('skills.uninstall_confirm'))) return;
  try {
    const response = await window.api.invoke("skill:uninstall", {
      skillName: skill.name,
    });
    if (response.status) {
      await fetchSkills();
    }
  } catch (error) {
    console.error("Uninstall error:", error);
  }
}

function triggerImport(): void {
  const input = fileInput.value;
  if (!input) return;
  // Allow selecting the same ZIP again: `change` only fires when the value differs.
  input.value = "";
  input.click();
}

async function handleFileSelect(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  try {
    if (!file) return;

    const zipPath = window.api.getPathForFile(file);
    const response = await window.api.invoke("skill:import", {
      zipPath,
    });
    if (response.status) {
      await fetchSkills();
    } else {
      alert(response.msg || t('skills.import_error'));
    }
  } catch (error) {
    alert(t('skills.import_error'));
  } finally {
    // Reset again so the next open + same file selection always fires `change`.
    target.value = "";
  }
}

function goBack(): void {
  router.push({ name: "system_setting_index" });
}

onMounted(() => {
  fetchSkills();
});
</script>
