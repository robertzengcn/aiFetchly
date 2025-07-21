<template>

  <div class="search_bar mt-4 d-flex jsb mb-5">
    <div class="d-flex jsb search_tool">
      <div class="search_wrap mr-4">
        <v-text-field rounded class="elevation-0" density="compact" variant="solo" label="Search"
          append-inner-icon="mdi-magnify" single-line hide-details v-model="search"></v-text-field>
      </div>

      <v-btn @click="loadItems({ page: options.page, itemsPerPage: options.itemsPerPage, sortBy: '' })">
        <v-icon>mdi-refresh</v-icon>
      </v-btn>
      <v-btn class="btn ml-3" variant="flat" prepend-icon="mdi-plus" color="#5865f2" @click="showLangDialog=true">
        {{ CapitalizeFirstLetter(t('video.generate_captions')) }}
      </v-btn>
      <v-btn class="btn ml-3" variant="flat" prepend-icon="mdi-plus" color="green" @click="showTranslateInfroDialog=true">
        {{ CapitalizeFirstLetter(t('video.translate_information')) }}
      </v-btn>
      <v-btn class="btn ml-3" variant="flat" prepend-icon="mdi-cloud-upload" color="purple" @click="showPublishDialog=true">
        {{ CapitalizeFirstLetter(t('video.publish_video')) }}
      </v-btn>
    </div>
    <div>
    </div>
  </div>
  <v-data-table-server v-model="selected" :items-per-page="itemsPerPage" :search="search" :headers="computedHeaders"
    :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems"
    :show-select="isSelectedtable" return-object>
    <template v-slot:item.caption_status="{ item }">
      <v-chip color="grey" v-if="item.caption_status?.toString() == '0'">{{ CapitalizeFirstLetter(t('common.not_start')) }}</v-chip>
      <v-chip color="blue" v-if="item.caption_status?.toString() == '1'">{{ CapitalizeFirstLetter(t('common.processing')) }}</v-chip>
      <v-chip color="green" v-if="item.caption_status?.toString() == '2'">{{ CapitalizeFirstLetter(t('common.complete')) }}</v-chip>
      <v-chip color="red" v-if="item.caption_status?.toString() == '3'">{{ CapitalizeFirstLetter(t('common.error')) }}</v-chip>
    </template>
    <template v-slot:item.status="{ item }">
      <v-chip color="grey" v-if="item.status.toString() == '0'">{{ CapitalizeFirstLetter(t('common.not_start')) }}</v-chip>
      <v-chip color="blue" v-if="item.status.toString() == '1'">{{ CapitalizeFirstLetter(t('common.processing')) }}</v-chip>
      <v-chip color="green" v-if="item.status.toString() == '2'">{{ CapitalizeFirstLetter(t('common.complete')) }}</v-chip>
      <v-chip color="red" v-if="item.status.toString() == '3'">{{ CapitalizeFirstLetter(t('common.error')) }}</v-chip>
    </template>
    <template v-slot:[`item.actions`]="{ item }">
      <v-icon size="small" class="me-2" @click="retryDownload(item)" v-if="item.status.toString() == '3'">
        mdi-restart
      </v-icon>
      <v-icon size="small" class="me-2" @click="openfile(item)" v-if="item.status.toString() == '2'&&item.savepath.length>0">
        mdi-folder-open
      </v-icon>
      <v-icon size="small" @click="deleteitem(item)">
        mdi-delete
      </v-icon>
      <v-icon size="small" class="me-2" @click="showitemLog(item)" v-if="item.status.toString() == '3'">
        mdi-file-document
      </v-icon>
      <v-icon size="small" class="me-2" @click="downloadErrorLog(item)" v-if="item.status.toString() == '3'">
        mdi-download
      </v-icon>
      <v-icon size="small" @click="openDetail(item)">
        mdi-information
      </v-icon>
    </template>
    <template v-slot:[`item.url`]="{ item }">

      {{ item.url.substring(0, 50) + '...'}}
  </template>
  </v-data-table-server>
  <delete-dialog :dialog="showDeleteModal" @confirm-delete="handleDelete"
    @confirm-close="showDeleteModal = false"></delete-dialog>

  <ErrorDialog :showDialog="alert" :alertext="alerttext" :alertitle="alerttitle" @dialogclose="alert = false" />
  <LogDialog :dialogModel="logdiastatus" :logContent="logdiaContent" @dialogclose="logdiastatus = false" />
  <v-dialog v-model="showLangDialog" max-width="500px"> 
    <v-card>
      <v-card-title class="headline">{{ CapitalizeFirstLetter(t('video.video_language_select')) }}</v-card-title>
      <v-card-text>
        <row>
         
          <v-row>
            <v-col cols="12" md="12">      
            <v-text-field :label="t('video.caption_save_path')" :hint="t('video.input_caption_save_path')" persistent-hint required
              type="input" @click="captionselectPath" v-model="captionsavePath" class="mt-2" :rules="[rules.required]" ></v-text-field>
            </v-col>
          </v-row> 
        </row>
        <!-- <row>
      <v-label>{{ CapitalizeFirstLetter(t('video.is_english_video'))}}:</v-label>

      <v-btn-toggle v-model="isEnglish" mandatory class="ml-3">
        <v-btn :value="true" color="primary">{{ t('common.yes') }}</v-btn>
        <v-btn :value="false" color="success">{{ t('common.no') }}</v-btn>
      </v-btn-toggle>
    </row> -->
   

    </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="blue darken-1"  @click="showLangDialog=false">{{ t('common.cancel') }}</v-btn>
        <v-btn color="blue darken-1"  @click="generateCaptions">{{ t('common.confirm') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="showTranslateInfroDialog" max-width="500px"> 
    <v-card>
      <v-card-title class="headline">{{ CapitalizeFirstLetter(t('video.translate_video_information')) }}</v-card-title>
      <v-card-text>
       
         
          <!-- <v-row>
          <v-col cols="12" md="12">
            <v-label>{{ CapitalizeFirstLetter(t('video.source_language')) }}:</v-label>
            <v-select
            v-model="sourcelan"
            :items="languagelist"
              :label="t('video.select_language')"
              item-title="name"
              item-value="code"
              return-object
              class="mt-2"
              :rules="[rules.required]"
            ></v-select>
          </v-col>
          </v-row>  -->
        
        <row>
          <v-col cols="12" md="12">
            <v-label>{{ CapitalizeFirstLetter(t('video.target_language')) }}:</v-label>
            <v-select
            v-model="targetlan"
            :items="languagelist"
              :label="t('video.select_language')"
              item-title="name"
              item-value="code"
              return-object
              
              class="mt-2"
              :rules="[rules.required]"
            ></v-select>
          </v-col>
    </row>
    <row>
      <v-col cols="12" md="12">
      <TranslateComponent @update:selectedTool="selectedTranslateTool = $event" />
    </v-col>
    </row>
   

    </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="blue darken-1" @click="showTranslateInfroDialog=false">{{ t('common.cancel') }}</v-btn>
        <v-btn color="blue darken-1" @click="translateVideoInfo">{{ t('common.confirm') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="showPublishDialog" max-width="500px"> 
    <v-card>
      <v-card-title class="headline">{{ CapitalizeFirstLetter(t('video.publish_video')) }}</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="12">
            <v-label>{{ CapitalizeFirstLetter(t('video.select_platform')) }}:</v-label>
            <v-select
              v-model="selectedPlatform"
              :items="platformOptions"
              :label="t('video.select_platform')"
              item-title="name"
              item-value="value"
              return-object
              class="mt-2"
              :rules="[rules.required]"
            ></v-select>
          </v-col>
        </v-row>
        <v-row v-if="selectedPlatform">
          <v-col cols="12" md="12">
            <v-label>{{ CapitalizeFirstLetter(t('video.select_category')) }}:</v-label>
            <v-select
              v-model="selectedCategory"
              :items="getCategoriesForPlatform(selectedPlatform.value)"
              :label="t('video.select_category')"
              class="mt-2"
              :rules="[rules.required]"
            ></v-select>
          </v-col>
        </v-row>
        <v-row v-if="selectedPlatform">
          <v-col cols="12" md="12">
            <v-label>{{ CapitalizeFirstLetter(t('video.select_account')) }}:</v-label>
            <AccountSelectedTable :accountSource="selectedPlatform.value" @change="handleAccountChange" />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="blue darken-1" @click="showPublishDialog=false">{{ t('common.cancel') }}</v-btn>
        <v-btn color="blue darken-1" @click="publishVideo">{{ t('common.confirm') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ref, computed, onMounted, reactive, onUnmounted } from 'vue'
import { SearchResult } from '@/views/api/types'
import { useRoute } from "vue-router";
import { getVideolistbyTaskId, retryVideoDownloadId, receiveVideoItemDownloadMessage, openFileexplor, deleteVideoDownItem, generateCaption,
  receiveVideoCaptionGenerateMessage,queryVideoItemdownloadlog,translateInformation, downloadErrorLog as downloadErrorLogApi } from "@/views/api/video";
import { VideoDownloadListDisplay,VideoCaptionGenerateParamWithIds,VideoInformationTransParam } from "@/entityTypes/videoType";
import router from '@/views/router';
import { CapitalizeFirstLetter } from "@/views/utils/function"
import { CommonDialogMsg } from "@/entityTypes/commonType";
import ErrorDialog from "@/views/components/widgets/errorDialog.vue"
import DeleteDialog from '@/views/components/widgets/deleteDialog.vue';
import TranslateComponent from '@/views/components/select/TranslateSelect.vue';
import { Header } from "@/entityTypes/commonType"
import { opendialog} from "@/views/api/video";
import LogDialog from "@/views/components/widgets/logDialog.vue"
import {LanguageConfig} from "@/config/LanguageConfig"
import {LanguageItem} from '@/entityTypes/commonType'
import { PublishPlatform, VideoPublishRequest } from "@/entityTypes/videoPublishType";
import { publishVideo as publishVideoApi } from "@/views/api/video";
import { VideoPublishPlatformConfig } from "@/config/videosetting";
import AccountSelectedTable from "@/views/pages/socialaccount/widgets/AccountSelectedTable.vue";
import { SocialAccountListData } from '@/entityTypes/socialaccount-type';
const selected = ref<Array<VideoDownloadListDisplay>>([]);
const headers = ref<Array<Header>>([])
const $route = useRoute();
const captionsavePath = ref("");
const { t } = useI18n({ inheritLocale: true });
const rules = {
  required: (value) => !!value || "Field is required",
};
const languagelist=ref<Array<LanguageItem>>(LanguageConfig)
const targetlan=ref<LanguageItem>()
const selectedTranslateTool = ref('');
// const sourcelan=ref<LanguageItem>()
type Fetchparam = {
  // id:number

  page: number,
  itemsPerPage: number,
  sortBy: { key: string, order: string },
  search: string
}
// const crouter = createRouter({
//   history: createWebHistory(process.env.BASE_URL),
//   routes
// });

// router.beforeEach((to, from, next) => {
//   const baseTitle = to.meta.title || 'Default Title';
//   if (to.params.taskid) {
//     document.title = `${baseTitle} - Task ID: ${to.params.taskid}`;
//   } else {
//     document.title = String(baseTitle);
//   }
//   next();
// });

const FakeAPI = {
  async fetch(fetchparam: Fetchparam): Promise<SearchResult<VideoDownloadListDisplay>> {
    // console.log(fetchparam.search)
    const fpage = (fetchparam.page - 1) * fetchparam.itemsPerPage
    const taskId = parseInt($route.params.taskid.toString());
    const res = await getVideolistbyTaskId({ taskId: taskId, page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })

    return res
  }
}


headers.value = [
  {
    title: computed(_ => CapitalizeFirstLetter(t("common.id"))).value as string,
    align: 'start',
    sortable: false,
    key: 'id',
  },
  {
    title: computed(_ => CapitalizeFirstLetter(t("video.url"))).value as string,
    align: 'start',
    sortable: false,
    key: 'url',
    width: '60px'
  },
  {
    title: computed(_ => CapitalizeFirstLetter(t("video.title"))).value as string,
    align: 'start',
    sortable: false,
    key: 'title',
  },
  {
    title: computed(_ => CapitalizeFirstLetter(t("common.status"))).value as string,
    align: 'start',
    sortable: false,
    key: 'status',
  },
  {
    title: computed(_ => CapitalizeFirstLetter(t("video.caption_status"))).value as string,
    align: 'start',
    sortable: false,
    key: 'caption_status',
  },
  {
    title: computed(_ => CapitalizeFirstLetter(t("common.record_time"))).value as string,
    align: 'start',
    sortable: false,
    key: 'record_time',
  },
  {
    title: computed(_ => CapitalizeFirstLetter(t("common.actions"))).value as string,
    align: 'start',
    key: 'actions',
    sortable: false,
  },


];
const itemsPerPage = ref(10);
const serverItems = ref<Array<VideoDownloadListDisplay>>([]);
const loading = ref(false);
const showLangDialog = ref(false);
//const isEnglish = ref<boolean>(true);
const totalItems = ref(0);
const search = ref('');
const alert = ref(false);
const alerttext = ref("");
const alerttitle = ref("");
const alerttype = ref<"success" | "error" | "warning" | "info" | undefined>(
  "success"
);
const deleteId = ref(0);
const showDeleteModal = ref(false);
let refreshInterval: ReturnType<typeof setInterval> | undefined;
const options = reactive({
  page: 1, // Initial page
  itemsPerPage: 100, // Items per page
});
const showTranslateInfroDialog=ref(false);
const logdiaContent = ref("");
const logdiastatus = ref(false);
// const taskId=ref(0);
// const showDeleteModal = ref(false);
// const deleteId=ref(0);
// const alertext=ref("");
defineProps({
  isSelectedtable: {
    type: Boolean,

    default: true,
  }

});
const computedHeaders = computed(() => {
  // if (props.isSelectedtable) {
  //   return headers.value.filter(value => value.key !== 'actions');
  // } else {
    return headers.value;
  // }
});
const captionselectPath = async () => {
  const res = await opendialog();
  console.log(res);
  captionsavePath.value = res;
};
function loadItems({ page, itemsPerPage, sortBy }) {
  options.page = page;
  options.itemsPerPage = itemsPerPage;
  loading.value = true

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


const retryDownload = async (item: VideoDownloadListDisplay) => {
  if (item.id) {
    await retryVideoDownloadId(item.id)
    // if(res){
    //     loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: { key: 'id', order: 'asc' } })
    // }
  }
}
//open file in explorer
const openfile = (item: VideoDownloadListDisplay) => {
  if (item.id) {
    openFileexplor(item.id)
  }
}
const deleteitem = (item: VideoDownloadListDisplay) => {
  console.log(item)
  if (item.id) {
    deleteId.value = item.id;
    showDeleteModal.value = true;
  }

}
const showitemLog= async (item: VideoDownloadListDisplay) => {
  if (item.id) {
        await queryVideoItemdownloadlog(item.id).then((res) => {
            logdiaContent.value = res
            logdiastatus.value = true
        }).catch(function (error) {
            console.log("error happened")
            console.error(error);
            //setAlert(error.message, t('common.error'));
            setAlert(error.message, t('common.error'), "error");
        }) 
    }
}
const handleDelete = async () => {
  showDeleteModal.value = false;
  loading.value = true;
  await deleteVideoDownItem(deleteId.value)

  // const res=await deleteEmailFilter(deleteId.value)
  // if(res){
  //     console.log(res)
  //     loading.value = false;
  //     loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: "" });
  // }
}
// const cancelDelete=()=> {
//       showDeleteModal.value = false;
// }
//confirm delete account
// const createDownload=()=>{
//     router.push({
//           path: '/video/download'
//         });
// }
const startAutoRefresh = () => {
  refreshInterval = setInterval(function () {
    loadItems({ page: options.page, itemsPerPage: options.itemsPerPage, sortBy: "" });
  }, 10000); // Refresh every 5 seconds
}
const stopAutoRefresh = () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }
};
const generateCaptions = async () => {
  showLangDialog.value = false;
  const ids: Array<number> = []
  selected.value.forEach(element => {
    if (element.id) {
      ids.push(element.id)
    }
  });
  const data:VideoCaptionGenerateParamWithIds<number>={
    ids:ids,
    //isEnglish:isEnglish.value,
    savePath:captionsavePath.value
  }
  await generateCaption(data)
}

const openDetail = (item: VideoDownloadListDisplay) => {
  if (item.id) {
    router.push({
      name: "VideoDetail", params: { id: item.id }
    });
  }
}
const translateVideoInfo=async()=>{
  const ids: Array<number> = []
  selected.value.forEach(element => {
    if (element.id) {
      ids.push(element.id)
    }
  });
  if(selected.value.length==0){
    setAlert(t('Please select a video'), t('common.error'), "error");
    return;
  }
  if(!targetlan.value){
    setAlert(t('video.select_language_error'), t('common.error'), "error");
    return;
  }
  // Get the selectedTool from the child component
  if (!selectedTranslateTool.value) {
    setAlert(t('Please select a translation tool'), t('common.error'), "error");
    return;
  }
  console.log(selectedTranslateTool.value)
 
  const data:VideoInformationTransParam<number>={
    ids:ids,
    // source_language:sourcelan.value,
    target_language:targetlan.value,
    translate_tool:selectedTranslateTool.value

  }
  await translateInformation(data)
  showTranslateInfroDialog.value=false;
}
const downloadErrorLog = async (item: VideoDownloadListDisplay) => {
  try {
    if(item.id){
      await downloadErrorLogApi(item.id)
    }else{
      setAlert(t('video.select_video_error'), t('common.error'), "error");
    }
  } catch (error) {
    console.error('Failed to download error log:', error)
    setAlert(error instanceof Error ? error.message : 'Failed to download error log', t('common.error'), "error")
  }
}
const showPublishDialog = ref(false);
const selectedPlatform = ref<{ name: string; value: PublishPlatform } | null>(null);
const selectedCategory = ref<string>('');
const selectedAccount = ref<SocialAccountListData[]>([]);

const platformOptions = [
  { name: 'YouTube', value: PublishPlatform.YOUTUBE },
  { name: 'Bilibili', value: PublishPlatform.BILIBILI },
  { name: 'Baidu', value: PublishPlatform.BAIDU }
];

const getCategoriesForPlatform = (platform: PublishPlatform) => {
  const platformConfig = VideoPublishPlatformConfig.find(p => p.name === platform);
  return platformConfig?.videoCategories || [];
};

const handleAccountChange = (accounts: SocialAccountListData[]) => {
  selectedAccount.value = accounts;
};

const publishVideo = async () => {
  if (!selectedPlatform.value || !selectedCategory.value) {
    setAlert(t('video.select_platform_and_category'), t('common.error'), "error");
    return;
  }

  if (selected.value.length === 0) {
    setAlert(t('Please select a video'), t('common.error'), "error");
    return;
  }

  if (selectedAccount.value.length === 0) {
    setAlert(t('video.select_account_error'), t('common.error'), "error");
    return;
  }

  const videoId = selected.value[0].id;
  if (!videoId) {
    setAlert(t('Invalid video selection'), t('common.error'), "error");
    return;
  }

  const request: VideoPublishRequest = {
    videoId: videoId,
    platform: selectedPlatform.value.value,
    category: selectedCategory.value,
    accountId: selectedAccount.value[0].id
  };

  try {
    await publishVideoApi(request);
    showPublishDialog.value = false;
    setAlert(t('video.publish_started'), t('common.success'), "success");
  } catch (error: any) {
    setAlert(error.message || t('video.publish_failed'), t('common.error'), "error");
  }
};
onMounted(() => {
  receiveVideoItemDownloadMessage((res: CommonDialogMsg) => {
    console.log(res)
    //revice system message
    if (res.status) {
      // if (res.code == 200) {
      //show message to user
      if (res.data) {
        setAlert(t(res.data.content), t('common.success'), "success");
      }
      // } else {
      //   //handle other message
      //   //append msg to logs
      //   logs.value += res.data.content + "\n";
      // }
      //   if (res.code == 200) {
      //     // route to new page
      //     router.push({
      //       path: '/video/dowloadtasklist'
      //     });
      //   }
    } else {
      if (res.data) {
        setAlert(t(res.data.content), t('common.error'), "error");
      }
      //handle failure
      //append msg to logs with red color
      // logs.value += res.data.content + "\n";
    }
  });

  receiveVideoCaptionGenerateMessage((res: CommonDialogMsg) => {
    console.log(res)
    //revice system message
    if (res.status) {
      // if (res.code == 200) {
      //show message to user
      if (res.data) {
        setAlert(t(res.data.content), t('common.success'), "success");
      }
    }else{
      if (res.data) {
        setAlert(t(res.data.content), t('common.error'), "error");
      }
    }
  })
  startAutoRefresh()
});
onUnmounted(() => {
  stopAutoRefresh();
});
const setAlert = (
  text: string,
  title: string,
  type: "success" | "error" | "warning" | "info" | undefined
) => {
  alerttext.value = text;
  alerttitle.value = title;
  alerttype.value = type;
  alert.value = true;
  setTimeout(() => {
    alert.value = false;
  }, 5000);
};

</script>