<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t('system_settings.mcp_tools') }}</span>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="goBack"
        >
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text style="padding: 0;">
        <!-- Use MCPToolManager with always-open dialog -->
        <MCPToolManager v-model="showManager" />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MCPToolManager from '@/views/components/aiChat/MCPToolManager.vue';

const { t } = useI18n();
const router = useRouter();
const showManager = ref(true);

function goBack() {
  router.push({ name: 'system_setting_index' });
}
</script>

<style scoped>
</style>

