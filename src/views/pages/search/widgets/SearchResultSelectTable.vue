<template>

    <v-data-table-server v-model="selected" :items-per-page="itemsPerPage" :search="search" :headers="headers"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems" class="custom-data-table" return-object show-select select-strategy="single">
        
    </v-data-table-server>
    
    
</template>

<script setup lang="ts">
import {useI18n} from "vue-i18n";
import { listSearchresult} from '@/views/api/search'
import { ref,computed,watch,reactive } from 'vue'
import { SearchResult } from '@/views/api/types'
// import router from '@/views/router';
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
// let refreshInterval:ReturnType<typeof setInterval> | undefined;

headers.value = [
    {
        title: computed(_ => CapitalizeFirstLetter(t("searchtask.id"))),
        align: 'center',
        sortable: false,
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
    
];
const itemsPerPage = ref(10);
const serverItems = ref<Array<SearchtaskItem>>([]);
const loading = ref(false);

const totalItems = ref(0);
const search = ref('');
const selected=ref<SearchtaskItem>();

function loadItems({ page=1, itemsPerPage=10, sortBy }) {
    options.page = page;
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
             //console.log(data)
            // console.log(total)
        
            serverItems.value = data
            totalItems.value = total
            loading.value = false
        }).catch(function (error) {
            console.error(error);
        })
}


const emit = defineEmits(['change'])
watch(selected, (newValue:SearchtaskItem|undefined, oldValue:SearchtaskItem|undefined) => {
  console.log(`selectedtask changed from ${oldValue} to ${newValue}`);
  console.log(newValue)
  emit('change', newValue);
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