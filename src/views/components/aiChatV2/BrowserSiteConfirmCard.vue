<template>
  <v-card class="browser-site-confirm-card" data-testid="browser-site-confirm" density="compact">
    <v-card-title class="text-subtitle-1">
      {{ t('browserSite.confirmTitle') || 'Confirm additional login domains' }}
    </v-card-title>
    <v-card-text>
      <p class="text-body-2 mb-2">
        {{ t('browserSite.confirmHint', { domain: registrableDomain }) || `The sign-in for ${registrableDomain} visited additional domains. Credentials and cookies would be released to them — confirm each one.` }}
      </p>
      <v-list density="compact" data-testid="proposed-domains">
        <v-list-item v-for="domain in proposedDomains" :key="domain">
          <template #prepend>
            <v-checkbox-btn v-model="selected[domain]" :data-testid="`domain-check-${domain}`" />
          </template>
          <v-list-item-title>{{ domain }}</v-list-item-title>
        </v-list-item>
      </v-list>
      <p class="text-body-2 text-error">
        {{ t('browserSite.warning') || 'Prompt-injected requests cannot add domains — only domains the browser actually visited appear here.' }}
      </p>
    </v-card-text>
    <v-card-actions>
      <v-btn
        color="primary"
        :disabled="selectedCount === 0"
        data-testid="site-confirm-apply"
        @click="apply"
      >
        {{ t('browserSite.apply') || 'Confirm selected domains' }}
      </v-btn>
      <v-btn variant="text" data-testid="site-confirm-cancel" @click="emit('cancelled')">
        {{ t('common.cancel') || 'Cancel' }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  siteId: number;
  /** Main-process-derived registrable domain — never model text. */
  registrableDomain: string;
  proposedDomains: readonly string[];
}>();

const emit = defineEmits<{
  (event: "applied", payload: { siteId: number; domains: string[] }): void;
  (event: "cancelled"): void;
}>();

const { t } = useI18n();
const selected = reactive<Record<string, boolean>>(
  Object.fromEntries(props.proposedDomains.map((domain) => [domain, true]))
);

const selectedCount = computed(
  () => Object.values(selected).filter(Boolean).length
);

function apply(): void {
  const domains = props.proposedDomains.filter((domain) => selected[domain]);
  emit("applied", { siteId: props.siteId, domains });
}
</script>
