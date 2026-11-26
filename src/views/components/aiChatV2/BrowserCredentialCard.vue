<template>
  <v-card class="browser-credential-card" data-testid="browser-credential-card" density="compact">
    <v-card-title class="text-subtitle-1">
      {{ title }}
    </v-card-title>
    <v-card-text>
      <p class="text-body-2 mb-3">
        {{ t('browserSignIn.disclosure') || 'The site domain is verified by the app. Usernames are visible to your AI provider; passwords never are.' }}
      </p>
      <v-text-field
        v-model="username"
        :label="t('browserSignIn.username') || 'Username'"
        density="compact"
        autocomplete="username"
        :disabled="props.passwordOnly === true"
        data-testid="credential-username"
      />
      <v-text-field
        v-model="password"
        :label="t('browserSignIn.password') || 'Password'"
        density="compact"
        type="password"
        autocomplete="current-password"
        data-testid="credential-password"
      />
      <v-checkbox
        v-model="save"
        density="compact"
        :label="t('browserSignIn.saveForFuture') || 'Save for future use'"
        data-testid="credential-save"
      />
      <p v-if="errorMessage" class="text-error text-body-2">{{ errorMessage }}</p>
    </v-card-text>
    <v-card-actions>
      <v-btn
        color="primary"
        :disabled="!canSubmit"
        data-testid="credential-submit"
        @click="submit"
      >
        {{ mode === 'register' ? (t('browserSignIn.createAccount') || 'Create account') : (t('browserSignIn.submit') || 'Sign in') }}
      </v-btn>
      <v-btn variant="text" data-testid="credential-self" @click="signSelf">
        {{ t('browserSignIn.signMyself') || "I'll sign in myself" }}
      </v-btn>
      <v-btn variant="text" data-testid="credential-cancel" @click="cancel">
        {{ t('common.cancel') || 'Cancel' }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { submitBrowserLoginCredential } from "@/views/api/managedBrowser";

const props = defineProps<{
  requestId: string;
  conversationId: string;
  /** Site domain from the MAIN process — never from the model. */
  siteDomain: string;
  mode: "login" | "register";
  prefillUsername?: string | null;
  /** A-FR-05: a username-only saved account asks for the PASSWORD only. */
  passwordOnly?: boolean;
}>();

const emit = defineEmits<{
  (event: "submitted"): void;
  (event: "handoff"): void;
  (event: "cancelled"): void;
}>();

const { t } = useI18n();
// The site domain ALWAYS comes from the main process (A-FR-05).
const title = `${t('browserSignIn.cardTitle')} — ${props.siteDomain}`;
const username = ref(props.prefillUsername ?? "");
const password = ref("");
const save = ref(true);
const errorMessage = ref("");

const canSubmit = computed(
  // A-FR-05: on a password-only card the username field is DISABLED and
  // prefilled with the saved account's username — the user supplies the
  // password only.
  () => username.value.trim().length > 0 && password.value.length > 0
);

async function submit(): Promise<void> {
  if (!canSubmit.value) {
    errorMessage.value = t('browserSignIn.missingFields') || 'Enter a username and password.';
    return;
  }
  const result = await submitBrowserLoginCredential({
    requestId: props.requestId,
    conversationId: props.conversationId,
    username: username.value.trim(),
    password: password.value,
    save: save.value,
    cancelled: false,
  });
  if (!result.accepted) {
    errorMessage.value = t('browserSignIn.expired') || 'This sign-in request expired. Try again.';
    return;
  }
  password.value = "";
  emit("submitted");
}

async function signSelf(): Promise<void> {
  // C-FR-13: manual sign-in during takeover — the password stays with the user.
  await submitBrowserLoginCredential({
    requestId: props.requestId,
    conversationId: props.conversationId,
    username: username.value.trim() || "-",
    password: "-",
    save: false,
    cancelled: true,
  });
  emit("handoff");
}

async function cancel(): Promise<void> {
  await submitBrowserLoginCredential({
    requestId: props.requestId,
    conversationId: props.conversationId,
    username: "-",
    password: "-",
    save: false,
    cancelled: true,
  });
  emit("cancelled");
}
</script>
