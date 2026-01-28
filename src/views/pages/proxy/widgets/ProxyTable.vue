<template>
    <div class="search_bar mt-4 d-flex jsb">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field
rounded class="elevation-0" density="compact" variant="solo" label="Search"
                    append-inner-icon="mdi-magnify" single-line hide-details v-model="search"></v-text-field>
            </div>
            <!-- <v-btn class="btn" variant="flat" prepend-icon="mdi-filter-variant"><span> More</span></v-btn> -->
            <v-btn class="btn ml-3" variant="flat" prepend-icon="mdi-plus" color="#5865f2" @click="createProxy()">
               {{ t('proxy.add_proxy') }}
            </v-btn>
            <v-btn
class="btn ml-3" 
            variant="flat" 
            prepend-icon="mdi-check" color="green" 
            :loading="checkloading"
            @click="checkProxy()">
                {{ checkButtonName }}
            </v-btn>
            <v-btn
class="btn ml-3" 
            variant="flat" 
            prepend-icon="mdi-delete" color="red" 
            :loading="removeFailureLoading"
            @click="removefailure()">
            {{ t('proxy.remove_failure') }}
            </v-btn>
            
        </div>
        <div>       
        </div>
    </div>
    <v-data-table-server
class="mt-3" v-model:items-per-page="itemsPerPage" :search="search" :headers="headers"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="id" 
        v-model="selected" show-select @update:options="loadItems">
        <template v-slot:[`item.actions`]="{ item }">
            <v-icon
            size="small"
            class="me-2"
            @click="editProxy(item)"
          >
          mdi-pencil
          </v-icon>
          <v-icon
            size="small" 
            @click="deleteProxybtn(item)"
          >
            mdi-delete
          </v-icon>
          
          
        </template>
    </v-data-table-server>

        <!-- Delete Confirmation Modal -->
        <v-dialog v-model="showDeleteModal" width="auto">
            <v-card
            max-width="400"
            prepend-icon="mdi-update"
            text="The proxy will be delete"
            title="Confirm to delete proxy"
          >
            <template v-slot:actions>
                <v-btn
                class="ms-auto"
                text="Ok"
                color="secondary"
                @click="confirmrmProxy"
                > 
                </v-btn>
              <v-btn
                class="ms-auto"
                text="Cancel"
                @click="showDeleteModal = false"
              ></v-btn>
 
            </template>
          </v-card>
        </v-dialog>
    <div>
     
        <!-- Define the alert dialog component -->
        <v-dialog v-model="showDialog" max-width="500px">
            <v-alert
            color="pink"
            dark
            border="top"
            icon="mdi-home"
            transition="slide-y-transition"
            >
            {{ alertext }}
   </v-alert>
        </v-dialog>
    </div>


</template>

<script setup lang="ts">
import { getProxyList,deleteProxy,checkAllproxy,receiveProxycheckMsg,removeFailureproxy,receiveRemoveproxyMsg} from '@/views/api/proxy'
import { ref,onMounted,computed,reactive } from 'vue'
import { SearchResult } from '@/views/api/types'
import {ProxyListEntity} from "@/entityTypes/proxyType"
// import { useRoute } from "vue-router";
import router from '@/views/router';
import { useI18n } from "vue-i18n";
import { CommonMessage,NumProcessdata } from "@/entityTypes/commonType"
import {CapitalizeFirstLetter} from "@/views/utils/function"
// import { json } from 'stream/consumers';
let refreshInterval:ReturnType<typeof setInterval> | undefined;
const { t } = useI18n({ inheritLocale: true });
const options = reactive({
      page: 1, // Initial page
      itemsPerPage: 10, // Items per page
    });
type Fetchparam = {
    // id:number
    page: number,
    itemsPerPage: number,
    sortBy?: {key:string,order:string},
    search: string
}
const checkButtonName=ref("")
const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<ProxyListEntity>> {
        // console.log(fetchparam.search)
        const fpage=(fetchparam.page-1)*fetchparam.itemsPerPage
        const res=await getProxyList({ page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
        console.log(res)
        return res
    }
}


const headers: Array<any> = [
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.id"))),
        align: 'start',
        sortable: false,
        key: 'id',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.host"))),
        align: 'start',
        sortable: false,
        key: 'host',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.port"))),
        align: 'start',
        sortable: false,
        key: 'port',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.user_name"))),
        align: 'start',
        sortable: false,
        key: 'username',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.password"))),
        align: 'start',
        sortable: false,
        key: 'password',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.protocol"))),
        align: 'start',
        sortable: false,
        key: 'protocol',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.status"))),
        align: 'start',
        sortable: false,
        key: 'statusName',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.check_time"))),
        align: 'start',
        sortable: false,
        key: 'checktime',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.google_pass"))),
        align: 'start',
        sortable: false,
        key: 'googlePassName',
    },
    { title: computed(_ => CapitalizeFirstLetter(t("common.actions"))), key: 'actions', sortable: false },

];
const itemsPerPage = ref(10);
const serverItems = ref<Array<ProxyListEntity>>();
const loading = ref(false);
const checkloading = ref(false);
const removeFailureLoading = ref(false);
const totalItems = ref(0);
const search = ref('');
// Selected proxies in the table (array of proxy IDs, since v-data-table-server returns item-value by default)
const selected = ref<number[]>([]);
// const $route = useRoute();
const showDeleteModal = ref(false);
const deleteId=ref(0);
const showDialog= ref(false);
const alertext=ref("");

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


