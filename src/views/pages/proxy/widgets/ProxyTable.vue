<template>
    <div class="proxy-toolbar mt-4">
        <div class="d-flex flex-wrap align-center gap-2 search_tool">
            <div class="search_wrap flex-grow-1" style="min-width: 200px; max-width: 420px">
                <v-text-field
rounded class="elevation-0" density="compact" variant="solo" label="Search"
                    append-inner-icon="mdi-magnify" single-line hide-details v-model="search"></v-text-field>
            </div>
            <!-- Column Visibility Menu -->
            <v-menu>
                <template v-slot:activator="{ props }">
                    <v-btn class="btn ml-3" variant="flat" prepend-icon="mdi-view-column" v-bind="props">
                        <span>{{ t('common.columns') || 'Columns' }}</span>
                    </v-btn>
                </template>
                <v-list class="column-visibility-menu">
                    <v-list-item v-for="header in availableColumns" :key="header.key">
                        <template v-slot:prepend>
                            <v-checkbox-btn
                                :model-value="isColumnVisible(header.key)"
                                @update:model-value="toggleColumn(header.key)"
                            ></v-checkbox-btn>
                        </template>
                        <v-list-item-title>{{ header.title }}</v-list-item-title>
                    </v-list-item>
                </v-list>
            </v-menu>
            <!-- <v-btn class="btn" variant="flat" prepend-icon="mdi-filter-variant"><span> More</span></v-btn> -->
            <v-btn class="btn ml-3" variant="flat" prepend-icon="mdi-plus" color="#5865f2" @click="createProxy()">
               {{ t('proxy.add_proxy') }}
            </v-btn>
            <v-btn class="btn ml-3" variant="flat" prepend-icon="mdi-upload" color="purple" @click="openBatchUploadDialog()">
               {{ t('proxy.batch_upload') || 'Batch Upload' }}
            </v-btn>
            <v-btn
class="btn ml-3" 
            variant="flat" 
            prepend-icon="mdi-check" color="green" 
            :loading="checkloading"
            @click="checkSelectedProxies()">
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

        <div class="d-flex flex-wrap align-center gap-3 mt-3 proxy-check-timeout-row">
            <v-text-field
                v-model.number="proxyCheckTimeoutSeconds"
                class="proxy-timeout-input"
                density="compact"
                variant="outlined"
                type="number"
                min="1"
                max="60"
                :label="t('proxy.check_timeout')"
                :suffix="t('proxy.check_timeout_suffix')"
                single-line
                hide-details
            ></v-text-field>
            <span class="text-caption text-medium-emphasis proxy-timeout-hint">{{
                t('proxy.check_timeout_hint')
            }}</span>
        </div>
    </div>
    <v-data-table-server
