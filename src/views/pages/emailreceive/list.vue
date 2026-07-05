<template>
  <div class="tables_page pa-4">
    <div class="d-flex align-center mb-4">
      <h2>{{ t("emailReceive.messages_title") }}</h2>
    </div>

    <div class="d-flex flex-wrap gap-3 mb-3">
      <v-text-field
        v-model.number="emailServiceId"
        :label="t('emailReceive.email_service_id')"
        type="number"
        density="compact"
        style="max-width: 200px"
      ></v-text-field>
      <v-btn color="primary" :loading="syncing" :disabled="!emailServiceId" @click="syncNow">
        <v-icon start>mdi-sync</v-icon>{{ t("emailReceive.sync") }}
      </v-btn>
      <v-select
        v-model="filters.replyStatus"
        :items="replyStatusOptions"
        :label="t('emailReceive.reply_status')"
        clearable
        density="compact"
        style="max-width: 220px"
      ></v-select>
      <v-text-field
        v-model="filters.search"
        :label="t('common.search')"
        density="compact"
        clearable
        style="max-width: 240px"
        @keyup.enter="reload"
      ></v-text-field>
      <v-btn color="primary" @click="reload">{{ t("common.search") }}</v-btn>
    </div>

    <v-data-table-server
      :headers="headers"
      :items="serverItems"
      :items-length="totalItems"
      :loading="loading"
      :items-per-page="itemsPerPage"
      :page="currentPage"
      @update:options="loadItems"
    >
      <template #item.receivedAt="{ item }">{{ formatDate(item.receivedAt) }}</template>
      <template #item.isUnread="{ item }">
        <v-icon :color="item.isUnread ? 'primary' : 'default'">
          {{ item.isUnread ? "mdi-email" : "mdi-email-open" }}
        </v-icon>
      </template>
      <template #item.actions="{ item }">
        <v-icon small @click="openDetail(item.id)">mdi-eye</v-icon>
      </template>
    </v-data-table-server>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import type { Header } from "@/entityTypes/commonType";
import { CapitalizeFirstLetter } from "@/views/utils/function";
import { listReceivedMessages, syncUnreadEmails } from "@/views/api/emailreceive";
import type { ReceivedMessageListDto } from "@/entityTypes/emailReceiveTypes";

const { t } = useI18n({ inheritLocale: true });
const router = useRouter();

const emailServiceId = ref<number | null>(null);
const serverItems = ref<ReceivedMessageListDto[]>([]);
const totalItems = ref(0);
const loading = ref(true);
const syncing = ref(false);
const itemsPerPage = ref(20);
const currentPage = ref(1);

const filters = ref({ replyStatus: undefined as string | undefined, search: "" });
const replyStatusOptions = ["not_started", "draft_created", "sent", "skipped", "blocked", "failed"];

const headers = computed<Array<Header>>(() => [
  { title: CapitalizeFirstLetter(t("emailReceive.subject")), key: "subject", sortable: false },
  { title: CapitalizeFirstLetter(t("emailReceive.from")), key: "fromAddress", sortable: false },
  { title: CapitalizeFirstLetter(t("emailReceive.received_at")), key: "receivedAt", sortable: true },
  { title: CapitalizeFirstLetter(t("emailReceive.unread")), key: "isUnread", sortable: false },
  { title: CapitalizeFirstLetter(t("emailReceive.classification")), key: "classification", sortable: false },
  { title: CapitalizeFirstLetter(t("emailReceive.reply_status")), key: "replyStatus", sortable: false },
  { title: CapitalizeFirstLetter(t("common.action")), key: "actions", sortable: false },
]);

function reload() {
  currentPage.value = 1;
  loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: [] });
}

async function loadItems({ page, itemsPerPage: ips }: { page: number; itemsPerPage: number; sortBy: unknown[] }) {
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
  router.push({ name: "Email_Receive_Detail", params: { id } });
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
