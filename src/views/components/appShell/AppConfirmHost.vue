<template>
  <!--
    Shared destructive confirmation host (design §20.2, §27.1).
    All feature-local confirm() calls should route through this surface
    for consistent object naming, consequence text, cancel-focus,
    and busy/error states.
  -->
  <v-dialog
    :model-value="confirmStore.isOpen"
    max-width="440"
    @update:model-value="(v: boolean) => !v && confirmStore.cancel()"
  >
    <v-card v-if="confirmStore.active" data-testid="app-confirm-dialog">
      <v-card-title class="confirm-title">
        <v-icon
          :icon="confirmStore.active.tone === 'danger' ? 'mdi-alert-circle-outline' : 'mdi-help-circle-outline'"
          size="20"
          :color="confirmStore.active.tone === 'danger' ? 'error' : undefined"
          class="mr-2"
          aria-hidden="true"
        />
        {{ confirmStore.active.title }}
      </v-card-title>
      <v-card-text class="confirm-body">{{ confirmStore.active.body }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          data-testid="app-confirm-cancel"
          :disabled="confirmStore.active.busy"
          @click="confirmStore.cancel()"
          @keydown.esc.prevent="confirmStore.cancel()"
          ref="cancelButton"
        >
          {{ confirmStore.active.cancelLabel || 'Cancel' }}
        </v-btn>
        <v-btn
          :color="confirmStore.active.tone === 'danger' ? 'error' : 'primary'"
          variant="flat"
          :loading="confirmStore.active.busy"
          :disabled="confirmStore.active.busy"
          data-testid="app-confirm-confirm"
          @click="confirmStore.confirm()"
        >
          {{ confirmStore.active.confirmLabel || 'Confirm' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useAppConfirmStore } from "@/views/store/appConfirm";

const confirmStore = useAppConfirmStore();
const cancelButton = ref<{ $el?: HTMLElement } | null>(null);

// Focus the cancel button on open (cancel-focused per §20.2).
watch(
  () => confirmStore.isOpen,
  async (open) => {
    if (open) {
      await nextTick();
      cancelButton.value?.$el?.focus();
    }
  }
);
</script>

<style scoped>
.confirm-title {
  font-size: 14px;
  font-weight: 600;
}

.confirm-body {
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
</style>
