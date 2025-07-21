<template>
    <div class="search_bar mt-4 d-flex jsb">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field rounded class="elevation-0" density="compact" variant="solo" label="Search"
                    append-inner-icon="mdi-magnify" single-line hide-details v-model="search"></v-text-field>
            </div> 
        </div>
    </div>
    <v-data-table-server v-model="selected" :items-per-page="itemsPerPage" :search="search" :headers="computedHeaders"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="id" @update:options="loadItems" return-object
        class="mt-5" :show-select="isSelectedtable">
       
    </v-data-table-server>
  

</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { getBuckEmailSendLog } from '@/views/api/buckemail'
import { ref, computed,watch,onMounted } from 'vue'
import { SearchResult } from '@/views/api/types'
import { CapitalizeFirstLetter } from "@/views/utils/function"
import {EmailMarketingSendLogListDisplay} from "@/entityTypes/buckemailType"
const $route = useRoute();
const taskId = ref(0);
// import type { VDataTable } from 'vuetify/lib/components/index.mjs'
//import router from '@/views/router';
import { Header } from "@/entityTypes/commonType"
// import DeleteDialog from '@/views/components/widgets/deleteDialog.vue';
import { useRoute } from "vue-router";
const { t } = useI18n({ inheritLocale: true });
const selected = ref<Array<EmailMarketingSendLogListDisplay>>([]);
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
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<EmailMarketingSendLogListDisplay>> {
        const fpage = (fetchparam.page - 1) * fetchparam.itemsPerPage
        return await getBuckEmailSendLog({ TaskId:taskId.value,page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
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
        title: CapitalizeFirstLetter(t("emailtasksendlog.receiver")),
        align: 'start',
        sortable: false,
        key: 'receiver',
    },
    {
        title: CapitalizeFirstLetter(t("emailtasksendlog.title")),
        align: 'start',
        sortable: false,
        key: 'receiver',
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
const serverItems = ref<Array<EmailMarketingSendLogListDisplay>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
// const showDeleteModal = ref(false);
// const deleteId = ref(0);


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
// const openItem = (item: BuckEmailListType) => {

//     // else if(item.Types=="social task"){

//     // }
//     router.push({
//         name: "Email_Marketing_Service_Detail", params: { id: item.TaskId }
//     });
// };

// function createService() {
//     console.log("create email Service")
//     router.push({
//         name: 'Email_Marketing_Service_Create'
//     });
// }

const emit = defineEmits(['change'])
watch(selected, (newValue:Array<EmailMarketingSendLogListDisplay>|undefined, oldValue:Array<EmailMarketingSendLogListDisplay>|undefined) => {
  console.log(`selected filter changed from ${oldValue} to ${newValue}`);
  console.log(newValue)
  emit('change', newValue);
});

const initialize = async () => {
  if ($route.params.id) {
    taskId.value = parseInt($route.params.id.toString());
  }
  
  }

onMounted(() => {
  initialize();
});  
</script>