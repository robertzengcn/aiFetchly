<template>
  <!--
    Bare nested RouterView for intermediate route groups (chat-first shell
    design §6.2). Groups that exist only to namespace feature paths render
    through this outlet instead of the legacy Layout, so no authenticated
    descendant can mount a second global drawer, header, notice host, or
    inspector host.
  -->
  <RouterView />
</template>

<script setup lang="ts">
import { RouterView } from "vue-router";
</script>
