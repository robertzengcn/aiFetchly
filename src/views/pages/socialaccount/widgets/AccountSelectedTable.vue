<template>
    
    <v-data-table-server v-model="selected" :search="search" :headers="headers" :items-per-page="itemsPerPage"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems" return-object show-select single-select>
        <template v-slot:[`item.cookies`]="{ item }">
            <v-chip v-if="item.cookies" class="mx-2" color="secondary">
                yes
              </v-chip>
              <v-chip v-if="!item.cookies" class="mx-2" color="pink">
                no
              </v-chip>
        </template>
        <template v-slot:[`item.use_proxy`]="{ item }">
            <v-chip v-if="item.use_proxy === 0" class="mx-2" color="secondary">
                yes
              </v-chip>
              <v-chip v-if="item.use_proxy === 1" class="mx-2" color="pink">
                no
              </v-chip>
        </template>
    </v-data-table-server>

</template>

<script setup lang="ts">
import { getSocialAccountlist} from '@/views/api/socialaccount'
import { ref,watch,computed} from 'vue'
import { SearchResult } from '@/views/api/types'
import {SocialAccountListData} from '@/entityTypes/socialaccount-type'
import {useI18n} from "vue-i18n";
import {ItemSearchparam} from "@/entityTypes/commonType"
const {t} = useI18n({inheritLocale: true});

// Define props
const props = defineProps({
  accountSource: {
    type: String,
    required: false,
    default:""
  }
  
});

type Fetchparam = {
    // id:number
    page: number,
    itemsPerPage: number,
    sortBy: { key: string, order: string },
    where?:string,
    search: string
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<SocialAccountListData>> {
        // console.log(fetchparam.search)
        const fpage=(fetchparam.page-1)*fetchparam.itemsPerPage
        const searchParam:ItemSearchparam={ page: fpage, 
            size: fetchparam.itemsPerPage, 
            sortby: fetchparam.sortBy, 
            search: fetchparam.search,

        }
        if(fetchparam.where){
            searchParam.where= fetchparam.where
        }
        console.log(searchParam)
        const res=await getSocialAccountlist(searchParam)
        console.log(res)
        return res
    }
}


const headers: Array<any> = [
    {
        title: computed(_ => t("account.accountId")),
        align: 'start',
        sortable: false,
        key: 'id',
    },
    {
        title: computed(_ => t("account.type")),
        align: 'start',
        sortable: false,
        key: 'social_type',
    },
    {
        title: computed(_ => t("account.usename")),
        align: 'start',
        sortable: false,
        key: 'user',
    },
    {
        title: computed(_ => t("account.cookies_exist")),
        align: 'start',
        sortable: false,
        key: 'cookies',
    },
    {
        title: computed(_ => t("account.useproxy")),
        align: 'start',
        sortable: false,
        key: 'use_proxy',
    },

];
const itemsPerPage = ref(10);
const serverItems = ref<Array<SocialAccountListData>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
const selected=ref<SocialAccountListData[]>([]);

function loadItems({ page, itemsPerPage, sortBy }) {
    loading.value = true
    const fetchitem: Fetchparam = {
        // id:parseInt(campaignId),
        page: page,
        itemsPerPage: itemsPerPage,
        sortBy: sortBy,
        search: search.value,
        where:props.accountSource
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {
            
            // console.log(data)
            // console.log(total)
            if(!data){
                data=[]
            }
            serverItems.value = data
            totalItems.value = total
            loading.value = false
        }).catch(function (error) {
            console.error(error);
        })
}
const emit = defineEmits(['change'])
watch(selected, (newValue:SocialAccountListData[], oldValue:SocialAccountListData[]) => {
  console.log(`selectedAccount changed from ${oldValue} to ${newValue}`);
  emit('change', newValue);
});






</script>