class="mt-3" v-model:items-per-page="itemsPerPage" :search="search" :headers="visibleHeaders"
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

        <!-- Batch Upload Proxy Dialog -->
        <v-dialog v-model="showBatchUploadDialog" max-width="900px" scrollable>
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">mdi-upload</v-icon>
                    {{ t('proxy.batch_upload') || 'Batch Upload Proxies' }}
                    <v-spacer></v-spacer>
                    <v-btn icon="mdi-close" variant="text" @click="closeBatchUploadDialog()"></v-btn>
                </v-card-title>

                <v-card-text>
                    <!-- Upload Options Tabs -->
                    <v-tabs v-model="uploadTab" color="primary">
                        <v-tab value="file">{{ t('proxy.upload_file') || 'Upload File' }}</v-tab>
                        <v-tab value="text">{{ t('proxy.paste_text') || 'Paste Text' }}</v-tab>
                    </v-tabs>

                    <v-window v-model="uploadTab" class="mt-4">
                        <!-- File Upload Tab -->
                        <v-window-item value="file">
                            <v-file-input
                                v-model="uploadFiles"
                                :label="t('common.drag_drop_file') || 'Select CSV file'"
                                accept=".csv,.txt"
                                outlined
                                clearable
                                show-size
                                @change="handleFileUpload"
                            ></v-file-input>
                            <v-btn
                                class="mb-4"
                                variant="outlined"
                                prepend-icon="mdi-download"
                                @click="downloadTemplate"
                            >
                                {{ t('common.download_template') || 'Download Template' }}
                            </v-btn>
                        </v-window-item>

                        <!-- Text Paste Tab -->
                        <v-window-item value="text">
                            <v-textarea
                                v-model="proxyText"
                                :label="t('proxy.paste_proxy_hint') || 'Paste proxies (one per line)'"
                                :hint="t('proxy.format_hint') || 'Formats: host:port, host:port:user:pass, protocol://host:port:user:pass'"
                                persistent-hint
                                rows="8"
                                variant="outlined"
                            ></v-textarea>
                            <v-btn
                                class="mb-4"
                                color="primary"
                                prepend-icon="mdi-text-box-plus"
                                @click="parseTextProxies"
                            >
                                {{ t('proxy.parse_text') || 'Parse Text' }}
                            </v-btn>
                        </v-window-item>
                    </v-window>

                    <!-- Parsed Proxies Preview -->
                    <v-divider class="my-4"></v-divider>

                    <div v-if="parsedProxies.length > 0">
                        <div class="d-flex align-center mb-2">
                            <v-card-subtitle class="pl-0">
                                {{ t('proxy.parsed_proxies') || 'Parsed Proxies' }}: {{ parsedProxies.length }}
                            </v-card-subtitle>
                            <v-spacer></v-spacer>
                            <v-btn
                                size="small"
                                color="blue"
                                variant="tonal"
                                prepend-icon="mdi-check-circle"
                                :loading="checkUploadLoading"
                                @click="checkParsedProxies"
                            >
                                {{ t('proxy.check_proxy') || 'Check Proxies' }}
                            </v-btn>
                            <v-btn
                                size="small"
                                color="green"
                                variant="tonal"
                                prepend-icon="mdi-upload"
                                :loading="importUploadLoading"
                                class="ml-2"
                                @click="importParsedProxies"
                            >
                                {{ t('proxy.import_proxy') || 'Import All' }}
                            </v-btn>
                            <v-btn
                                size="small"
                                color="red"
                                variant="tonal"
                                prepend-icon="mdi-close"
                                class="ml-2"
                                @click="clearParsedProxies"
                            >
                                {{ t('common.clear') || 'Clear' }}
                            </v-btn>
                        </div>

                        <!-- Check Timeout Setting -->
                        <v-row class="mb-2">
                            <v-col cols="12" md="4">
                                <v-text-field
                                    v-model.number="proxyCheckTimeoutSeconds"
                                    :label="t('proxy.check_timeout') || 'Check Timeout'"
                                    type="number"
                                    min="1"
                                    max="60"
                                    :suffix="t('proxy.check_timeout_suffix') || 's'"
                                    variant="outlined"
                                    density="compact"
                                    :hint="t('proxy.check_timeout_hint')"
                                    persistent-hint
                                ></v-text-field>
                            </v-col>
                        </v-row>

                        <!-- Parsed Proxies Table -->
                        <v-data-table
                            :headers="parsedProxyHeaders"
                            :items="parsedProxies"
                            :items-per-page="10"
                            density="compact"
                            class="elevation-1"
                        >
                            <template v-slot:[`item.status`]="{ item }">
                                <v-chip v-if="item.status === 0" size="small" color="grey">
                                    {{ t('proxy.not_check') || 'Not Checked' }}
                                </v-chip>
                                <v-chip v-else-if="item.status === 1" size="small" color="success">
                                    {{ t('proxy.pass') || 'Pass' }}
                                </v-chip>
                                <v-chip v-else-if="item.status === 2" size="small" color="error">
                                    {{ t('proxy.failure') || 'Fail' }}
                                </v-chip>
                            </template>
                        </v-data-table>
                    </div>

                    <!-- Alert Message -->
                    <v-alert
                        v-model="showUploadAlert"
                        :text="uploadAlertText"
                        :title="uploadAlertTitle"
                        :type="uploadAlertType"
                        class="mt-4"
                        closable
                    ></v-alert>
                </v-card-text>

                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn @click="closeBatchUploadDialog()">
                        {{ t('common.close') || 'Close' }}
                    </v-btn>
                </v-card-actions>
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
import { getProxyList,deleteProxy,checkAllproxy,receiveProxycheckMsg,removeFailureproxy,receiveRemoveproxyMsg,checkProxy as checkProxyApi,importProxydata} from '@/views/api/proxy'
import { ref, onMounted, computed, reactive } from 'vue'
import { SearchResult } from '@/views/api/types'
import {ProxyListEntity,ProxyParseItem} from "@/entityTypes/proxyType"
// import { useRoute } from "vue-router";
import router from '@/views/router';
import { useI18n } from "vue-i18n";
import { CommonMessage,NumProcessdata } from "@/entityTypes/commonType"
import {CapitalizeFirstLetter} from "@/views/utils/function"
import Papa from "papaparse";
import { SplitArrayIntoGroups } from "@/views/utils/function";
import {
  getMissingProxyFields,
  isBlankProxyCsvRow,
} from "@/views/utils/proxyImportParse";
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

