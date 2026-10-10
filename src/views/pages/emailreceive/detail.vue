<template>
  <AppPageShell
    page-id="email-receive-detail"
    title-key="route.email_receive_detail"
    content-width="wide"
  >
    <v-sheet class="mx-auto pa-4" rounded>
    <div class="d-flex align-center mb-4">
      <v-btn color="error" variant="text" @click="goBack">
        <v-icon start>mdi-arrow-left</v-icon>{{ t("common.return") }}
      </v-btn>
      <h2 class="ml-2">{{ message?.subject || t("emailReceive.message_detail") }}</h2>
    </div>

    <v-progress-linear v-if="loading" indeterminate></v-progress-linear>

    <div v-if="message">
      <v-card variant="tonal" class="pa-3 mb-4">
        <div><b>{{ t("emailReceive.from") }}:</b> {{ message.fromName ? message.fromName + " <" + message.fromAddress + ">" : message.fromAddress }}</div>
        <div><b>{{ t("emailReceive.reply_to") }}:</b> {{ message.replyToAddress || "—" }}</div>
        <div><b>{{ t("emailReceive.received_at") }}:</b> {{ formatDate(message.receivedAt) }}</div>
        <div><b>{{ t("emailReceive.classification") }}:</b> {{ message.classification || "—" }}</div>
        <div><b>{{ t("emailReceive.reply_status") }}:</b> {{ message.replyStatus }}</div>
        <div v-if="message.threadKey"><b>Thread:</b> {{ message.threadKey }}</div>
      </v-card>

      <!-- Sanitized body. Remote images are NOT loaded automatically. -->
      <v-card v-if="message.bodyHtmlSanitized" variant="outlined" class="pa-3 mb-4">
        <div class="text-subtitle-2 mb-2">{{ t("emailReceive.body_html") }}</div>
        <div class="email-body" v-html="renderedHtml"></div>
      </v-card>
      <v-card v-else-if="message.bodyText" variant="outlined" class="pa-3 mb-4">
        <div class="text-subtitle-2 mb-2">{{ t("emailReceive.body_text") }}</div>
        <pre style="white-space: pre-wrap">{{ message.bodyText }}</pre>
      </v-card>
    </div>
    </v-sheet>
  </AppPageShell>
</template>

<script setup lang="ts">
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getReceivedMessage } from "@/views/api/emailreceive";
import type { ReceivedMessageDetailDto } from "@/entityTypes/emailReceiveTypes";

const { t } = useI18n({ inheritLocale: true });
const route = useRoute();
const router = useRouter();

const message = ref<ReceivedMessageDetailDto | null>(null);
const loading = ref(true);

/**
 * Render sanitized HTML with remote images disabled (tracking-pixel defense).
 * The stored body is already sanitized server-side; we additionally strip
 * src attributes so no remote image loads until the user opts in.
 */
const renderedHtml = computed(() => {
  const html = message.value?.bodyHtmlSanitized;
  if (!html) return "";
  return html.replace(/<img[^>]*>/gi, "[image hidden]");
});

onMounted(async () => {
  const id = Number(route.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    loading.value = false;
    return;
  }
  try {
    message.value = await getReceivedMessage(id, true);
  } catch (err) {
    console.error("Failed to load message:", err);
  } finally {
    loading.value = false;
  }
});

function goBack() {
  router.push({ name: "Email_Receive_List", query: route.query });
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
</script>
<style scoped>
.email-body {
  max-height: 480px;
  overflow-y: auto;
}
</style>
