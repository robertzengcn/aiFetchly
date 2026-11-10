<template>
  <AppPageShell
    page-id="settings-managed-browser"
    title-key="route.managed_browser"
    content-width="wide"
  >
    <template #context>
      <button
        type="button"
        class="back-link"
        data-testid="settings-managed-browser-back"
        @click="goBack"
      >
        <v-icon icon="mdi-arrow-left" size="14" aria-hidden="true" />
        {{ t("route.system_setting") }}
      </button>
    </template>
    <ManagedBrowserSettingsPanel />
  </AppPageShell>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import ManagedBrowserSettingsPanel from "@/views/components/settings/ManagedBrowserSettingsPanel.vue";
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";

const { t } = useI18n();
const router = useRouter();

function goBack(): void {
  void router.push("/systemsetting/index");
}
</script>

<style scoped>
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font-size: 0.85rem;
  padding: 0;
}

.back-link:hover {
  text-decoration: underline;
}
</style>
