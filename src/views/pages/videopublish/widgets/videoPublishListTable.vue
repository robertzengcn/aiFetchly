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
    </div>
  </div>

  <v-data-table-server v-model="selected" :items-per-page="itemsPerPage" :search="search" :headers="computedHeaders"
    :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems"
    :show-select="isSelectedtable" return-object>
    
    <template v-slot:item.platform="{ item }">
      <v-chip :color="getPlatformColor(item.platform)">
        {{ getPlatformName(item.platform) }}
      </v-chip>
    </template>

    <template v-slot:item.status="{ item }">
      <v-chip :color="getStatusColor(item.status)">
        {{ getStatusName(item.status) }}
      </v-chip>
    </template>

    <template v-slot:[`item.actions`]="{ item }">
      <v-icon size="small" class="me-2" @click="viewDetails(item)" v-if="item.platform_video_url">
        mdi-open-in-new
      </v-icon>
      <v-icon size="small" class="me-2" @click="showErrorLog(item)" v-if="item.error_message">
        mdi-alert-circle
      </v-icon>
      <v-icon size="small" @click="deleteRecord(item)">
        mdi-delete
      </v-icon>
    </template>
  </v-data-table-server>

  <delete-dialog :dialog="showDeleteModal" @confirm-delete="handleDelete"
    @confirm-close="showDeleteModal = false"></delete-dialog>

  <ErrorDialog :showDialog="alert" :alertext="alerttext" :alertitle="alerttitle" @dialogclose="alert = false" />
  <LogDialog :dialogModel="logdiastatus" :logContent="logdiaContent" @dialogclose="logdiastatus = false" />
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ref, computed, onMounted, reactive } from 'vue'
//import { SearchResult } from '@/views/api/types'
import { Header } from "@/entityTypes/commonType"
import { CapitalizeFirstLetter } from "@/views/utils/function"
import { CommonDialogMsg } from "@/entityTypes/commonType"
import ErrorDialog from "@/views/components/widgets/errorDialog.vue"
import DeleteDialog from '@/views/components/widgets/deleteDialog.vue'
import LogDialog from "@/views/components/widgets/logDialog.vue"
import { PublishPlatform, PublishStatus } from "@/entityTypes/videoPublishType"
import { VideoPublishRecordEntity } from "@/entity/VideoPublishRecord.entity"
//import { shell } from "electron"
import { getPublishRecords, deletePublishRecord, receivePublishRecordMessage } from '@/views/api/videoPublish'

const { t } = useI18n({ inheritLocale: true });

const selected = ref<Array<VideoPublishRecordEntity>>([]);
const headers = ref<Array<Header>>([])
const itemsPerPage = ref(10);
const serverItems = ref<Array<VideoPublishRecordEntity>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
const alert = ref(false);
const alerttext = ref("");
const alerttitle = ref("");
const alerttype = ref<"success" | "error" | "warning" | "info" | undefined>("success");
const deleteId = ref(0);
const showDeleteModal = ref(false);
const logdiaContent = ref("");
const logdiastatus = ref(false);

const options = reactive({
  page: 1,
  itemsPerPage: 100,
});

headers.value = [
  {
    title: computed(_ => CapitalizeFirstLetter(t("common.id"))).value as string,
    align: 'start',
    sortable: false,
    key: 'id',
  },
  {
    title: computed(_ => CapitalizeFirstLetter(t("video.platform"))).value as string,
    align: 'start',
    sortable: false,
    key: 'platform',
  },
  {
    title: computed(_ => CapitalizeFirstLetter(t("common.status"))).value as string,
    align: 'start',
    sortable: false,
    key: 'status',
  },
  {
    title: computed(_ => CapitalizeFirstLetter(t("video.platform_video_id"))).value as string,
    align: 'start',
    sortable: false,
    key: 'platform_video_id',
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

const computedHeaders = computed(() => {
  return headers.value;
});

const getPlatformColor = (platform: PublishPlatform) => {
  switch (platform) {
    case PublishPlatform.YOUTUBE:
      return 'red';
    case PublishPlatform.BILIBILI:
      return 'blue';
    case PublishPlatform.BAIDU:
      return 'green';
    default:
      return 'grey';
  }
};

const getPlatformName = (platform: PublishPlatform) => {
  switch (platform) {
    case PublishPlatform.YOUTUBE:
      return 'YouTube';
    case PublishPlatform.BILIBILI:
      return 'Bilibili';
    case PublishPlatform.BAIDU:
      return 'Baidu';
    default:
      return 'Unknown';
  }
};

const getStatusColor = (status: PublishStatus) => {
  switch (status) {
    case PublishStatus.PENDING:
      return 'grey';
    case PublishStatus.PROCESSING:
      return 'blue';
    case PublishStatus.COMPLETE:
      return 'green';
    case PublishStatus.FAILED:
      return 'red';
    default:
      return 'grey';
  }
};

const getStatusName = (status: PublishStatus) => {
  switch (status) {
    case PublishStatus.PENDING:
      return t('common.pending');
    case PublishStatus.PROCESSING:
      return t('common.processing');
    case PublishStatus.COMPLETE:
      return t('common.complete');
    case PublishStatus.FAILED:
      return t('common.error');
    default:
      return t('common.unknown');
  }
};

const loadItems = async ({ page, itemsPerPage, sortBy }) => {
  options.page = page;
  options.itemsPerPage = itemsPerPage;
  loading.value = true;

  try {
    const response = await getPublishRecords({ 
      page, 
      size: itemsPerPage, 
      search: search.value 
    });
    console.log(response);
    // if(!response){
    //   response.data = [];
    // }
    serverItems.value = response.data;
    totalItems.value = response.total || 0;
  } catch (error) {
    console.error('Failed to load publish records:', error);
    setAlert(t('video.load_records_failed'), t('common.error'), "error");
  } finally {
    loading.value = false;
  }
};

const viewDetails = (item: VideoPublishRecordEntity) => {
  if (item.platform_video_url) {
    //shell.openExternal(item.platform_video_url);
  }
};

const showErrorLog = (item: VideoPublishRecordEntity) => {
  if (item.error_message) {
    logdiaContent.value = item.error_message;
    logdiastatus.value = true;
  }
};

const deleteRecord = (item: VideoPublishRecordEntity) => {
  if (item.id) {
    deleteId.value = item.id;
    showDeleteModal.value = true;
  }
};

const handleDelete = async () => {
  showDeleteModal.value = false;
  loading.value = true;
  try {
    await deletePublishRecord(deleteId.value);
    await loadItems({ page: options.page, itemsPerPage: options.itemsPerPage, sortBy: "" });
  } catch (error) {
    console.error('Failed to delete publish record:', error);
    setAlert(t('video.delete_record_failed'), t('common.error'), "error");
  } finally {
    loading.value = false;
  }
};

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

defineProps({
  isSelectedtable: {
    type: Boolean,
    default: true,
  }
});

onMounted(() => {
  loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: "" });
  
  // receivePublishRecordMessage((res: CommonDialogMsg) => {
  //   if (res.status) {
  //     if (res.data) {
  //       setAlert(t(res.data.content), t('common.success'), "success");
  //     }
  //   } else {
  //     if (res.data) {
  //       setAlert(t(res.data.content), t('common.error'), "error");
  //     }
  //   }
  // });
});
</script>

<style lang="scss">
.search_bar {
  .search_tool {
    .search_wrap {
      flex: 0 0 260px;
    }
    .btn {
      height: 40px;
    }
  }
  .v-field--variant-solo {
    box-shadow: none;
  }
}
</style> 