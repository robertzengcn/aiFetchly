<template>
  <v-container>
   

    <v-row>
      <v-file-input
        v-model="files"
        label="Drag and drop your file here or click to select file"
        accept=".csv"
        outlined
        clearable
        show-size
        @change="handleFileUpload"
      ></v-file-input>
      <v-btn class="ml-5" @click="outPutcsv">Download Template</v-btn>
      <v-btn
        icon
        variant="text"
        color="primary"
        @click="showHelp = !showHelp"
        class="ml-2"
      >
        <v-icon>mdi-help-circle-outline</v-icon>
      </v-btn>
      <!-- <v-btn class="ml-5" @click="showload">Show loading</v-btn> -->
    </v-row>

    <!-- User Guide Tip -->
    <v-alert
      v-model="showHelp"
      type="info"
      variant="tonal"
      class="mb-4"
      closable
    >
      <template v-slot:title>
        <!-- <v-icon class="mr-2">mdi-information</v-icon> -->
        How to Batch Upload Proxies
      </template>
      <ol class="mt-2">
        <li><strong>Download Template:</strong> Click the "Download Template" button to get the CSV template file</li>
        <li><strong>Edit Template:</strong> Open the downloaded CSV file and add your proxy information (host, port, protocol, username, password)</li>
        <li><strong>The protocol can be http, https, socks5</strong></li>
        <li><strong>Upload File:</strong> Select your edited CSV file using the file input below</li>
        <li><strong>Check Proxies:</strong> Use "Check Proxy" to validate the uploaded proxies</li>
        <li><strong>Save to System:</strong> Click "Save to My Proxy" to import valid proxies to your account</li>
      </ol>
    </v-alert>

    <!-- Settings Container -->
    <v-card v-if="showtable" class="mb-4" variant="outlined">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-cog</v-icon>
        {{ t('proxy.check_settings') }}
      </v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="4">
            <v-text-field
              v-model.number="checkTimeout"
              :label="t('proxy.check_timeout')"
              type="number"
              min="1"
              max="60"
              suffix="seconds"
              variant="outlined"
              density="compact"
              :hint="t('proxy.check_timeout_hint')"
              persistent-hint
            ></v-text-field>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-row v-if="showtable">
      <div class="search_bar mt-4 d-flex jsb">
        <div class="d-flex jsb search_tool">
          <div class="search_wrap mr-4 w-25">
            <v-text-field
            v-model="search"
              rounded
              class="elevation-0"
              density="compact"
              variant="solo"
              :label="t('proxy.search')"
              append-inner-icon="mdi-magnify"
              single-line
              hide-details
            ></v-text-field>
          </div>
          <v-btn
            @click="clearArray"
            class="btn"
            variant="flat"
            prepend-icon="mdi-filter-variant"
            ><span> {{ t('proxy.clear_table') }}</span></v-btn
          >
          <v-btn
          
          color="green"
            @click="checkProxyitem"
            class="btn ml-1"
            variant="flat"
            prepend-icon="mdi-filter-variant"
            ><span> {{ t('proxy.check_proxy') }}</span></v-btn
          >
          <v-btn
          color="blue"
            @click="importProxy"
            class="btn ml-1"
            variant="flat"
            prepend-icon="mdi-filter-variant"
            ><span> {{ t('proxy.save_to_my_proxy') }}</span></v-btn
          >
          <v-btn
          color="red"
            @click="removefailProxy"
            class="btn ml-1"
            variant="flat"
            prepend-icon="mdi-filter-variant"
            ><span> {{ t('proxy.remove_fail_proxy') }}</span></v-btn
          >
        </div>
      </div>
      <div class="mt-4 jsb">
      <v-alert
    v-model="alert"
    :text="alerttext"
    :title="alerttitle"
    :type="alerttype"
  ></v-alert>
    </div>
    
      
    
      <v-data-table :items="items" :headers="headers" class="mt-2"  :search="search">
        <template v-slot:[`item.status`]="{ item }">
          <v-chip v-if="item.status === 0" class="mx-2" color="grey">
            {{ t('proxy.not_check') }}
          </v-chip>
          <v-chip v-if="item.status === 1" class="mx-2" color="secondary">
            {{ t('proxy.pass') }}
          </v-chip>
          <v-chip v-if="item.status === 2" class="mx-2" color="pink">
            {{ t('proxy.failure') }}
          </v-chip>
        </template>
        
      </v-data-table>
    </v-row>
    <v-dialog v-model="loading" max-width="320" persistent>
      <v-list class="py-2" color="primary" elevation="12" rounded="lg">
        <v-list-item prepend-icon="info" :title="message">
          <template v-slot:prepend>
            <div class="pe-4">
              <v-icon color="primary" size="x-large"></v-icon>
            </div>
          </template>
  
          <template v-slot:append>
            <v-progress-circular
              color="primary"
              indeterminate="disable-shrink"
              size="16"
              width="2"
            ></v-progress-circular>
          </template>
        </v-list-item>
      </v-list>
    </v-dialog>
  </v-container>
  
