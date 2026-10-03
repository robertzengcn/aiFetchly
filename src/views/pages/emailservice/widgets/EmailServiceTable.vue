<template>
    <div class="search_bar mt-4 d-flex jsb">
        <div class="d-flex jsb search_tool flex-wrap ga-2">
            <div class="search_wrap mr-4">
                <v-text-field
rounded class="elevation-0" density="compact" variant="solo" label="Search"
                    append-inner-icon="mdi-magnify" single-line hide-details v-model="search"></v-text-field>
            </div>

            <v-select
                data-testid="email-service-tag-filter"
                v-model="tagFilter"
                :items="tagFilterOptions"
                item-title="title"
                item-value="value"
                :label="t('emailservice.tag_filter') || 'Filter by tag'"
                density="compact"
                variant="solo"
                hide-details
                clearable
                class="tag-filter"
            />

            <v-btn class="btn ml-3" variant="flat" prepend-icon="mdi-plus" color="#5865f2" @click="createService()">
                {{ CapitalizeFirstLetter(t('emailservice.create_service')) }}
            </v-btn>

            <v-btn
                v-if="!isSelectedtable"
                class="btn ml-3" variant="flat" prepend-icon="mdi-export" color="secondary"
                :loading="exporting"
                data-testid="email-service-export-btn"
                @click="handleExport"
            >
                {{ t('common.export') }}
            </v-btn>

            <v-btn
                class="btn ml-3"
                variant="outlined"
                prepend-icon="mdi-tag-multiple"
                data-testid="email-service-manage-tags-btn"
                @click="showTagDialog = true"
            >
                {{ t('emailservice.manage_tags') || 'Manage tags' }}
            </v-btn>

            <v-btn
                v-if="!isSelectedtable"
                class="btn ml-3" variant="flat" prepend-icon="mdi-import" color="secondary"
                data-testid="email-service-import-btn"
                @click="showImportDialog = true"
            >
                {{ t('common.import') }}
            </v-btn>

            <v-btn
                class="btn ml-3" variant="outlined" prepend-icon="mdi-file-document-multiple"
                data-testid="email-service-send-log-btn"
                @click="goToSendLog"
            >
                {{ CapitalizeFirstLetter(t('route.email_send_log')) }}
            </v-btn>
        </div>

    </div>
    <v-data-table-server
v-model="selected" v-model:page="currentPage" :items-per-page="itemsPerPage" :search="search" :headers="computedHeaders"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="id" @update:options="loadItems" return-object
        class="mt-5" :show-select="isSelectedtable">
        <template v-slot:[`item.tag`]="{ item }">
            <v-chip v-if="item.tag" size="small">{{ item.tag }}</v-chip>
            <span v-else>{{ t('emailservice.untagged') || 'Untagged' }}</span>
        </template>
        <template v-slot:[`item.actions`]="{ item }" v-if="isSelectedtable!=true">

            <v-icon size="small" class="me-2" @click="editItem(item)">
                mdi-pencil
            </v-icon>
            <v-icon size="small" @click="deleteitem(item)">
                mdi-delete
            </v-icon>
        </template>
    </v-data-table-server>
    <delete-dialog
:dialog="showDeleteModal" @confirm-delete="handleDelete"
        @confirm-close="showDeleteModal = false"></delete-dialog>

    <notice-snackbar
        v-model="exportNotice.show"
        :message="exportNotice.message"
        :type="exportNotice.type"
    />

    <email-service-import-dialog
        v-model="showImportDialog"
        @imported="handleImportDone"
    />

    <email-service-tag-dialog
        v-model="showTagDialog"
        @changed="handleTagsChanged"
    />

</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { EmailServiceListdata } from "@/entityTypes/emailmarketingType"
import { getEmailServiceList, deleteEmailService, exportEmailServices } from '@/views/api/emailservice'
import { ref, computed, watch, onMounted } from 'vue'
import { SearchResult } from '@/views/api/types'
import { CapitalizeFirstLetter } from "@/views/utils/function"
// import type { VDataTable } from 'vuetify/lib/components/index.mjs'
import { useRouter } from 'vue-router';
import { Header } from "@/entityTypes/commonType"
import DeleteDialog from '@/views/components/widgets/deleteDialog.vue';
import NoticeSnackbar from '@/views/components/widgets/noticeSnackbar.vue';
import EmailServiceImportDialog from '@/views/pages/emailservice/widgets/EmailServiceImportDialog.vue';
import EmailServiceTagDialog from '@/views/pages/emailservice/widgets/EmailServiceTagDialog.vue';
import { getEmailServiceTags } from '@/views/api/emailservice';
import type { EmailServiceTagSummary } from '@/entityTypes/emailmarketingType';
import { emailServiceTagErrorKey } from '@/views/utils/emailServiceTagError';
const { t } = useI18n({ inheritLocale: true });
const selected = ref<Array<EmailServiceListdata>>([]);
const router = useRouter();
const computedHeaders = computed(() => {
    if (props.isSelectedtable) {
        return headers.value.filter(value => value.key !== 'actions');
    } else {
        return headers.value;
    }
});
// Define props
const props = defineProps({
    isSelectedtable: {
        type: Boolean,

        default: false,
    }

});

// const campaignId = i18n.t("campaignId");
type Fetchparam = {
    page: number,
    itemsPerPage: number,
    sortBy?: { key: string, order: string },
    search: string,
    tagId?: number,
    untagged?: boolean,
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<EmailServiceListdata>> {
        const fpage = (fetchparam.page - 1) * fetchparam.itemsPerPage
        return await getEmailServiceList({
            page: fpage,
            size: fetchparam.itemsPerPage,
            sortby: fetchparam.sortBy,
            search: fetchparam.search,
            tagId: fetchparam.tagId,
            untagged: fetchparam.untagged,
        })
    }
}