// Parsed proxy headers for batch upload
const parsedProxyHeaders: Array<any> = [
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
        title: computed(_ => CapitalizeFirstLetter(t("proxy.protocol"))),
        align: 'start',
        sortable: false,
        key: 'protocol',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.user_name"))),
        align: 'start',
        sortable: false,
        key: 'user',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.password"))),
        align: 'start',
        sortable: false,
        key: 'pass',
    },
    {
        title: computed(_ => CapitalizeFirstLetter(t("proxy.status"))),
        align: 'start',
        sortable: false,
        key: 'status',
    },
];

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

// Column visibility: password hidden by default for security
const defaultVisibleKeys = ['id', 'host', 'port', 'username', 'protocol', 'statusName', 'checktime', 'googlePassName', 'actions'];
const visibleColumns = ref<Set<string>>(new Set(defaultVisibleKeys));

const availableColumns = computed(() => headers);
const visibleHeaders = computed(() => headers.filter((h: { key: string }) => visibleColumns.value.has(h.key)));

function isColumnVisible(key: string): boolean {
    return visibleColumns.value.has(key);
}

function toggleColumn(key: string): void {
    const next = new Set(visibleColumns.value);
    if (next.has(key)) {
        next.delete(key);
    } else {
        next.add(key);
    }
    visibleColumns.value = next;
}

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

