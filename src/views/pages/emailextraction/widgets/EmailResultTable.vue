<template>
  <!-- extraction task list table -->
  <v-data-table-server v-model="selected" :items-per-page="itemsPerPage" :search="search" :headers="computedHeaders"
    :items-length="totalItems" :items="serverItems" :loading="loading" item-key="id" @update:options="loadItems"
    class="custom-data-table" show-expand :show-select="isSelectedtable" select-strategy="single" return-object>
    <template v-slot:[`item.actions`]="{ item }" v-if="isSelectedtable != true">
      <v-icon size="small" class="me-2" @click="openfolder(item)">
        mdi-folder
      </v-icon>
      <v-icon size="small" class="me-2" v-if="item.statusName == 'Error'" @click="downloadErrorlog(item)">
        mdi-download
      </v-icon>

    </template>
    <template v-slot:expanded-row="{ columns, item }">
      <tr>
        <td :colspan="columns.length">
          <div class="ellipsis-cell">
            <div v-for="(url, index) in item.urls" :key="index" class="url-item">
              {{ url }}
            </div>
          </div>
        </td>
      </tr>
    </template>
  </v-data-table-server>


</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { listEmailSearchtasks, downloadErrorLog } from '@/views/api/emailextraction'
//import {SearchTaskItemdisplay} from '@/entityTypes/emailextraction-type'
import { ref, computed, onMounted, onUnmounted, reactive, watch } from 'vue'
import { SearchResult } from '@/views/api/types'
// import type { VDataTable } from 'vuetify/lib/components/index.mjs'
import router from '@/views/router';
// import {SearchtaskItem } from "@/entityTypes/searchControlType"
import { CapitalizeFirstLetter } from "@/views/utils/function"
import { EmailsearchTaskEntityDisplay } from '@/entityTypes/emailextraction-type'
const { t } = useI18n({ inheritLocale: true });
import { Header } from "@/entityTypes/commonType"
// Define props
const props = defineProps({
  isSelectedtable: {
    type: Boolean,

    default: false,
  }

});


const selected = ref<EmailsearchTaskEntityDisplay>();
const options = reactive({
  page: 1, // Initial page
  itemsPerPage: 10, // Items per page
});

// const campaignId = i18n.t("campaignId");
type Fetchparam = {
  page: number,
  itemsPerPage: number,
  sortBy?: { key: string, order: string },
  search: string
}

const FakeAPI = {
  async fetch(fetchparam: Fetchparam): Promise<SearchResult<EmailsearchTaskEntityDisplay>> {
    const fpage = (fetchparam.page - 1) * fetchparam.itemsPerPage
    return await listEmailSearchtasks({ page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
  }
}

const headers = ref<Array<Header>>([])


// Computed headers array based on the condition
const computedHeaders = computed(() => {
  if (props.isSelectedtable) {
    return headers.value.filter(value => value.key !== 'actions');
  } else {
    
    return headers.value;
  }
});
let refreshInterval: ReturnType<typeof setInterval> | undefined;

headers.value = [
  {
    title: CapitalizeFirstLetter(t("emailextraction.id")),
    align: 'center',
    sortable: true,
    key: 'id',
    width: '5%'
  },
  {
    title: CapitalizeFirstLetter(t("emailextraction.type")),
    align: 'center',
    sortable: false,
    key: 'typeName',
    width: '10%'
  },
  // {
  //     title: computed(_ => CapitalizeFirstLetter(t("emailextraction.url"))),
  //     align: 'start',
  //     sortable: false,
  //     key: 'url',
  //     // value: computed(value => value.join(', '))
  // },
  {
    title: CapitalizeFirstLetter(t("searchresult.status")),
    align: 'start',
    sortable: false,
    key: 'statusName',
    width: '10%'
  },
  {
    title: CapitalizeFirstLetter(t("searchresult.record_time")),
    align: 'start',
    sortable: false,
    key: 'record_time',
    width: '10%'
  },
  {
    title: 'Actions',
    key: 'actions',
    sortable: false,
    width: '10%'
  },
  { title: '', key: 'data-table-expand', sortable: false },
];
const itemsPerPage = ref(10);
const serverItems = ref<Array<EmailsearchTaskEntityDisplay>>([]);
const loading = ref(false);

const totalItems = ref(0);
const search = ref('');
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

function loadItems({ page = 1, itemsPerPage = 10, sortBy }) {
  options.page = page;
  loading.value = true
  options.page = page;
  options.itemsPerPage = itemsPerPage;
  console.log(sortBy)
  // console.log(page);

  const fetchitem: Fetchparam = {
    page: page,
    itemsPerPage: itemsPerPage,

    search: search.value
  }
  if (sortBy.length) {
    console.log("sort have value")
    fetchitem.sortBy = { key: sortBy[0].key, order: sortBy[0].order }

  }
  //    console.log(fetchitem)
  FakeAPI.fetch(fetchitem).then(
    ({ data, total }) => {
      console.log(data)
      // console.log(total)
      // data.forEach((item) => {
      //     item.urlString=item.urls.join(',')
      // })
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

// else if(item.Types=="social task"){

// }
// router.push({
//     path: '/graphics/oasis-engine',
// });
// };
const openfolder = (item) => {
  // console.log(item)
  router.push({
    name: 'Email_Extraction_Task_Detail', params: { id: item.id }
  });
}
const downloadErrorlog = async (item) => {
    try {
        const content = await downloadErrorLog(item.id)
        // Create a blob and download the file
        const blob = new Blob([content], { type: 'text/plain' })
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `error_log_${item.id}.txt`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
    } catch (error) {
        console.error('Failed to download error log:', error)
    }
}
const emit = defineEmits(['change'])

onMounted(() => {


  startAutoRefresh();
});
watch(selected, (newValue: EmailsearchTaskEntityDisplay | undefined, oldValue: EmailsearchTaskEntityDisplay | undefined) => {
      console.log(`selectedtask changed from ${oldValue} to ${newValue}`);
      console.log(newValue)
      emit('change', newValue);
    });

onUnmounted(() => {
  stopAutoRefresh();
});

</script>
<style scoped>
.custom-data-table .v-data-table__wrapper tr {
  height: 50px;
  /* Set the desired row height */
}

.custom-data-table .v-data-table__wrapper td {
  height: 50px;
  /* Set the desired cell height */
}

.ellipsis-cell {
  height: calc(10 * 1.2em);
  /* 4 lines with a line height of 1.2em */
  line-height: 1.2em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80%;
  /* Adjust the width as needed */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  white-space: normal;
}
</style>