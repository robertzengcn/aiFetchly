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
        <v-alert
          v-if="submitError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-2"
          data-testid="ai-optin-submit-error"
        >
          {{
            t('socialaccount.ai_optin_submit_failed') ||
              'Some accounts could not be saved. Retry — the prompt stays open until every choice is stored.'
          }}
        </v-alert>
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
/**
 * P04/Q-01: a FAILED submit keeps the prompt OPEN with a retriable
 * error — closing on failure made every unprocessed account reappear on
 * the next page load (the prompt lost its one-time property).
 */
const submitError = ref(false);
const submitting = ref(false);

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
  // P04/Q-01: the ENTIRE reviewed cohort submits per decision — an
  // unselected account is explicitly stored opted-OUT (declined once),
  // so it never reappears; a subset submit left unchecked accounts
  // unasked and re-prompting forever.
  const cohort = pending.value.map((account) => ({
    id: account.id,
    enabled: optIn && selected.value.includes(account.id),
  }));
  if (cohort.length === 0) {
    visible.value = false;
    return;
  }
  submitting.value = true;
  submitError.value = false;
  try {
    const result = await submitAiOptInDecisions(cohort);
    // The IPC reports ids that could not be written — the prompt stays
    // open for a retriable resubmit of the remaining cohort.
    const failedIds = (
      result as { ok?: boolean; failedIds?: number[] }
    )?.failedIds;
    if (failedIds && failedIds.length > 0) {
      pending.value = pending.value.filter((account) =>
        failedIds.includes(account.id)
      );
      selected.value = selected.value.filter((id) =>
        failedIds.includes(id)
      );
      submitError.value = true;
      return;
    }
    visible.value = false;
  } catch {
    submitError.value = true;
  } finally {
    submitting.value = false;
  }
}
</script>
