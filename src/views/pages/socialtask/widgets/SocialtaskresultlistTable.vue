<template>
    <v-data-table-server v-model:items-per-page="itemsPerPage" :search="search" :headers="headers"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems">
        
    </v-data-table-server>
</template>

<script setup lang="ts">
import { getTaskresultlist } from '@/views/api/socialtask'
import { ref } from 'vue'
// import { SearchResult } from '@/views/api/types'
import { useRoute } from "vue-router";
// import router from '@/views/router';
// import { TaskRunEntity } from '@/entityTypes/taskrun-types'
type Fetchparam = {
    id: number
    page: number,
    itemsPerPage: number,
}
type taskrunresp = {
    data: any,
    total: number
}
const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<taskrunresp> {
        const fpage = (fetchparam.page - 1) * fetchparam.itemsPerPage
        return await getTaskresultlist({ id: fetchparam.id, page: fpage, size: fetchparam.itemsPerPage })
    }
}


const headers: Array<any> = [
    {
        title: 'Id',
        align: 'start',
        sortable: false,
        key: 'id',
    },
    {
        title: 'Task Run id',
        align: 'start',
        sortable: false,
        key: 'taskrun_id',
    },
    {
        title: 'Title',
        align: 'start',
        sortable: false,
        key: 'title',
    },
    {
        title: 'Language',
        align: 'start',
        sortable: false,
        key: 'lang',
    },
    {
        title: 'Url',
        align: 'start',
        sortable: false,
        key: 'url',
    },
    {
        title: 'Record Time',
        align: 'start',
        sortable: false,
        key: 'record_time',
    },  
];
const itemsPerPage = ref(10);
const serverItems = ref([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
const $route = useRoute();
const taskId = $route.params.id.toString();

function loadItems({ page, itemsPerPage, sortBy }) {
    loading.value = true
    const fetchitem: Fetchparam = {
        id: parseInt(taskId),
        page: page,
        itemsPerPage: itemsPerPage,
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {
            console.log(data)
            console.log(total)

            serverItems.value = data
            totalItems.value = total
            loading.value = false
        }).catch(function (error) {
            console.error(error);
        })
}
</script>