<template>
  <v-dialog
    :model-value="visible"
    max-width="520"
    persistent
    data-testid="ai-optin-prompt-dialog"
    @update:model-value="onVisibility"
  >
    <v-card>
      <v-card-title>
        {{ t('socialaccount.ai_optin_prompt_title') || 'AI use for saved accounts' }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-2">
          {{
            t('socialaccount.ai_optin_prompt_body') ||
            'Choose which saved accounts the AI may use for automated browser sign-in. Accounts left unchecked stay off — automated sign-in refuses them until you opt in here or on the account page.'
          }}
        </p>
        <v-checkbox
          v-for="account in pending"
          :key="account.id"
          v-model="selected"
          :value="account.id"
          density="compact"
          hide-details
          :data-testid="`ai-optin-account-${account.id}`"
        >
          <template #label>
            <span>{{ account.name || account.user }} ({{ account.user }})</span>
          </template>
        </v-checkbox>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          variant="text"
          data-testid="ai-optin-decline"
          @click="submit(false)"
        >
          {{ t('socialaccount.ai_optin_decline') || 'Keep all off' }}
        </v-btn>
        <v-btn
          color="primary"
          data-testid="ai-optin-confirm"
          :disabled="selected.length === 0"
          @click="submit(true)"
        >
          {{ t('socialaccount.ai_optin_confirm') || 'Opt in selected' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
// R09/Q-01: the ONE-TIME existing-account opt-in prompt. Declining
// leaves every account opted OUT — automated sign-in refuses with
// account_not_eligible until a detail-page toggle opts the account in.
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  getAiOptInPendingAccounts,
  submitAiOptInDecisions,
  type AiOptInPendingAccount,
} from "@/views/api/socialaccount";

const { t } = useI18n();
const visible = ref(false);
const pending = ref<ReadonlyArray<AiOptInPendingAccount>>([]);
const selected = ref<number[]>([]);

onMounted(async () => {
  try {
    // R09: the fetch is strictly best-effort — a test/embedded shell
    // without the preload API must never hang the page mount.
    if (typeof window === "undefined" || !window.api) {
      return;
    }
    const accounts = await getAiOptInPendingAccounts();
    if (accounts.length > 0) {
      pending.value = accounts;
      visible.value = true;
    }
  } catch {
    // The prompt is best-effort: the detail-page toggle still works.
  }
});

function onVisibility(value: boolean): void {
  if (!value) {
    visible.value = false;
  }
}

async function submit(optIn: boolean): Promise<void> {
  const ids = optIn
    ? [...selected.value]
    : pending.value.map((account) => account.id);
  if (ids.length === 0) {
    visible.value = false;
    return;
  }
  try {
    await submitAiOptInDecisions(
      ids.map((id) => ({ id, enabled: optIn && selected.value.includes(id) }))
    );
  } finally {
    visible.value = false;
  }
}
</script>
