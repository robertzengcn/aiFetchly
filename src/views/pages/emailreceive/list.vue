<template>
  <div class="tables_page pa-4">
    <div class="d-flex align-center mb-4">
      <h2>{{ t("emailReceive.messages_title") }}</h2>
    </div>

    <div class="d-flex flex-wrap align-center mb-3">
      <v-select
        v-model="emailServiceId"
        :items="emailServices"
        item-title="name"
        item-value="id"
        :label="t('emailReceive.select_email_service')"
        density="compact"
        hide-details
        class="mr-2"
        style="max-width: 280px"
        clearable
      ></v-select>
      <v-btn color="primary" :loading="syncing" :disabled="!emailServiceId" @click="syncNow" class="mr-2">
        <v-icon start>mdi-sync</v-icon>{{ t("emailReceive.sync") }}
      </v-btn>
      <v-select
        v-model="filters.replyStatus"
        :items="statusOptions"
        item-title="title"
        item-value="value"
        :label="t('emailReceive.reply_status')"
        clearable
        density="compact"
        hide-details
        class="mr-2"
        style="max-width: 220px"
      ></v-select>
      <v-text-field
        v-model="filters.search"
        :label="t('common.search')"
        density="compact"
        clearable
        hide-details
        class="mr-2"
        style="max-width: 240px"
        @keyup.enter="reload"
      ></v-text-field>
      <v-btn color="primary" @click="reload">{{ t("common.search") }}</v-btn>
    </div>

    <v-alert
      v-if="!emailServiceId"
      type="info"
      variant="tonal"
      class="mb-3"
      density="compact"
    >
      {{ t("emailReceive.select_email_service_hint") || "Please select an Email Service to view messages." }}
    </v-alert>

    <v-data-table-server
      :headers="headers"
      :items="serverItems"
      :items-length="totalItems"
      :loading="loading"
      :items-per-page="itemsPerPage"
      :page="currentPage"
      item-value="id"
      @update:options="loadItems"
    >
      <template #item.receivedAt="{ item }">{{ formatDate(item.receivedAt) }}</template>
      <template #item.isUnread="{ item }">
        <v-icon :color="item.isUnread ? 'primary' : undefined" size="small">
          {{ item.isUnread ? "mdi-email" : "mdi-email-open" }}
        </v-icon>
      </template>
      <template #item.replyStatus="{ item }">
        {{ statusLabel(item.replyStatus) }}
      </template>
      <template #item.actions="{ item }">
        <v-icon size="small" @click="openDetail(item.id)">mdi-eye</v-icon>
      </template>
    </v-data-table-server>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import type { Header } from "@/entityTypes/commonType";
import { CapitalizeFirstLetter } from "@/views/utils/function";
import { listReceivedMessages, syncUnreadEmails } from "@/views/api/emailreceive";
import { getEmailServiceList } from "@/views/api/emailservice";
import type { EmailServiceListdata } from "@/entityTypes/emailmarketingType";
import type { ReceivedMessageListDto } from "@/entityTypes/emailReceiveTypes";

const { t } = useI18n({ inheritLocale: true });
const router = useRouter();
const route = useRoute();

const emailServiceId = ref<number | null>(null);
const emailServices = ref<EmailServiceListdata[]>([]);
const serverItems = ref<ReceivedMessageListDto[]>([]);
const totalItems = ref(0);
const loading = ref(true);
const syncing = ref(false);
const itemsPerPage = ref(20);
const currentPage = ref(1);

onMounted(async () => {
  const qs = route.query.emailServiceId;
  if (qs != null) {
    const parsed = Number(qs);
    if (!isNaN(parsed)) emailServiceId.value = parsed;
  }
  try {
    const resp = await getEmailServiceList({ page: 0, size: 9999 });
    emailServices.value = resp.data;
  } catch (err) {
    console.error("Failed to load email services:", err);
  }
});

watch(emailServiceId, (val) => {
  router.replace({ query: { ...route.query, emailServiceId: val != null ? String(val) : undefined } });
});

const filters = ref({ replyStatus: undefined as string | undefined, search: "" });

interface StatusOption {
  value: string;
  title: string;
}

const statusOptions = computed<StatusOption[]>(() => [
  { value: "not_started", title: t("emailReceive.status.not_started") || "Not Started" },
  { value: "draft_created", title: t("emailReceive.status.draft_created") || "Draft Created" },
  { value: "sent", title: t("emailReceive.status.sent") || "Sent" },
  { value: "skipped", title: t("emailReceive.status.skipped") || "Skipped" },
  { value: "blocked", title: t("emailReceive.status.blocked") || "Blocked" },
  { value: "failed", title: t("emailReceive.status.failed") || "Failed" },
]);

function statusLabel(status: string): string {
  return statusOptions.value.find(o => o.value === status)?.title || status;
}

const headers = computed<Array<Header>>(() => [
  { title: CapitalizeFirstLetter(t("emailReceive.subject")), key: "subject", sortable: false, align: "start" },
  { title: CapitalizeFirstLetter(t("emailReceive.from")), key: "fromAddress", sortable: false, align: "start" },
  { title: CapitalizeFirstLetter(t("emailReceive.received_at")), key: "receivedAt", sortable: true, align: "start" },
  { title: CapitalizeFirstLetter(t("emailReceive.unread")), key: "isUnread", sortable: false, align: "center" },
  { title: CapitalizeFirstLetter(t("emailReceive.classification")), key: "classification", sortable: false, align: "start" },
  { title: CapitalizeFirstLetter(t("emailReceive.reply_status")), key: "replyStatus", sortable: false, align: "start" },
  { title: CapitalizeFirstLetter(t("common.actions")), key: "actions", sortable: false, align: "center" },
]);

interface SortByItem {
  key: string;
  order: "asc" | "desc";
}

function reload() {
  currentPage.value = 1;
  loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: [] });
}

async function loadItems({ page, itemsPerPage: ips }: { page: number; itemsPerPage: number; sortBy: SortByItem[] }) {
  if (!emailServiceId.value) {
    serverItems.value = [];
    totalItems.value = 0;
    loading.value = false;
    return;
  }
  loading.value = true;
  itemsPerPage.value = ips;
  currentPage.value = page;
  const offset = (page - 1) * ips;
  try {
    const resp = await listReceivedMessages({
      emailServiceId: emailServiceId.value,
      page: offset,
      size: ips,
      search: filters.value.search || undefined,
      replyStatus: filters.value.replyStatus,
    });
    serverItems.value = resp.data;
    totalItems.value = resp.total;
  } catch (err) {
    console.error("Failed to load received messages:", err);
    serverItems.value = [];
    totalItems.value = 0;
  } finally {
    loading.value = false;
  }
}

async function syncNow() {
  if (!emailServiceId.value) return;
  syncing.value = true;
  try {
    await syncUnreadEmails({ emailServiceId: emailServiceId.value, limit: 20, unreadOnly: true });
    await reload();
  } catch (err) {
    console.error("Sync failed:", err);
  } finally {
    syncing.value = false;
  }
}

function openDetail(id: number) {
  router.push({ name: "Email_Receive_Detail", params: { id }, query: { emailServiceId: emailServiceId.value != null ? String(emailServiceId.value) : undefined } });
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
