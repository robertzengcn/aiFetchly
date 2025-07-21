<template>

    <v-data-table-server v-model:items-per-page="itemsPerPage" :search="search" :headers="headers"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems" class="custom-data-table" show-expand :show-select="isSelectedtable" select-strategy="single" >
        <template v-slot:[`item.actions`]="{ item }" v-if="isSelectedtable==true">
            <v-icon
            size="small"
            class="me-2"
            @click="openfolder(item)"
          >
            mdi-folder
          </v-icon>
          <!-- <v-icon 
          size="small"
          class="me-2"
          v-if="item.status=='Error'" 
          @click="downloadErrorlog(item)"
          >
          mdi-download
          </v-icon> -->

        </template>
        <template v-slot:expanded-row="{ columns, item }">
      <tr>
        <td :colspan="columns.length" >
         <div class="ellipsis-cell"> 
            <div v-for="(val, index) in item.emails" :key="index" class="url-item">
         {{ val }}
        </div> 
         </div>
        </td>
      </tr>
    </template>
    </v-data-table-server>
    
    
</template>

<script setup lang="ts">
import {useI18n} from "vue-i18n";
import { getEmailtaskdetail} from '@/views/api/emailextraction'
import {EmailResultDisplay} from '@/entityTypes/emailextraction-type'
import { ref,computed,onMounted,onUnmounted,reactive } from 'vue'
import { SearchResult } from '@/views/api/types'
// import type { VDataTable } from 'vuetify/lib/components/index.mjs'
import router from '@/views/router';
// import {SearchtaskItem } from "@/entityTypes/searchControlType"
import {CapitalizeFirstLetter} from "@/views/utils/function"
import { useRoute } from "vue-router";
const {t} = useI18n({inheritLocale: true});
const $route = useRoute();
// Define props
const props = defineProps({
  isSelectedtable: {
    type: Boolean,
    
    default:false,
  }
  
});

const options = reactive({
      page: 1, // Initial page
      itemsPerPage: 10, // Items per page
    });

// const campaignId = i18n.t("campaignId");
type Fetchparam = {
    taskId:number,
    page: number,
    itemsPerPage: number,
    sortBy?: {key:string,order:string},
    search: string
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<EmailResultDisplay>> {
        const fpage=(fetchparam.page-1)*fetchparam.itemsPerPage
        return await getEmailtaskdetail({ taskId:fetchparam.taskId,page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
    }
}

const headers=ref<Array<any>>([])
let refreshInterval:ReturnType<typeof setInterval> | undefined;

headers.value = [
    {
        title: computed(_ => CapitalizeFirstLetter(t("emailextraction.id"))),
        align: 'center',
        sortable: true,
        key: 'id',
        width: '5%'
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("emailextraction.url"))),
        align: 'start',
        sortable: false,
        key: 'url',
        width: '10%'
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("common.record_time"))),
        align: 'start',
        sortable: false,
        key: 'recordTime',
        width: '10%'
    },

];
const itemsPerPage = ref(10);
const serverItems = ref<Array<EmailResultDisplay>>([]);
const loading = ref(false);

const totalItems = ref(0);
const search = ref('');
const emailresulttaskdetailId=ref(0);
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
    const taskid=parseInt($route.params.id.toString())
    const fetchitem: Fetchparam = {
      taskId:taskid,
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
            // data.forEach((item) => {
            //     item.urlString=item.urls.join(',')
            // })
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
    
        // const url = window.URL.createObjectURL(new Blob([res.data]));
        // const link = document.createElement('a');
        // link.href
   
}
const initialize = async () => {
    
    // if($route.params.id){
    //   emailresulttaskdetailId.value = parseInt($route.params.id.toString());
    // }
    console.log($route.params.id)
}
onMounted(() => {
  initialize();
  // startAutoRefresh();
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
.ellipsis-cell {
  height: calc(10 * 1.2em); /* 4 lines with a line height of 1.2em */
  line-height: 1.2em;  
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80%; /* Adjust the width as needed */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  white-space: normal;
}
</style>