function loadItems({ page, itemsPerPage, sortBy }) {
    options.page = page;
    loading.value = true
    options.page = page;
  options.itemsPerPage = itemsPerPage;
    const fetchitem: Fetchparam = {
        // id:parseInt(campaignId),
        page: page,
        itemsPerPage: itemsPerPage,
        sortBy: sortBy,
        search: search.value
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {
            //  console.log(data)
            //  console.log(total)
            //loop data
            
            //console.log(data)
            //console.log(total)
            if(!data){
                data=[];
            }
            for(let i=0; i<data.length; i++){
                if(data[i].status == 1){
                    data[i].statusName = CapitalizeFirstLetter(t('proxy.pass'))
                }else if(data[i].status == 2){
                    data[i].statusName =  CapitalizeFirstLetter(t('proxy.failure'))   
                }else{
                    data[i].statusName =  CapitalizeFirstLetter(t('proxy.unkonw'))   
                }
                
                // Map Google pass status to display name (fallback if not set by backend)
                if (!data[i].googlePassName) {
                    if (data[i].googlePass === 1) {
                        data[i].googlePassName = CapitalizeFirstLetter(t('proxy.google_pass_pass'))
                    } else if (data[i].googlePass === 2) {
                        data[i].googlePassName = CapitalizeFirstLetter(t('proxy.google_pass_fail'))
                    } else {
                        data[i].googlePassName = CapitalizeFirstLetter(t('proxy.google_pass_not_checked'))
                    }
                } else {
                    // Ensure it's capitalized (we know it exists from the if condition above)
                    data[i].googlePassName = CapitalizeFirstLetter(data[i].googlePassName!)
                }
            }
            serverItems.value = data
            totalItems.value = total
            loading.value = false
            // Clear selection when data is reloaded
            selected.value = []
        }).catch(function (error) {
            console.error(error);
        })
}

const editProxy=(item)=>{
    router.push({
            name: 'editProxy',params: { id: item.id } 
        });
}
const deleteProxybtn=(item)=>{
    showDeleteModal.value = true;
    deleteId.value=item.id;
}
// const cancelDelete=()=> {
//       showDeleteModal.value = false;
// }
//confirm delete account
const confirmrmProxy=()=>{
    // console.log("delete account")
    deleteProxy(deleteId.value).then(
        () => {
            // console.log(res)
            showDeleteModal.value = false;
            loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: '' })
        }).catch(function (error) {
            console.error(error);
            alertext.value=error.message;
        })
        // loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: '' })
}
const createProxy=()=>{
    router.push({
            name: 'AddProxy' 
        });
}
const checkProxy=()=>{
    // Check if any proxies are selected
    if (selected.value.length === 0) {
        alertext.value = t('proxy.no_proxy_selected') || 'Please select at least one proxy to check';
        showDialog.value = true;
        return;
    }
    
    loading.value = true
    checkloading.value = true
    
    //check selected proxies only
    const selectedIds = selected.value;
    console.log("selectedIds", selectedIds)
    checkAllproxy(selectedIds)
    startAutoRefresh()
    
}
const removefailure=()=>{
    removeFailureLoading.value = true
    //remove failure proxy
    removeFailureproxy()
}

onMounted(() => {
    checkButtonName.value=t('proxy.check_proxy')
    console.log(checkButtonName.value)
    receiveProxycheckMsg((res:string)=>{
        //revice system message
       console.log(res)
       const rest=JSON.parse(res) as CommonMessage<NumProcessdata>
       if(rest&&rest.status){
        console.log(rest.data)
            
              checkButtonName.value=t('proxy.check_proxy_tip',{process:rest.data?.process})
              if((rest.data?.process)&&(rest.data?.process==100)){
                checkloading.value=false;
                loading.value = false
                stopAutoRefresh()
                checkButtonName.value=t('proxy.check_proxy')
              }
             
       }else{
        loading.value = false
        checkloading.value = false
        stopAutoRefresh()
       }
    })
    receiveRemoveproxyMsg((res:string)=>{
        //revice system message
       console.log(res)
       const rest=JSON.parse(res) as CommonMessage<null>
       if(rest&&rest.status){
        loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: '' })
       }
       removeFailureLoading.value = false
    })
}
)



</script>