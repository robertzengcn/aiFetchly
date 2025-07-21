<template>
    <div class="search_bar mt-4 d-flex jsb">
        <div class="d-flex jsb search_tool">
            <!-- <div class="search_wrap mr-4">
                <v-text-field rounded class="elevation-0" density="compact" variant="solo" label="Search"
                    append-inner-icon="mdi-magnify" single-line hide-details v-model="search"></v-text-field>
            </div> -->
           
            <div class="ml-auto">
            <v-btn class="btn" variant="flat" prepend-icon="mdi-plus" color="#5865f2" @click="createTask()">
                {{CapitalizeFirstLetter(t('buckemailtask.create_task'))}}
            </v-btn>
        </div>
        </div>

    </div>
    <v-data-table-server v-model="selected" :items-per-page="itemsPerPage" :search="search" :headers="computedHeaders"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="id" @update:options="loadItems" return-object
        class="mt-5" :show-select="isSelectedtable">
        <template v-slot:[`item.actions`]="{ item }" v-if="isSelectedtable!=true">

            <v-icon size="small" class="me-2" @click="openItem(item)">
                mdi-folder
            </v-icon>
            
        </template>
    </v-data-table-server>
  

</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { getBuckEmailSendtaskList } from '@/views/api/buckemail'
import { ref, computed,watch } from 'vue'
import { SearchResult } from '@/views/api/types'
import { CapitalizeFirstLetter } from "@/views/utils/function"
import {BuckEmailListType} from "@/entityTypes/buckemailType"
// import type { VDataTable } from 'vuetify/lib/components/index.mjs'
import router from '@/views/router';
import { Header } from "@/entityTypes/commonType"
//import DeleteDialog from '@/views/components/widgets/deleteDialog.vue';
const { t } = useI18n({ inheritLocale: true });
const selected = ref<Array<BuckEmailListType>>([]);
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
    search: string
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<BuckEmailListType>> {
        const fpage = (fetchparam.page - 1) * fetchparam.itemsPerPage
        return await getBuckEmailSendtaskList({ page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
    }
}

const headers = computed<Array<Header>>(() => [
    {
        title: CapitalizeFirstLetter(t("buckemailtask.taskId")),
        align: 'center',
        sortable: false,
        key: 'TaskId',
    },
    {
        title: CapitalizeFirstLetter(t("buckemailtask.type")),
        align: 'start',
        sortable: false,
        key: 'Type',
    },
    {
        title: CapitalizeFirstLetter(t("buckemailtask.status")),
        align: 'start',
        sortable: false,
        key: 'Status',
    },
    {
        title: CapitalizeFirstLetter(t("common.record_time")),
        align: 'start',
        sortable: false,
        key: 'RecordTime',
    },
    { 
        title: CapitalizeFirstLetter(t("common.actions")), 
        key: 'actions', 
        sortable: false 
    },
]);
const itemsPerPage = ref(10);
const serverItems = ref<Array<BuckEmailListType>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
//const showDeleteModal = ref(false);
//const deleteId = ref(0);

function loadItems({ page, itemsPerPage, sortBy }) {
    loading.value = true
    // console.log(page);
    const fetchitem: Fetchparam = {
        page: page,
        itemsPerPage: itemsPerPage,
        sortBy: sortBy,
        search: search.value
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {
            console.log(data)
            // console.log(total)
            //loop data
            if (!data) {
                data = []
            }
            serverItems.value = data
            totalItems.value = total
            loading.value = false
        }).catch(function (error) {
            console.error(error);
        })
}
// },
// }
const openItem = (item: BuckEmailListType) => {

    // else if(item.Types=="social task"){

    // }
    router.push({
        name: "BUCK_Email_TASK_LOG_LIST", params: { id: item.TaskId }
    });
};

function createTask() {
    console.log("create email Service")
    router.push({
        name: 'Email_BUCK_SEND'
    });
}

const emit = defineEmits(['change'])
watch(selected, (newValue:Array<BuckEmailListType>|undefined, oldValue:Array<BuckEmailListType>|undefined) => {
  console.log(`selected filter changed from ${oldValue} to ${newValue}`);
  console.log(newValue)
  emit('change', newValue);
});
</script>