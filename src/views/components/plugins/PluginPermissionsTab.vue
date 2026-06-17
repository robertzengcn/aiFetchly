<template>
  <div>
    <div v-if="detail.permissions.length === 0" class="text-grey pa-4">
      No permissions declared.
    </div>
    <v-chip-group v-else>
      <v-chip v-for="p in detail.permissions" :key="p" size="small">
        {{ p }}
      </v-chip>
    </v-chip-group>
  </div>
</template>

<script setup lang="ts">
import type { PluginDetail } from "@/views/api/plugins";
defineProps<{ detail: PluginDetail }>();
</script>