const headers = computed<Array<Header>>(() => [
    {
        title: CapitalizeFirstLetter(t("emailservice.id")),
        align: 'start',
        sortable: false,
        key: 'id',
    },
    {
        title: CapitalizeFirstLetter(t("emailservice.name")),
        align: 'start',
        sortable: false,
        key: 'name',
    },
    {
        title: CapitalizeFirstLetter(t("emailservice.from")),
        align: 'start',
        sortable: false,
        key: 'from',
    },
    {
        title: CapitalizeFirstLetter(t("emailservice.tag") || "Tag"),
        align: 'start',
        sortable: false,
        key: 'tag',
    },
    {
        title: CapitalizeFirstLetter(t("common.created_time")),
        align: 'start',
        sortable: false,
        key: 'create_time',
    },
    { 
        title: CapitalizeFirstLetter(t("common.actions")), 
        key: 'actions', 
        sortable: false 
    },
]);
const itemsPerPage = ref(10);
const serverItems = ref<Array<EmailServiceListdata>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
const showDeleteModal = ref(false);
const deleteId = ref(0);
const showTagDialog = ref(false);
const tags = ref<EmailServiceTagSummary[]>([]);
const currentPage = ref(1);
let latestRequest = 0;
const tagFilter = ref<number | 'untagged' | null>(null);
const tagFilterOptions = computed(() => [
    { title: t('emailservice.all_tags') || 'All tags', value: null },
    { title: t('emailservice.untagged') || 'Untagged', value: 'untagged' as const },
    ...tags.value.map((tag) => ({ title: tag.name, value: tag.id })),
]);

async function loadTags(): Promise<void> {
    try {
        tags.value = await getEmailServiceTags();
        if (typeof tagFilter.value === 'number' && !tags.value.some((tag) => tag.id === tagFilter.value)) {
            tagFilter.value = null;
        }
    } catch (error) {
        exportNotice.value = { show: true, type: 'error', message: t(emailServiceTagErrorKey(error)) || 'Unable to load tags.' };
    }
}

async function handleTagsChanged(): Promise<void> {
    await loadTags();
    currentPage.value = 1;
    loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: [] });
}

function loadItems({ page, itemsPerPage, sortBy }) {
    const request = ++latestRequest;
    loading.value = true
    const fetchitem: Fetchparam = {
        page: page,
        itemsPerPage: itemsPerPage,
        sortBy: Array.isArray(sortBy) ? sortBy[0] : sortBy,
        search: search.value,
        tagId: typeof tagFilter.value === 'number' ? tagFilter.value : undefined,
        untagged: tagFilter.value === 'untagged' ? true : undefined,
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {
            if (request !== latestRequest) return;
            //loop data
            if (!data) {
                data = []
            }
            serverItems.value = data
            totalItems.value = total
            loading.value = false
        }).catch(function (error) {
            if (request !== latestRequest) return;
            loading.value = false;
            console.error(error);
            loading.value = false
        })
}

watch(tagFilter, () => {
    currentPage.value = 1;
    loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: [] });
});

onMounted(() => {
    void loadTags();
});
// },
// }
const editItem = (item: EmailServiceListdata) => {

    // else if(item.Types=="social task"){

    // }
    router.push({
        name: "Email_Marketing_Service_Detail", params: { id: item.id }
    });
};
const deleteitem = (item: EmailServiceListdata) => {

    if (item.id) {
        deleteId.value = item.id;
    }
    showDeleteModal.value = true;
}
const handleDelete = async () => {
    showDeleteModal.value = false;
    loading.value = true;
    const res = await deleteEmailService(deleteId.value)
    if (res) {
        loading.value = false;
        loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: [] });
    }
}
function createService() {
    console.log("create email Service")
    router.push({
        name: 'Email_Marketing_Service_Create'
    });
}

function goToSendLog() {
    router.push({
        name: 'UNIFIED_EMAIL_SEND_LOG'
    });
}

const exporting = ref(false);
const exportNotice = ref<{
    show: boolean;
    type: 'success' | 'error' | 'info';
    message: string;
}>({
    show: false,
    type: 'info',
    message: '',
});

async function handleExport() {
    if (exporting.value) return;
    exporting.value = true;
    try {
        const filePath = await exportEmailServices('csv');
        exportNotice.value = {
            show: true,
            type: 'success',
            message: filePath
                ? `${t('common.export_success')}: ${filePath}`
                : t('common.export_success'),
        };
    } catch (error) {
        const cancelled = error instanceof Error && /cancel/i.test(error.message);
        exportNotice.value = {
            show: true,
            type: 'error',
            message: cancelled
                ? t('common.export_cancelled')
                : `${t('common.export_failed')}: ${error instanceof Error ? error.message : String(error)}`,
        };
        console.error('Email service export failed:', error);
    } finally {
        exporting.value = false;
    }
}

const showImportDialog = ref(false);

function handleImportDone(): void {
    // The dialog surfaces its own result notice; the table only reloads.
    loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: [] });
    void loadTags();
}

const emit = defineEmits(['change'])
watch(selected, (newValue:Array<EmailServiceListdata>|undefined, oldValue:Array<EmailServiceListdata>|undefined) => {
  console.log(`selected filter changed from ${oldValue} to ${newValue}`);
  console.log(newValue)
  emit('change', newValue);
});
</script>
<style scoped>
.tag-filter {
    min-width: 180px;
    max-width: 280px;
}
</style>
