campaign:list<template>
    <div class="search_bar mt-4 d-flex jsb">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field rounded class="elevation-0" density="compact" variant="solo" label="Search sample"
                    append-inner-icon="mdi-magnify" single-line hide-details></v-text-field>
            </div>
            <!-- <v-btn class="btn" variant="flat" prepend-icon="mdi-filter-variant"><span> More</span></v-btn> -->
            <v-btn class="btn" variant="flat" prepend-icon="mdi-plus" color="#5865f2" @click="createTask(campaignId)">
                Create Task
            </v-btn>
        </div>
        <div>
            
            
           
        </div>
    </div>
    <v-data-table-server v-model:items-per-page="itemsPerPage" :search="search" :headers="headers"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems">
        <template v-slot:[`item.actions`]="{ item }">
            <v-icon
            size="small"
            class="me-2"
            @click="edittask(item)"
          >
          mdi-pencil
          </v-icon>
          <v-icon
            size="small" 
            @click="runtask(item)"
          >
            mdi-play
          </v-icon> 
          <v-icon
            size="small" 
          >
            mdi-delete
          </v-icon>
          <v-icon
            size="small" 
            @click="checkLog(item)"
          >
            mdi-history
          </v-icon>
        </template>
    </v-data-table-server>
    
    <!-- <v-dialog width="30%">
        <v-card title="Dialog">
            <v-card-text>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
                incididunt ut labore et dolore magna aliqua.
            </v-card-text>
            <v-card-actions>
                <v-btn color="primary" block>Close Dialog</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog> -->
</template>

<script setup lang="ts">
import { getSocialtasklist } from '@/views/api/socialtask'
import { ref } from 'vue'
import { SearchResult } from '@/views/api/types'
import {SocialTaskEntity} from "@/entityTypes/socialtask-type"
// import { SearchResult } from '@/views/api/types'
// import type { VDataTable } from 'vuetify/lib/components/index.mjs'
import { useRoute } from "vue-router";
import router from '@/views/router';

type Fetchparam = {
    id:number
    page: number,
    itemsPerPage: number,
    sortBy: string,
    search: string
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<SocialTaskEntity>> {
        const fpage=(fetchparam.page-1)*fetchparam.itemsPerPage
        return await getSocialtasklist({ id:fetchparam.id,page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
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
        title: 'Task Name',
        align: 'start',
        sortable: false,
        key: 'task_name',
    },
    {
        title: 'Tag',
        align: 'start',
        sortable: false,
        key: 'tag',
    },
    {
        title: 'Task Types',
        align: 'start',
        sortable: false,
        key: 'type',
    },
    { title: 'Status', key: 'status', sortable: false },
    { title: 'Actions', key: 'actions', sortable: false },

];
const itemsPerPage = ref(10);
const serverItems = ref<Array<SocialTaskEntity>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
const $route = useRoute();
const campaignId=$route.params.id.toString();
console.log(campaignId)
// }),
// watch: {
//     name() {
//         this.search = String(Date.now())
//     },
// },
// methods: {
function loadItems({ page, itemsPerPage, sortBy }) {
    loading.value = true
    const fetchitem: Fetchparam = {
        id:parseInt(campaignId),
        page: page,
        itemsPerPage: itemsPerPage,
        sortBy: sortBy,
        search: search.value
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {
             console.log(data)
             console.log(total)
            //loop data
            for(let i=0; i<data.length; i++){
                if(data[i].disable == 0){
                    data[i].status = "Enable"
                }else{
                    data[i].status = "Disable"    
                }
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
// const editItem = (item) => {
//     // router.push({
//     //     path: '/graphics/oasis-engine',
//     // });
// };
const runtask=(item)=>{
    console.log("run task")
    console.log("item id is "+item.id)
    const routeData = router.resolve({name: 'Runtask', params: {id: item.id}});
    console.log(routeData.href)
    window.open(routeData.href, '_blank')
}
const edittask=(item)=>{
    // router.push({
    //     path: '/graphics/oasis-engine',
    // });
    router.push({
            name: 'EditSocialtask',params: { id: item.id } 
        });
}
const createTask=(campaignId:string)=>{
    router.push({
            name: 'CreateSocialtask',params: { campaignId: campaignId } 
        });
}
//open task run list page
const checkLog=(item)=>{
    const routeData = router.resolve({name: 'Task-run-list', params: {id: item.id}});
    window.open(routeData.href, '_blank')
}

</script>