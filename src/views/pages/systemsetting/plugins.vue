<template>
  <div>
    <PluginManager />
    <SkillInstallManager class="mt-4" />
  </div>
  <AppPageShell
    page-id="settings-plugins"
    title-key="route.plugins"
    content-width="wide"
  >
    <PluginManager />
  </AppPageShell>
</template>

<script setup lang="ts">
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import PluginManager from "@/views/components/plugins/PluginManager.vue";
import SkillInstallManager from "@/views/components/aiChatV2/SkillInstallManager.vue";
</script>