// Batch Upload Dialog
const showBatchUploadDialog = ref(false);
const uploadTab = ref('file');
const uploadFiles = ref([]);
const proxyText = ref('');
const parsedProxies = ref<Array<ProxyParseItem>>([]);
const checkUploadLoading = ref(false);
const importUploadLoading = ref(false);
/** Seconds; used for main list check and batch-upload dialog check. */
const proxyCheckTimeoutSeconds = ref(10);
const showUploadAlert = ref(false);
const uploadAlertText = ref('');
const uploadAlertTitle = ref('');
const uploadAlertType = ref<'success' | 'error' | 'warning' | 'info'>('success');

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
const checkSelectedProxies = (): void => {
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
    const timeoutMs = Math.round(
        Math.min(60, Math.max(1, Number(proxyCheckTimeoutSeconds.value) || 10)) *
            1000
    );
    checkAllproxy({ proxyIds: selectedIds, timeoutMs })
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

// Batch Upload Functions
// Helper function to show alert (must be defined before other functions that use it)
const setUploadAlert = (
    text: string,
    title: string,
    type: 'success' | 'error' | 'warning' | 'info'
) => {
    uploadAlertText.value = text;
    uploadAlertTitle.value = title;
    uploadAlertType.value = type;
    showUploadAlert.value = true;

    if (type === 'success') {
        setTimeout(() => {
            showUploadAlert.value = false;
        }, 3000);
    }
};

const openBatchUploadDialog = () => {
    showBatchUploadDialog.value = true;
    parsedProxies.value = [];
    proxyText.value = '';
    uploadFiles.value = [];
    showUploadAlert.value = false;
};

const closeBatchUploadDialog = () => {
    showBatchUploadDialog.value = false;
    parsedProxies.value = [];
    proxyText.value = '';
    uploadFiles.value = [];
};

const downloadTemplate = () => {
    const rows = [
        ["host", "port", "protocols", "user", "pass"],
        ["192.168.1.1", "8080", "http", "user1", "pass1"],
        ["192.168.1.2", "3128", "socks5", "user2", "pass2"],
    ];

    const csvContent =
        "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    window.location.href = encodedUri;
};

const parseCsvData = (data: any[], hasColonSeparatedFormat: boolean) => {
    const parsed: Array<ProxyParseItem> = [];
    const invalidRowNumbers: number[] = [];

    for (let i = 0; i < data.length; i++) {
        const row = data[i] as Record<string, unknown>;
        let host: string | undefined;
        let port: string | undefined;
        let protocol: string | undefined;
        let user: string | undefined;
        let pass: string | undefined;

        if (hasColonSeparatedFormat) {
            const colonSeparatedValue = row["host:port:protocols:user:pass"];
            if (colonSeparatedValue && typeof colonSeparatedValue === "string") {
                const parts = colonSeparatedValue.split(":");
                host = parts[0]?.trim();
                port = parts[1]?.trim();
                protocol = parts[2]?.trim() || "";
                user = parts[3]?.trim() || "";
                pass = parts[4]?.trim() || "";
            }
        } else {
            host = row.host ? String(row.host) : undefined;
            port = row.port ? String(row.port) : undefined;
            protocol =
                row.protocols !== undefined && row.protocols !== null
                    ? String(row.protocols)
                    : row.protocol !== undefined && row.protocol !== null
                      ? String(row.protocol)
                      : undefined;
            user =
                row.user !== undefined && row.user !== null
                    ? String(row.user)
                    : row.username !== undefined && row.username !== null
                      ? String(row.username)
                      : undefined;
            pass =
                row.pass !== undefined && row.pass !== null
                    ? String(row.pass)
                    : row.password !== undefined && row.password !== null
                      ? String(row.password)
                      : undefined;
        }

        if (isBlankProxyCsvRow(host, port, protocol, user, pass)) {
            continue;
        }

        const missing = getMissingProxyFields(host, port, protocol);
        if (missing.length > 0) {
            invalidRowNumbers.push(i + 2);
            continue;
        }

        parsed.push({
            host: host!.trim(),
            port: port!.trim(),
            protocol: protocol!.trim(),
            user: user?.trim() ?? "",
            pass: pass?.trim() ?? "",
            status: 0,
        });
    }

    parsedProxies.value = parsed;

    const rowsPreview =
        invalidRowNumbers.length > 12
            ? `${invalidRowNumbers.slice(0, 12).join(", ")}, …`
            : invalidRowNumbers.join(", ");

    if (invalidRowNumbers.length > 0 && parsed.length > 0) {
        setUploadAlert(
            t("proxy.import_partial_rows_missing_fields", {
                valid: parsed.length,
                count: invalidRowNumbers.length,
                rows: rowsPreview,
            }),
            t("proxy.import_proxy") || "Import",
            "warning"
        );
    } else if (invalidRowNumbers.length > 0) {
        setUploadAlert(
            t("proxy.import_rows_missing_fields", {
                count: invalidRowNumbers.length,
                rows: rowsPreview,
            }),
            t("proxy.import_proxy") || "Import",
            "error"
        );
    } else if (parsed.length > 0) {
        setUploadAlert(
            `${parsed.length} ${t("proxy.proxies_parsed") || "proxies parsed"}`,
            t("common.success") || "Success",
            "success"
        );
    } else {
        setUploadAlert(
            t("proxy.no_valid_proxies") || "No valid proxies found",
            t("common.error") || "Error",
            "error"
        );
    }
};

const handleFileUpload = () => {
    if (!uploadFiles.value || uploadFiles.value.length === 0) {
        return;
    }

    const file = uploadFiles.value[0];
    const reader = new FileReader();

    reader.onload = (e) => {
        const text = e.target?.result as string;
        const csv = Papa.parse(text, { header: true });

        // Detect format
        const hasColonSeparatedFormat =
            csv.meta?.fields?.length === 1 &&
            csv.data.length > 0 &&
            csv.data[0] &&
            typeof csv.data[0]['host:port:protocols:user:pass'] === 'string';

        parseCsvData(csv.data, hasColonSeparatedFormat);
    };

    reader.readAsText(file);
};

const parseProxyLine = (line: string): ProxyParseItem | null => {
    let host: string | undefined;
    let port: string | undefined;
    let protocol: string | undefined;
    let user: string | undefined;
    let pass: string | undefined;

    // Format: protocol://host:port or protocol://host:port:user:pass
    if (line.includes('://')) {
        const parts = line.split('://');
        protocol = parts[0]?.trim();
        const remaining = parts[1] || '';

        // Remove protocol prefix if any (socks5://, http://, https://)
        if (protocol && !['http', 'https', 'socks5', 'socks4'].includes(protocol.toLowerCase())) {
            protocol = 'http';
        }

        const authParts = remaining.split('@');
        let connectionString = remaining;

        if (authParts.length === 2) {
            // Format: protocol://user:pass@host:port
            const credentials = authParts[0].split(':');
            user = credentials[0]?.trim();
            pass = credentials[1]?.trim();
            connectionString = authParts[1];
        }

        const connectionParts = connectionString.split(':');
        if (connectionParts.length >= 2) {
            host = connectionParts[0]?.trim();
            port = connectionParts[1]?.trim();
        }
    } else {
        // Format: host:port or host:port:user:pass
        const parts = line.split(':');
        if (parts.length >= 2) {
            host = parts[0]?.trim();
            port = parts[1]?.trim();

            if (parts.length >= 4) {
                user = parts[2]?.trim();
                pass = parts[3]?.trim();
            }

            if (parts.length === 3) {
                // Could be host:port:protocol or host:port:user
                const thirdPart = parts[2]?.trim();
                if (['http', 'https', 'socks5', 'socks4'].includes(thirdPart.toLowerCase())) {
                    protocol = thirdPart;
                } else {
                    user = thirdPart;
                }
            }
        }
    }

    if (!host || !port) {
        return null;
    }

    return {
        host,
        port,
        protocol: protocol || 'http',
        user: user || '',
        pass: pass || '',
        status: 0,
    };
};

const parseTextProxies = () => {
    if (!proxyText.value || proxyText.value.trim().length === 0) {
        setUploadAlert(
            t('proxy.enter_proxy_text') || 'Please enter proxy text',
            t('common.error') || 'Error',
            'error'
        );
        return;
    }

    const lines = proxyText.value.trim().split('\n');
    const parsed: Array<ProxyParseItem> = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            continue;
        }

        const proxy = parseProxyLine(trimmedLine);
        if (proxy) {
            parsed.push(proxy);
        }
    }

    parsedProxies.value = parsed;

    if (parsed.length > 0) {
        setUploadAlert(
            `${parsed.length} ${t('proxy.proxies_parsed') || 'proxies parsed'}`,
            t('common.success') || 'Success',
            'success'
        );
    } else {
        setUploadAlert(
            t('proxy.no_valid_proxies') || 'No valid proxies found',
            t('common.error') || 'Error',
            'error'
        );
    }
};

