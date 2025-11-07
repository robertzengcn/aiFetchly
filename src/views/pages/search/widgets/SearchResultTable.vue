<template>
   
        <!-- <div>
            <v-chip class="mx-2" closable color="pink"> Secondary </v-chip>
            <v-chip class="mx-2" closable color="secondary"> Label </v-chip>
            <v-chip class="mx-2"> Status </v-chip>
        </div> -->
   
    <v-data-table-server v-model:items-per-page="itemsPerPage" :search="search" :headers="headers"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems" class="custom-data-table">
        <template v-slot:[`item.actions`]="{ item }">
            <v-icon
            size="small"
            class="me-2"
            @click="openfolder(item)"
          >
            mdi-folder
          </v-icon>
          <v-icon 
          size="small"
            class="me-2"
            v-if="isTaskEditable(item.status)"
            @click="editTask(item)"
            title="Edit Task"
          >
            mdi-pencil
          </v-icon>
          <v-icon 
          size="small"
          class="me-2"
          v-if="item.status=='Error'" 
          @click="downloadErrorlog(item)"
          >
          mdi-download
          </v-icon>
          <v-icon 
          size="small"
          class="me-2"   
          @click="retryTask(item)"
          >
          mdi-refresh
          </v-icon>
          <v-icon 
          size="small"
          class="me-2"
          v-if="item.status=='Not Start'"
          @click="runTask(item)"
          title="Run Task"
          >
          mdi-play
          </v-icon>
        </template>
    </v-data-table-server>
    
    
</template>

<script setup lang="ts">
import {useI18n} from "vue-i18n";
import { listSearchresult,Errorlogquery, retrySearchTask } from '@/views/api/search'
import { ref,computed,onMounted,onUnmounted,reactive } from 'vue'
import { SearchResult } from '@/views/api/types'
// import type { VDataTable } from 'vuetify/lib/components/index.mjs'
import router from '@/views/router';
import {SearchtaskItem } from "@/entityTypes/searchControlType"
import {CapitalizeFirstLetter} from "@/views/utils/function"
const {t} = useI18n({inheritLocale: true});


const options = reactive({
      page: 1, // Initial page
      itemsPerPage: 10, // Items per page
    });

// const campaignId = i18n.t("campaignId");
type Fetchparam = {
    page: number,
    itemsPerPage: number,
    sortBy?: {key:string,order:string},
    search: string
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<SearchtaskItem>> {
        const fpage=(fetchparam.page-1)*fetchparam.itemsPerPage
        return await listSearchresult({ page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
    }
}

const headers=ref<Array<any>>([])
let refreshInterval:ReturnType<typeof setInterval> | undefined;

headers.value = [
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchtask.id"))),
        align: 'center',
        sortable: true,
        key: 'id',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("search.search_enginer_name"))),
        align: 'start',
        sortable: false,
        key: 'enginer_name',
        
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("search.keyword"))),
        align: 'start',
        sortable: false,
        key: 'keywordline',
        // value: computed(value => value.join(', '))
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.status"))),
        align: 'start',
        sortable: false,
        key: 'status',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.record_time"))),
        align: 'start',
        sortable: false,
        key: 'record_time',
    },
    { title: computed(_ => CapitalizeFirstLetter(t("common.actions"))), key: 'actions', sortable: false },
];
const itemsPerPage = ref(10);
const serverItems = ref<Array<SearchtaskItem>>([]);
const loading = ref(false);

const totalItems = ref(0);
const search = ref('');
const startAutoRefresh = () => {
    refreshInterval = setInterval(function(){
        loadItems({ page: options.page, itemsPerPage: options.itemsPerPage, sortBy: "" });
    }, 10000); // Refresh every 5 seconds
}
const stopAutoRefresh = () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval= undefined;
  }
};

function loadItems({ page=1, itemsPerPage=10, sortBy}) {
    options.page = page;
    loading.value = true
    options.page = page;
  options.itemsPerPage = itemsPerPage;
    console.log(sortBy)
    // console.log(page);
    
    const fetchitem: Fetchparam = {
        page: page,
        itemsPerPage: itemsPerPage,
       
        search: search.value
    }
    if(sortBy.length){
        console.log("sort have value")
        fetchitem.sortBy={key:sortBy[0].key,order:sortBy[0].order}

    }
   console.log(fetchitem)
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {
             console.log(data)
            // console.log(total)
        
            serverItems.value = data
            totalItems.value = total
            loading.value = false
        }).catch(function (error) {
            console.error(error);
        })
}
// },
// }
// const editItem = (item) => {
 
    // else if(item.Types=="social task"){
        
    // }
    // router.push({
    //     path: '/graphics/oasis-engine',
    // });
// };
const openfolder=(item)=>{
    // console.log(item)
    router.push({
            name: 'Searchtaskdetail',params: { id: item.id } 
     });
    }
const downloadErrorlog=(item)=>{
    // console.log(item)
    Errorlogquery(item.id).then((res)=>{
        console.log(res)
        // const url = window.URL.createObjectURL(new Blob([res.data]));
        // const link = document.createElement('a');
        // link.href
    })
}
const retryTask = async (item) => {
    try {
        await retrySearchTask(item.id);
        // console.log(response)   
        // if (response) {
            // Refresh the table after successful retry
            loadItems({ page: options.page, itemsPerPage: options.itemsPerPage, sortBy: "" });
        // } else {
        //     console.error('Failed to retry task:');
        // }
    } catch (error) {
        console.error('Error retrying task:', error);
    }
}

// Check if task is editable based on status
const isTaskEditable = (status: string): boolean => {
    // Allow editing for Not Start, Error, Processing, and Complete statuses
    return status === 'Not Start' || status === 'Error' || status === 'Processing' || status === 'Complete';
}

// Edit task function
const editTask = (item: any) => {
    // Navigate to edit page or open edit dialog
    router.push({
        name: 'EditSearchTask',
        params: { id: item.id }
    });
}

// Run task function
const runTask = async (item: any) => {
    try {
        // Call the run task API
        await retrySearchTask(item.id);
        // Refresh the table after successful run
        loadItems({ page: options.page, itemsPerPage: options.itemsPerPage, sortBy: "" });
    } catch (error) {
        console.error('Error running task:', error);
    }
}
onMounted(() => {
  
  startAutoRefresh();
});

onUnmounted(() => {
  stopAutoRefresh();
});

</script>
<style scoped>
.custom-data-table .v-data-table__wrapper tr {
  height: 50px; /* Set the desired row height */
}

.custom-data-table .v-data-table__wrapper td {
  height: 50px; /* Set the desired cell height */
}
</style>