<template>
  <AppPageShell
    page-id="settings-mcp"
    title-key="route.mcp_tools"
    content-width="wide"
  >
    <template #context>
      <button
        type="button"
        class="back-link"
        data-testid="settings-mcp-back"
        @click="goBack"
      >
        <v-icon icon="mdi-arrow-left" size="14" aria-hidden="true" />
        {{ t('route.system_setting') }}
      </button>
    </template>
    <!-- Use MCPToolManager with always-open dialog -->
    <MCPToolManager v-model="showManager" />
  </AppPageShell>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MCPToolManager from '@/views/components/aiChat/MCPToolManager.vue';
import AppPageShell from '@/views/components/pageTemplates/AppPageShell.vue';

const { t } = useI18n();
const router = useRouter();
const showManager = ref(true);

function goBack() {
  router.push({ name: 'system_setting_index' });
}
</script>