const checkParsedProxies = async () => {
    if (parsedProxies.value.length === 0) {
        setUploadAlert(
            t('proxy.no_proxies_to_check') || 'No proxies to check',
            t('common.error') || 'Error',
            'error'
        );
        return;
    }

    checkUploadLoading.value = true;

    const promises = parsedProxies.value.map(async (item: ProxyParseItem) => {
        const timeoutMs = Math.round(
            Math.min(60, Math.max(1, Number(proxyCheckTimeoutSeconds.value) || 10)) *
                1000
        );
        const itemWithTimeout = { ...item, timeout: timeoutMs };
        try {
            const res = await checkProxyApi(itemWithTimeout);
            if (res && res.status) {
                item.status = 1;
            } else {
                item.status = 2;
            }
        } catch (err) {
            console.error(err);
            item.status = 2;
        }
    });

    await Promise.all(promises);
    checkUploadLoading.value = false;

    const passCount = parsedProxies.value.filter((p: ProxyParseItem) => p.status === 1).length;
    const failCount = parsedProxies.value.filter((p: ProxyParseItem) => p.status === 2).length;

    setUploadAlert(
        `${t('proxy.check_complete') || 'Check complete'}: ${passCount} ${t('proxy.pass') || 'pass'}, ${failCount} ${t('proxy.failure') || 'fail'}`,
        t('common.success') || 'Success',
        'info'
    );
};

