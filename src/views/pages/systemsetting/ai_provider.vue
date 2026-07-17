<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t('aiProvider.title') || 'AI Provider' }}</span>
        <v-btn icon size="small" variant="text" @click="goBack">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
        <AIProviderSettingsPanel />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import AIProviderSettingsPanel from "@/views/components/settings/AIProviderSettingsPanel.vue";

const { t } = useI18n();
const router = useRouter();

function goBack(): void {
  router.push({ name: "system_setting_index" });
}
</script>

<style scoped></style>
