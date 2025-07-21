<template>
    <div class="search_bar mt-4 d-flex jsb">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field rounded class="elevation-0" density="compact" variant="solo" label="Search sample"
                    append-inner-icon="mdi-magnify" single-line hide-details></v-text-field>
            </div>
            <v-btn class="btn" variant="flat" prepend-icon="mdi-filter-variant"><span> {{t('common.more')}}</span></v-btn>
        </div>
        <!-- <div>
            <v-chip class="mx-2" closable color="pink"> Secondary </v-chip>
            <v-chip class="mx-2" closable color="secondary"> Label </v-chip>
            <v-chip class="mx-2"> Status </v-chip>
        </div> -->
    </div>
    <v-data-table-server v-model:items-per-page="itemsPerPage" :search="search" :headers="headers"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems">
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
            @click="editItem(item)"
          >
            mdi-pencil
          </v-icon>
          <v-icon
            size="small"
           
          >
            mdi-delete
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
import {useI18n} from "vue-i18n";
import {campaignEntity} from "@/entityTypes/campaign-type"
import { getCampaignlist } from '@/views/api/campaigins'
import { ref,computed } from 'vue'
import { SearchResult } from '@/views/api/types'
// import type { VDataTable } from 'vuetify/lib/components/index.mjs'
import router from '@/views/router';
const {t} = useI18n({inheritLocale: true});

// const campaignId = i18n.t("campaignId");
type Fetchparam = {
    page: number,
    itemsPerPage: number,
    sortBy?: { key: string, order: string },
    search: string
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<campaignEntity>> {
        const fpage=(fetchparam.page-1)*fetchparam.itemsPerPage
        return await getCampaignlist({ page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
    }
}

const headers=ref<Array<any>>([])
headers.value = [
    {
        title: computed(_ => t("campaign.campaignId")),
        align: 'start',
        sortable: false,
        key: 'CampaignId',
    },
    {
        title: computed(_ => t("campaign.campaignName")),
        align: 'start',
        sortable: false,
        key: 'CampaignName',
    },
    {
        title: computed(_ => t("campaign.campaignDescription")),
        align: 'start',
        sortable: false,
        key: 'CampaignDescription',
    },
    {
        title: computed(_ => t("campaign.campaignStatus")),
        align: 'start',
        sortable: false,
        key: 'Disable',
        value: value=>value.Disable == 0 ? 'enable' : 'disable'
    },
    {
        title: computed(_ => t("campaign.campaignTypes")),
        align: 'start',
        sortable: false,
        key: 'Types',
    },
    { title: computed(_ => t("common.actions")), key: 'actions', sortable: false },

];
const itemsPerPage = ref(10);
const serverItems = ref<Array<campaignEntity>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');

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
            for(let i=0; i<data.length; i++){
                if(data[i].Disable == 0){
                    data[i].Status = "enable"
                }else{
                    data[i].Status = "disable"    
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
const editItem = (item) => {
 
    // else if(item.Types=="social task"){
        
    // }
    // router.push({
    //     path: '/graphics/oasis-engine',
    // });
};
const openfolder=(item)=>{
    // console.log(item)
    if(item.Types=="social task"){
        router.push({
            name: 'SocialtaskList',params: { id: item.CampaignId } 
        });
    }
}

</script>