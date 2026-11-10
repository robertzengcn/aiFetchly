<template>
  <!--
    Authenticated layout boundary (chat-first shell design §7.1). One parent
    route record mounts exactly one authenticated shell:
      - flag on  → AuthenticatedWorkspaceLayout (persistent chat-first shell)
      - flag off → legacy layout.vue (rollback window, design §27)
    The flag is a rollout control, never an authorization decision.
  -->
  <AuthenticatedWorkspaceLayout v-if="shell.shellEnabled.value" />
  <Layout v-else />
</template>

<script setup lang="ts">
import Layout from "@/views/layout/layout.vue";
import AuthenticatedWorkspaceLayout from "@/views/layout/AuthenticatedWorkspaceLayout.vue";
import { useInnerPageShellFlag } from "@/views/composables/useInnerPageShellFlag";

// The flag reads synchronously from local storage with a deterministic
// default-on value, so first paint never flickers between shells (§7.1).
const shell = useInnerPageShellFlag();
</script>
