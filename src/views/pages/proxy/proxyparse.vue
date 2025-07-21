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
      <!-- <v-btn class="ml-5" @click="showload">Show loading</v-btn> -->
    </v-row>

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
              label="Search"
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
            ><span> Clear Table</span></v-btn
          >
          <v-btn
          
          color="green"
            @click="checkProxyitem"
            class="btn ml-1"
            variant="flat"
            prepend-icon="mdi-filter-variant"
            ><span> Check Proxy</span></v-btn
          >
          <v-btn
          color="blue"
            @click="importProxy"
            class="btn ml-1"
            variant="flat"
            prepend-icon="mdi-filter-variant"
            ><span> Save to My Proxy</span></v-btn
          >
          <v-btn
          color="red"
            @click="removefailProxy"
            class="btn ml-1"
            variant="flat"
            prepend-icon="mdi-filter-variant"
            ><span> Remove fail Proxy</span></v-btn
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
            Not check
          </v-chip>
          <v-chip v-if="item.status === 1" class="mx-2" color="secondary">
            pass
          </v-chip>
          <v-chip v-if="item.status === 2" class="mx-2" color="pink">
            fail
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
import Papa from "papaparse";
import { ProxyParseItem } from "@/entityTypes/proxyType";
import { checkProxy, importProxydata } from "@/views/api/proxy";
import { SplitArrayIntoGroups } from "@/views/utils/function";
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
const headers: Array<any> = [
  {
    title: "Host",
    align: "start",
    sortable: false,
    key: "host",
  },
  {
    title: "Port",
    align: "start",
    sortable: false,
    key: "port",
  },

  {
    title: "Protocol",
    align: "start",
    sortable: false,
    key: "protocol",
  },
  {
    title: "User",
    align: "start",
    sortable: false,
    key: "user",
  },
  {
    title: "Pass",
    align: "start",
    sortable: false,
    key: "pass",
  },
  { title: "Status", key: "status", sortable: false },
];

const handleFileUpload = async () => {
  loading.value = true;
  message.value="loading data"
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
  message.value="check proxy"
  console.log(items.value);
  const promises =items.value.map(async (item) => {
    const res = await checkProxy(item).catch((err) => {
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
  message.value="Import proxy"
  const result: Array<ProxyParseItem> = [];
  items.value.forEach((item) => {
    if (item.status == 1) {
      result.push(item);
    }
  });
  if(result.length==0){
    setAlert("The available proxy number is less than one, no proxy to import", "Import Proxy", "error")
    loading.value=false;
    return;
  }
  const promises = SplitArrayIntoGroups(result, 100).map(async (group) => {
    const res = await importProxydata(group).catch((err) => {
      console.log(err);
      setAlert(err.message, "Import Proxy", "error")
      return false;
    });
    if (res) {
      // console.log("save success");
      setAlert("Import Proxy Success", "Import Proxy", "success")
    } else {
      // console.log("save fail");
      setAlert("Import Proxy Fail", "Import Proxy", "error")
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
  message.value="loading data"
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