const importParsedProxies = async () => {
    if (parsedProxies.value.length === 0) {
        setUploadAlert(
            t('proxy.no_proxies_to_import') || 'No proxies to import',
            t('common.error') || 'Error',
            'error'
        );
        return;
    }

    // Filter valid proxies (either unchecked or passed)
    const validProxies = parsedProxies.value.filter((p: ProxyParseItem) => p.status === 0 || p.status === 1);

    if (validProxies.length === 0) {
        setUploadAlert(
            t('proxy.no_valid_proxies') || 'No valid proxies to import',
            t('common.error') || 'Error',
            'error'
        );
        return;
    }

    importUploadLoading.value = true;

    try {
        // Split into groups of 100
        const groups = SplitArrayIntoGroups(validProxies, 100);
        const promises = groups.map(async (group: ProxyParseItem[]) => {
            const res = await importProxydata(group).catch((err) => {
                console.error(err);
                return { status: false, msg: err.message };
            });
            return res;
        });

        const results = await Promise.all(promises);
        const successCount = results.filter((r: any) => r && r.status).length;

        if (successCount === results.length) {
            setUploadAlert(
                `${validProxies.length} ${t('proxy.import_success') || 'proxies imported successfully'}`,
                t('common.success') || 'Success',
                'success'
            );

            // Refresh proxy list
            loadItems({ page: options.page, itemsPerPage: options.itemsPerPage, sortBy: '' });

            // Clear parsed proxies after successful import
            setTimeout(() => {
                closeBatchUploadDialog();
            }, 1500);
        } else {
            setUploadAlert(
                t('proxy.import_partial') || 'Some proxies failed to import',
                t('common.warning') || 'Warning',
                'warning'
            );

            // Refresh proxy list
            loadItems({ page: options.page, itemsPerPage: options.itemsPerPage, sortBy: '' });
        }
    } catch (error: any) {
        setUploadAlert(
            error.message || t('proxy.import_fail') || 'Import failed',
            t('common.error') || 'Error',
            'error'
        );
    } finally {
        importUploadLoading.value = false;
    }
};

const clearParsedProxies = () => {
    parsedProxies.value = [];
    proxyText.value = '';
    uploadFiles.value = [];
    showUploadAlert.value = false;
};




</script>

<style scoped>
.proxy-toolbar .proxy-timeout-input {
  flex: 0 0 auto;
  width: 160px;
  max-width: min(200px, 100%);
  position: relative;
  z-index: 1;
}

.proxy-check-timeout-row {
  width: 100%;
  min-height: 48px;
  align-items: center;
}

.proxy-timeout-hint {
  flex: 1 1 200px;
  max-width: 520px;
  line-height: 1.35;
}
</style>
