<template>
    <!-- Email filter list table-->
    <div class="search_bar mt-4 d-flex jsb">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field rounded class="elevation-0" density="compact" variant="solo" label="Search sample"
                    append-inner-icon="mdi-magnify" single-line hide-details></v-text-field>
            </div>
            
            <v-btn class="btn ml-3" variant="flat" prepend-icon="mdi-plus" color="#5865f2" @click="createFilter()">
                {{CapitalizeFirstLetter(t('emailfilter.create_filter'))}}
             </v-btn> 
        </div>
   
    </div>
    <v-data-table-server v-model="selected" :items-per-page="itemsPerPage" :search="search" :headers="computedHeaders"
        :items-length="totalItems" :items="serverItems" :loading="loading"  item-value="id" @update:options="loadItems" 
        class="mt-5" :show-select="isSelectedtable"  return-object>
        <template v-slot:[`item.actions`]="{ item }" v-if="isSelectedtable!=true">
            
            <v-icon
            size="small"
            class="me-2"
            @click="editItem(item)"
          >
            mdi-pencil
          </v-icon>
          <v-icon
            size="small"
            @click="deleteitem(item)"
          >
            mdi-delete
          </v-icon>
        </template>
    </v-data-table-server>
    <delete-dialog
    :dialog="showDeleteModal"     
    @confirm-delete="handleDelete"
      @confirm-close="showDeleteModal = false"
  ></delete-dialog>

</template>

<script setup lang="ts">
import {useI18n} from "vue-i18n";
import {EmailFilterdata} from "@/entityTypes/emailmarketingType"
import {getEmailfilterlist,deleteEmailFilter} from '@/views/api/emailfilter'
import { ref,computed,watch } from 'vue'
import { SearchResult } from '@/views/api/types'
import {CapitalizeFirstLetter} from "@/views/utils/function"
// import type { VDataTable } from 'vuetify/lib/components/index.mjs'
import router from '@/views/router';
import {Header} from "@/entityTypes/commonType"
import DeleteDialog from '@/views/components/widgets/deleteDialog.vue';
const {t} = useI18n({inheritLocale: true});

// const campaignId = i18n.t("campaignId");
type Fetchparam = {
    page: number,
    itemsPerPage: number,
    sortBy?: {key:string,order:string},
    search: string
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<EmailFilterdata>> {
        const fpage=(fetchparam.page-1)*fetchparam.itemsPerPage
        return await getEmailfilterlist({ page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
    }
}
const selected=ref<Array<EmailFilterdata>>([]);
const headers=ref<Array<Header>>([])
headers.value = [
    {
        title: CapitalizeFirstLetter(t("emailfilter.id")),
        align: 'start',
        sortable: false,
        key: 'id',
    },
    {
        title: CapitalizeFirstLetter(t("emailfilter.name")),
        align: 'start',
        sortable: false,
        key: 'name',
    },
   
    {
        title: CapitalizeFirstLetter(t("common.created_time")),
        align: 'start',
        sortable: false,
        key: 'created_time',
    },
    { title: CapitalizeFirstLetter(t("common.actions")), key: 'actions', sortable: false },

];
const itemsPerPage = ref(10);
const serverItems = ref<Array<EmailFilterdata>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
const deleteId = ref(0);
const showDeleteModal = ref(false);

// Define props
const props = defineProps({
  isSelectedtable: {
    type: Boolean,
    
    default:false,
  }
  
});

// Computed headers array based on the condition
const computedHeaders = computed(() => {
  if (props.isSelectedtable) {
    return headers.value.filter(value => value.key !== 'actions');
  } else {
    return headers.value;
  }
});  

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
// },
// }
const editItem = (item) => {
 
    // else if(item.Types=="social task"){
        
    // }
    router.push({
        name:"Email_Marketing_Filter_Detail",params: { id: item.id }
    });
};
const deleteitem=(item:EmailFilterdata)=>{
    
    if (item.id) {
      deleteId.value = item.id;
    }  
    showDeleteModal.value = true;
  }
function createFilter(){
    router.push({
        name: 'Email_Marketing_Filter_Create'
    });
}
const handleDelete=async ()=>{
    showDeleteModal.value = false;
    loading.value = true;
    const res=await deleteEmailFilter(deleteId.value)
    if(res){
        console.log(res)
        loading.value = false;
        loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: "" });
    }
}

const emit = defineEmits(['change'])
watch(selected, (newValue:Array<EmailFilterdata>|undefined, oldValue:Array<EmailFilterdata>|undefined) => {
  console.log(`selected filter changed from ${oldValue} to ${newValue}`);
  console.log(newValue)
  emit('change', newValue);
});
</script>