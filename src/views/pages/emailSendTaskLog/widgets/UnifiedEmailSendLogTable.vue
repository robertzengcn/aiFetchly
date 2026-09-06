<template>
    <div class="search_bar mt-4 d-flex jsb">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field
rounded class="elevation-0" density="compact" variant="solo" label="Search"
                    append-inner-icon="mdi-magnify" single-line hide-details v-model="search"></v-text-field>
            </div>
        </div>
    </div>
    <v-data-table-server
v-model="selected" :items-per-page="itemsPerPage" :search="search" :headers="computedHeaders"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="id" @update:options="loadItems"
        return-object class="mt-5">
        <template v-slot:item.source="{ item }">
            <v-chip size="small" :color="item.source === 'authorized' ? 'primary' : 'default'" variant="tonal">
                {{ sourceLabel(item.source) }}
            </v-chip>
        </template>
        <template v-slot:item.status="{ item }">
            <v-chip size="small" :color="statusColor(item.status)" variant="tonal">
                {{ item.status }}
            </v-chip>
        </template>
    </v-data-table-server>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { getUnifiedEmailSendLog } from '@/views/api/buckemail'
import { ref, computed } from 'vue'
import { SearchResult } from '@/views/api/types'
import { CapitalizeFirstLetter } from "@/views/utils/function"
import { UnifiedSendLogEntry } from "@/entityTypes/buckemailType"
import { Header } from "@/entityTypes/commonType"

const { t } = useI18n({ inheritLocale: true });
const selected = ref<Array<UnifiedSendLogEntry>>([]);

const computedHeaders = computed(() => headers.value);

type Fetchparam = {
    page: number,
    itemsPerPage: number,
    sortBy?: { key: string, order: string },
    search: string
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<UnifiedSendLogEntry>> {
        const fpage = (fetchparam.page - 1) * fetchparam.itemsPerPage
        return await getUnifiedEmailSendLog({ page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
    }
}

const headers = computed<Array<Header>>(() => [
    {
        title: CapitalizeFirstLetter(t("emailtasksendlog.id")),
        align: 'start',
        sortable: false,
        key: 'id',
    },
    {
        title: CapitalizeFirstLetter(t("emailtasksendlog.source")),
        align: 'start',
        sortable: false,
        key: 'source',
    },
    {
        title: CapitalizeFirstLetter(t("emailtasksendlog.receiver")),
        align: 'start',
        sortable: false,
        key: 'receiver',
    },
    {
        title: CapitalizeFirstLetter(t("emailtasksendlog.title")),
        align: 'start',
        sortable: false,
        key: 'title',
    },
    {
        title: CapitalizeFirstLetter(t("emailtasksendlog.status")),
        align: 'start',
        sortable: false,
        key: 'status',
    },
    {
        title: CapitalizeFirstLetter(t("emailtasksendlog.record_time")),
        align: 'start',
        sortable: false,
        key: 'record_time',
    },
]);
const itemsPerPage = ref(10);
const serverItems = ref<Array<UnifiedSendLogEntry>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');

function loadItems({ page, itemsPerPage, sortBy }) {
    loading.value = true
    const fetchitem: Fetchparam = {
        page: page,
        itemsPerPage: itemsPerPage,
        sortBy: sortBy,
        search: search.value
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {
            if (!data) {
                data = []
            }
            serverItems.value = data
            totalItems.value = total
            loading.value = false
        }).catch(function (error) {
            console.error(error);
            loading.value = false
        })
}

function sourceLabel(source: string): string {
    if (source === 'authorized') {
        return t('emailtasksendlog.source_authorized') || 'Authorized'
    }
    return t('emailtasksendlog.source_legacy') || 'Legacy'
}

function statusColor(status: string): string {
    if (status === 'Success' || status === 'Sent') {
        return 'success'
    }
    if (status === 'Failure' || status === 'Failed') {
        return 'error'
    }
    if (status === 'Pending' || status === 'Submitted') {
        return 'warning'
    }
    return 'default'
}
</script>
