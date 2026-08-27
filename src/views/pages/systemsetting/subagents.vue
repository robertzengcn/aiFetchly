<template>
  <AppPageShell
    page-id="settings-subagents"
    title-key="route.subagents"
    content-width="wide"
  >
    <AgentManager />
  </AppPageShell>
</template>

<script setup lang="ts">
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import AgentManager from "@/views/components/agents/AgentManager.vue";
</script>
