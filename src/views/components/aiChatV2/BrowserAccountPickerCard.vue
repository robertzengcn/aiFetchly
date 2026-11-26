<template>
  <v-card class="browser-account-picker-card" data-testid="browser-account-picker" density="compact">
    <v-card-title class="text-subtitle-1">
      {{ t('browserSignIn.pickAccount') || 'Choose an account' }}
    </v-card-title>
    <v-card-text>
      <p class="text-body-2 mb-2">
        {{ t('browserSignIn.pickAccountHint', { domain: siteDomain }) || `Several saved accounts match ${siteDomain}.` }}
      </p>
      <v-list density="compact" data-testid="account-options">
        <v-list-item
          v-for="account in accounts"
          :key="account.id"
          :data-testid="`account-option-${account.id}`"
          clickable
          @click="choose(account.id)"
        >
          <v-list-item-title>{{ account.name }}</v-list-item-title>
          <v-list-item-subtitle>{{ account.user }}</v-list-item-subtitle>
        </v-list-item>
      </v-list>
      <v-btn variant="text" data-testid="account-other" @click="emitOther">
        {{ t('browserSignIn.useAnother') || 'Use another account' }}
      </v-btn>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const props = defineProps<{
  siteDomain: string;
  accounts: ReadonlyArray<{ id: number; user: string; name: string }>;
}>();

const emit = defineEmits<{
  (event: "selected", accountId: number): void;
  (event: "other"): void;
}>();

const { t } = useI18n();

function choose(accountId: number): void {
  emit("selected", accountId);
}
function emitOther(): void {
  emit("other");
}
</script>
