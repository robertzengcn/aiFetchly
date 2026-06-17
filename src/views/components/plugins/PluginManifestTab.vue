<template>
  <pre>{{ JSON.stringify(detail.manifest, null, 2) }}</pre>
</template>

<script setup lang="ts">
import type { PluginDetail } from "@/views/api/plugins";
defineProps<{ detail: PluginDetail }>();
</script>

<style scoped>
pre {
  background: rgba(0, 0, 0, 0.03);
  padding: 12px;
  border-radius: 4px;
  overflow: auto;
}
</style>
