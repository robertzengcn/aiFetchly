<script setup lang="ts">
/**
 * Temporary compatibility wrapper (unified plugin page tech design §13.2).
 *
 * The Community catalog now lives in the reusable
 * `CommunityPluginCatalog.vue` component, mounted under the unified
 * `/plugins/management?tab=discover` route. This page remains only so the
 * legacy `/community-plugins/list` route name resolves during the migration
 * window; it delegates to the extracted catalog to avoid duplicating
 * business logic. It is removed in the route-migration commit.
 */
import CommunityPluginCatalog from "@/views/components/plugins/CommunityPluginCatalog.vue";
</script>

<template>
  <CommunityPluginCatalog />
</template>
