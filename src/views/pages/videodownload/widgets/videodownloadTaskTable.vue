<template>
    <div class="search_bar mt-4 d-flex jsb mb-5">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field rounded class="elevation-0" density="compact" variant="solo" label="Search"
                    append-inner-icon="mdi-magnify" single-line hide-details v-model="search"></v-text-field>
            </div>
            <!-- <v-btn class="btn" variant="flat" prepend-icon="mdi-filter-variant"><span> More</span></v-btn> -->
            <v-btn class="btn ml-3" variant="flat" prepend-icon="mdi-plus" color="#5865f2" @click="createDownload()">
                {{ t('video.new_video_download') }}
            </v-btn>

        </div>
        <div>
        </div>
    </div>
    <v-data-table-server v-model:items-per-page="itemsPerPage" :search="search" :headers="headers"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name"
        @update:options="loadItems">
        <template v-slot:item.status="{ item }">
            <v-chip color="grey" v-if="item.status === TaskStatus.Notstart">{{ CapitalizeFirstLetter(t('common.not_start')) }}</v-chip>
            <v-chip color="blue" v-if="item.status === TaskStatus.Processing">{{ CapitalizeFirstLetter(t('common.processing')) }}</v-chip>
            <v-chip color="green" v-if="item.status === TaskStatus.Complete">{{ CapitalizeFirstLetter(t('common.complete')) }}</v-chip>
            <v-chip color="red" v-if="item.status === TaskStatus.Error">{{ CapitalizeFirstLetter(t('common.error')) }}</v-chip>
        </template>
        <template v-slot:[`item.actions`]="{ item }">

            <v-icon size="small" class="me-2" @click="openTasklist(item)">
                mdi-login
            </v-icon>
            <v-icon size="small" class="me-2" @click="taskRetry(item)" v-if="item.status !== TaskStatus.Processing">
                mdi-play
            </v-icon>
            <v-icon size="small" class="me-2" @click="showLog(item)" v-if="item.status === TaskStatus.Error">
                mdi-file-document
            </v-icon>

        </template>
       
    </v-data-table-server>
    <LogDialog :dialogModel="logdiastatus" :logContent="logdiaContent" @dialogclose="logdiastatus = false" />
    <ErrorDialog :showDialog="showDialog" :alertext="alertext" :alertitle="alerttitle"
        @dialogclose="showDialog = false" />
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue'
import { SearchResult } from '@/views/api/types'
import { getVideoTasklist, retryVideoTask, queryVideoTaskErrorlog, receiveVideoTaskDownloadRetryMessage } from "@/views/api/video";
import { VideoDownloadTaskEntityType } from "@/entityTypes/videoType";
import { TaskStatus } from "@/entityTypes/commonType";
import router from '@/views/router';
const { t } = useI18n({ inheritLocale: true });
import { CapitalizeFirstLetter } from "@/views/utils/function"
import LogDialog from "@/views/components/widgets/logDialog.vue"
import ErrorDialog from "@/views/components/widgets/errorDialog.vue"

const showDialog = ref<boolean>(false);
const alertext = ref<string>("")
const alerttitle = ref<string>("")
type Fetchparam = {
    // id:number
    page: number,
    itemsPerPage: number,
    sortBy: { key: string, order: string },
    search: string
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<VideoDownloadTaskEntityType>> {
        // console.log(fetchparam.search)
        const fpage = (fetchparam.page - 1) * fetchparam.itemsPerPage
        
        const res = await getVideoTasklist({ page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
        console.log(res)
        return res
        // const resp:SearchResult<VideoDownloadTaskEntityType>={
        //     data:[],
        //     total:0
        // }
        // return resp
    }
}


const headers: Array<any> = [
    {
        title: computed(_ => CapitalizeFirstLetter(t("common.id"))),
        align: 'start',
        sortable: false,
        key: 'id',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("video.task_name"))),
        align: 'start',
        sortable: false,
        key: 'taskName',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("video.platform"))),
        align: 'start',
        sortable: false,
        key: 'platform'
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("video.saved_path"))),
        align: 'start',
        sortable: false,
        key: 'savepath',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("common.record_time"))),
        align: 'start',
        sortable: false,
        key: 'record_time',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("common.status"))),
        align: 'start',
        sortable: false,
        key: 'status',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("common.actions"))),
        align: 'start',
        key: 'actions',
        sortable: false,
    },


];
const itemsPerPage = ref(10);
const serverItems = ref<Array<VideoDownloadTaskEntityType>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
let refreshInterval: ReturnType<typeof setInterval> | undefined;
// const showDeleteModal = ref(false);
// const deleteId = ref(0);
// const alertext = ref("");
const logdiastatus = ref(false);
const logdiaContent = ref("");
function loadItems({ page, itemsPerPage, sortBy }) {
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

            console.log(data)
            console.log(total)
            if (!data) {
                data = [];
            }
            serverItems.value = data
            totalItems.value = total
            loading.value = false
        }).catch(function (error) {
            console.error(error);
        })
}


// const cancelDelete=()=> {
//       showDeleteModal.value = false;
// }
//confirm delete account
const createDownload = () => {
    console.log("createDownload")
    router.push({
        name:"Videodownload"
    });
}

const openTasklist = (item: VideoDownloadTaskEntityType) => {
    console.log(item)
    if (item.id) {
        router.push({
            name: "VideoList", params: { taskid: item.id }
        });
    }
};
const taskRetry = async (item: VideoDownloadTaskEntityType) => {
    if (item.id) {
        await retryVideoTask(item.id)
        loadItemfun()
    }
}
const showLog = async (item) => {
    if (item.id) {
        await queryVideoTaskErrorlog(item.id).then((res) => {
            console.log(res)
            logdiaContent.value = res
            logdiastatus.value = true
        }).catch(function (error) {
            console.log("error happened")
            console.error(error);
            
            setAlert(error.message, t('common.error'));
        })
        // if (res) {

        // }  
    }
}
const options = reactive({
    page: 1, // Initial page
    itemsPerPage: 10, // Items per page
});
const startAutoRefresh = () => {
    refreshInterval = setInterval(function () {
        loadItemfun();
    }, 10000); // Refresh every 5 seconds
}
const loadItemfun=()=>{
    loadItems({ page: options.page, itemsPerPage: options.itemsPerPage, sortBy: "" });
}
const stopAutoRefresh = () => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = undefined;
    }
};
onMounted(() => {
    receiveVideoTaskDownloadRetryMessage((data) => {
        console.log(data)
        if (data.status) {
            setAlert(t('video.video_task__download_retry_start'), t('common.success'));
        
        } else {
            if (data.data) {
                setAlert(t(data.data.content), t(data.data.title));
            }else{
                setAlert(t('common.unkonw_error'), t('common.error'));
            }
        }
    })

    startAutoRefresh();

});
onUnmounted(() => {
    stopAutoRefresh();
});
const setAlert = (
    text: string,
    title: string
) => {
    loading.value = false;
    alertext.value = text;
    alerttitle.value = title;

    showDialog.value = true;
    setTimeout(() => {
        showDialog.value = false;
    }, 5000);
};

</script>