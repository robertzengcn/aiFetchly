<template>
    <div class="search_bar mt-4 d-flex jsb">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field rounded class="elevation-0" density="compact" variant="solo" label="Search sample"
                    append-inner-icon="mdi-magnify" single-line hide-details></v-text-field>
            </div>
            <v-btn class="btn" variant="flat" prepend-icon="mdi-filter-variant"><span> {{t('common.more')}}</span></v-btn>
        </div>     
    </div>
    <v-data-table-server v-model:items-per-page="itemsPerPage" :search="search" :headers="headers" 
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems" class="custom-data-table mt5">
         
    </v-data-table-server>
    
    
</template>

<script setup lang="ts">
import {useI18n} from "vue-i18n";
import { gettaskresult } from '@/views/api/search'
import { ref,computed,onMounted } from 'vue'
import { SearchResult } from '@/views/api/types'
import {SearchResEntityDisplay} from "@/entityTypes/scrapeType"
//import router from '@/views/router';
import { useRoute } from "vue-router";
import { SearchResultFetchparam } from "@/entityTypes/searchControlType"
import {CapitalizeFirstLetter} from "@/views/utils/function"

const $route = useRoute();
const {t} = useI18n({inheritLocale: true});
const taskid = parseInt($route.params.id.toString());

const initialize = async () => {
console.log($route.params.id)
//   if ($route.params.id) {
//     taskid.value = parseInt($route.params.id.toString());
//   }
}
onMounted(() => {
  initialize();
});
// const campaignId = i18n.t("campaignId");
type Fetchparam = {
    page: number,
    itemsPerPage: number,
    sortBy: string,
    taskId: number,
    search: string
}

const FakeAPI = {

    async fetch(fetchparam: Fetchparam): Promise<SearchResult<SearchResEntityDisplay>> {
        console.log(fetchparam)
        const fpage=(fetchparam.page-1)*fetchparam.itemsPerPage
        const param:SearchResultFetchparam={
            page: fpage,
            itemsPerPage: fetchparam.itemsPerPage,
            sortBy: fetchparam.sortBy,
            search: fetchparam.search,
            taskId:fetchparam.taskId
        }
        return await gettaskresult(param)
       
    }
}

const headers=ref<Array<any>>([])
headers.value = [
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.id"))),
        align: 'start',
        sortable: false,
        key: 'index',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.title"))),
        align: 'start',
        sortable: false,
        key: 'title',
        width: '20px'
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.link"))),
        align: 'start',
        sortable: false,
        key: 'link',
        width: '20px'
        // value: computed(value => value.join(', '))
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.keyword"))),
        align: 'start',
        sortable: false,
        key: 'keyword',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchresult.record_time"))),
        align: 'start',
        sortable: false,
        key: 'record_time',
    },

];
const itemsPerPage = ref(10);
const serverItems = ref<Array<SearchResEntityDisplay>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');

function loadItems({ page, itemsPerPage, sortBy }) {
    loading.value = true
    //console.log(taskid)
    if(!taskid){
        return
    }
    // console.log(page);
    const fetchitem: Fetchparam = {
        page: page,
        itemsPerPage: itemsPerPage,
        sortBy: sortBy,
        taskId:taskid,
        search: search.value
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {
             console.log(data)
            // console.log(total)
            data.map((item, index) => {
                item.index = index + 1
            })
        
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
 
// };
// const openfolder=(item)=>{
//     // console.log(item)
    
// }

</script>
<style scoped>
.custom-data-table .v-data-table__wrapper tr {
  height: 50px; /* Set the desired row height */
}

.custom-data-table .v-data-table__wrapper td {
  height: 50px; /* Set the desired cell height */
}
</style>