</template>
<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import Papa from "papaparse";
import { ProxyParseItem } from "@/entityTypes/proxyType";
import { checkProxy, importProxydata } from "@/views/api/proxy";
import { SplitArrayIntoGroups } from "@/views/utils/function";

const { t } = useI18n({ inheritLocale: true });
const showtable = ref(false);
const files = ref([]);
const items = ref<Array<ProxyParseItem>>([]);
// const show = ref(false);
const loading = ref(false);
const message = ref("");
const itemsPerPage = ref(10);
const alert = ref(false);
const alerttext = ref("");
const alerttitle = ref("");
const search= ref("");
const alerttype = ref<"success" | "error" | "warning" | "info" | undefined>("success");
const showHelp = ref(false);
const checkTimeout = ref(10); // Default timeout in seconds
const headers: Array<any> = [
  {
    title: t('proxy.host'),
    align: "start",
    sortable: false,
    key: "host",
  },
  {
    title: t('proxy.port'),
    align: "start",
    sortable: false,
    key: "port",
  },

  {
    title: t('proxy.protocol'),
    align: "start",
    sortable: false,
    key: "protocol",
  },
  {
    title: t('proxy.user'),
    align: "start",
    sortable: false,
    key: "user",
  },
  {
    title: t('proxy.pass'),
    align: "start",
    sortable: false,
    key: "pass",
  },
  { title: t('proxy.status'), key: "status", sortable: false },
];

const handleFileUpload = async () => {
  loading.value = true;
  message.value = t('proxy.loading_data');
  console.log(files.value); // Do something with the file
  if (!files.value.length){
    loading.value = false;
    return;
  } 
  const reader = new FileReader();
  reader.readAsText(files.value[0]);
  reader.onload = () => {
    console.log(reader.result);
    const csv = Papa.parse(reader.result, { header: true });
    // console.log(csv.data);
    //loop through the csv data
    // const data = csv.data;
    //  const result:Array<ProxyParseItem> = [];
    for (let i = 0; i < csv.data.length; i++) {
      const row = csv.data[i];
      if (row.host.length > 0 && row.port.length > 0) {
        const item: ProxyParseItem = {
          host: row.host,
          port: row.port,
          protocol: row.protocols,
          user: row.user,
          pass: row.pass,
          status: 0,
        };

        items.value.push(item);
      }
    }
    //check items length, and show v-data-table
    if (items.value.length > 0) {
      showtable.value = true;
    }
  };
  loading.value = false;
};
const checkProxyitem = async () => {
  loading.value=true;
  message.value = t('proxy.check_proxy');
  console.log(items.value);
  const promises =items.value.map(async (item) => {
    const itemWithTimeout = { ...item, timeout: checkTimeout.value * 1000 };
    const res = await checkProxy(itemWithTimeout).catch((err) => {
      console.log(err);
      return false;
    });
    console.log(item);
    if (res) {
      item.status = 1;
    } else {
      item.status = 2;
    }
  });
  await Promise.all(promises);
  loading.value=false;
};
const clearArray = () => {
  items.value = [];
  files.value = [];
  // showtable.value=false;
};
const importProxy = async () => {
  loading.value=true;
  message.value = t('proxy.import_proxy');
  const result: Array<ProxyParseItem> = [];
  items.value.forEach((item) => {
    if (item.status == 1) {
      result.push(item);
    }
  });
  if(result.length==0){
    setAlert(t('proxy.no_proxy_to_import'), t('proxy.import_proxy'), "error")
    loading.value=false;
    return;
  }
  const promises = SplitArrayIntoGroups(result, 100).map(async (group) => {
    const res = await importProxydata(group).catch((err) => {
      console.log(err);
      setAlert(err.message, t('proxy.import_proxy'), "error")
      return false;
    });
    if (res) {
      // console.log("save success");
      setAlert(t('proxy.import_proxy_success'), t('proxy.import_proxy'), "success")
    } else {
      // console.log("save fail");
      setAlert(t('proxy.import_proxy_fail'), t('proxy.import_proxy'), "error")
    }
  });
  await Promise.all(promises);
  loading.value=false;
};
const outPutcsv = () => {
  const rows = [["host", "port", "protocols", "user", "pass"]];

  const csvContent =
    "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");

  const encodedUri = encodeURI(csvContent);
  // window.open(encodedUri);
  window.location.href = encodedUri;
};
const showload=()=>{
  loading.value=true;
  message.value = t('proxy.loading_data');
  setTimeout(() => {
    loading.value= false
        }, 5000)
}
const setAlert=(text: string, title: string, type: "success" | "error" | "warning" | "info" | undefined) =>{
  alerttext.value = text;
  alerttitle.value = title;
  alerttype.value = type;
  alert.value = true;
  setTimeout(() => {
    alert.value= false
        }, 5000)
}
const removefailProxy=()=>{
  items.value=items.value.filter((item)=>item.status==1)
}
</script>
<style>
.dialog.centered-dialog,
.v-dialog.centered-dialog {
  background: #282c2dad;
  box-shadow: none;
  border-radius: 6px;
  width: auto;
  color: whitesmoke;
}
</style>
