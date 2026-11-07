<template>
  <AppPageShell
    page-id="settings-plugins"
    title-key="route.plugins"
    content-width="full"
  >
    <PluginManager />
    <!-- FR-SKL-006: installation management stays on the existing Plugins
         settings page; conversations never embed their own manager. -->
    <SkillInstallManager class="mt-4" />
  </AppPageShell>
</template>

<script setup lang="ts">
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import PluginManager from "@/views/components/plugins/PluginManager.vue";
import SkillInstallManager from "@/views/components/aiChatV2/SkillInstallManager.vue";
</script>
