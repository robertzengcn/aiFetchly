<template>
  <v-sheet class="mx-auto" rounded>
    <h2 class="text-h4 mb-4">{{ pageTitle }}</h2>
    <v-form ref="form" @submit.prevent="onSubmit">
    
      
      <v-select v-model="emailtype" :items="emailTypelist" :label="t('emailextraction.extraction_type') as string" required
        :readonly="loading" :rules="[rules.required]" class="mt-3"  
        item-title="name"
          item-value="key"
          return-object
          ></v-select>
       <v-textarea class="mt-3" v-model="urls" :label="t('emailextraction.input_urls_hint')" v-if="emailtype?.index==0"></v-textarea> 
       
       <div v-if="emailtype?.index==1" class="mt-3">
        <SearchResultSelectTable @change="handleSearchtaskChanged" :selectedValue="searchtaskId" />
      </div>


      <v-text-field v-model="page_length" :label="t('emailextraction.page_length')" clearable class="mt-3"></v-text-field>

      <v-text-field v-model="concurrent_quantity" :label="t('search.concurrent_quantity')" clearable
        class="mt-3"></v-text-field>
        <v-number-input
          :label="t('emailextraction.max_page_number')"
          control-variant="default"
          v-model="maxPageNumber"
          :max="1000"
          :min="0"
          :default="100"
        ></v-number-input>
      
        <v-number-input
        :label="t('emailextraction.process_timeout')"
        control-variant="default"
        v-model="processTimeout"
        :max="20"
          :min="1"
      ></v-number-input>
        <v-combobox v-model="proxyValue" :items="proxyValue" label="Select proxy" item-title="host" multiple return-object
        chips clearable></v-combobox>
      <v-btn color="primary" @click="showProxytable">{{t('search.choose_proxy')}}</v-btn>

      <div v-if="proxytableshow" class="mt-3">
        <ProxyTableselected @change="handleSelectedChanged" />
      </div>

      <p class="mt-5">{{ capletter(t('search.show_in_Browser')) }}:</p>
      <v-btn-toggle v-model="showinbrwoser" mandatory class="mt-3">
        <v-btn :value="0" color="primary">No</v-btn>
        <v-btn :value="1" color="success">Yes</v-btn>
      </v-btn-toggle>


      <div class="d-flex justify-space-between mt-4 mb-4">
        <v-btn color="success" type="submit" :loading="loading" class="flex-grow-1 mr-2">
          {{ isEditMode ? t('common.save') : t('common.submit') }}
        </v-btn>

        <v-btn color="error" @click="router.go(-1)" class="flex-grow-1 ml-2">
          {{ t('common.return') }}
        </v-btn>
      </div>


     

    </v-form>
    <div>
    </div>

  </v-sheet>
  <div>

    <!-- Define the alert dialog component -->
    <v-dialog v-model="alert" width="auto">
      <v-card max-width="400" prepend-icon="mdi-update" :text="alerttext" :title="alerttitle">
        <template v-slot:actions>
          <v-btn class="ms-auto" text="Ok" @click="alert = false"></v-btn>
        </template>
      </v-card>
    </v-dialog>
  </div>
</template>
<script setup lang="ts">

import { ref, onMounted, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter, useRoute } from 'vue-router';
import {EmailExtractionTypes} from "@/config/emailextraction";
import { ToArray, CapitalizeFirstLetter } from "@/views/utils/function"
import { submitScraper,receiveSearchEmailevent, getEmailSearchTask, updateEmailSearchTask } from "@/views/api/emailextraction"
// import { Usersearchdata } from "@/entityTypes/searchControlType"
// import { convertNumberToBoolean } from "@/views/utils/function"
import {isValidUrl,convertNumberToBoolean} from "@/views/utils/function"
import ProxyTableselected from "@/views/pages/proxy/widgets/ProxySelectedTable.vue";
import SearchResultSelectTable from "@/views/pages/search/widgets/SearchResultSelectTable.vue";
import { ProxyEntity,ProxyListEntity } from "@/entityTypes/proxyType";
import {SearchtaskItem } from "@/entityTypes/searchControlType"
import {EmailscFormdata, EmailSearchTaskDetail} from '@/entityTypes/emailextraction-type'
import {EMAILEXTRACTIONMESSAGE} from "@/config/channellist"
import { CommonDialogMsg } from "@/entityTypes/commonType"

// Props for edit mode (for backward compatibility)
const props = defineProps({
  editMode: {
    type: Boolean,
    default: false
  },
  taskId: {
    type: Number,
    default: 0
  }
});

// Detect edit mode from route
const isEditMode = computed(() => {
  return route.name === 'Email_Extraction_Edit' || props.editMode;
});

const currentTaskId = computed(() => {
  if (route.params.id) {
    return parseInt(route.params.id as string);
  }
  return props.taskId;
});

// Dynamic page title
const pageTitle = computed(() => {
  return isEditMode.value ? t('emailextraction.edit_task') : t('emailextraction.create_task');
});

const { t } = useI18n({ inheritLocale: true });
const router = useRouter();
const route = useRoute();

const alert = ref(false);
const alerttext = ref("");
const alerttitle = ref("");
const alerttype = ref<"success" | "error" | "warning" | "info" | undefined>(
  "success"
);
const form = ref<HTMLFormElement>();
const loading = ref(false);
const rules = {
  required: (value) => !!value || "Field is required",
};
const processTimeout = ref<number>(10);
const maxPageNumber = ref<number>(100);
type EmailOption = {
  key: string;
  name: string;
  index: number;
};
const urls=ref<string>("");
const page_length=ref(10);
const emailtype = ref<EmailOption>();

const emailTypelist = ref<Array<EmailOption>>([]);
const showinbrwoser = ref(0);
// const searchtaskshow=ref(false);
const concurrent_quantity = ref(1);
const proxyValue = ref<Array<ProxyEntity>>([]);
const proxytableshow = ref(false);
const searchtaskId=ref<number>(0);

// Task data for edit mode
const taskData = ref<EmailSearchTaskDetail | null>(null);

const initialize = () => {
  //searchplatform.value = ToArray(SearhEnginer);
  const seArr:string[]=ToArray(EmailExtractionTypes);

  //console.log(seArr);
  seArr.map((item,index)=>{
    emailTypelist.value?.push({name:t('emailextraction.'+item.toLowerCase()),key:item,index:index})
  })
 console.log(emailTypelist.value)
  //searchplatform.value=seArr
};

const setAlert = (
  text: string,
  title: string,
  type: "success" | "error" | "warning" | "info" | undefined
) => {
  loading.value = false;
  alerttext.value = text;
  alerttitle.value = title;
  alerttype.value = type;
  alert.value = true;
  setTimeout(() => {
    alert.value = false;
  }, 5000);
};

// Load task data for edit mode
const loadTaskData = async () => {
  if (!isEditMode.value || !currentTaskId.value) return;
  
  try {
    loading.value = true;
    const task = await getEmailSearchTask(currentTaskId.value);
    console.log("task", task)
    taskData.value = task;
    
    // Populate form with task data
    if (task) {
      // Set extraction type
      const typeIndex = task.type_id === EmailExtractionTypes.SearchResult ? 1 : 0;
      emailtype.value = emailTypelist.value.find(item => item.index === typeIndex);
      
      // Set URLs
      if (task.urls && task.urls.length > 0) {
        urls.value = task.urls.join('\n');
      }
      
      // Set other fields
      page_length.value = task.pagelength || 10;
      concurrent_quantity.value = task.concurrency || 1;
      maxPageNumber.value = task.maxPageNumber || 100;
      processTimeout.value = task.processTimeout || 10;
      showinbrwoser.value = task.notShowBrowser ? 0 : 1;
      searchtaskId.value = task.searchResultId || 0;
      
      // Set proxies
      if (task.proxies && task.proxies.length > 0) {
        proxyValue.value = task.proxies;
      }
    }
  } catch (error) {
    console.error('Error loading task data:', error);
    setAlert(t('emailextraction.load_task_error'), "Error", "error");
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  initialize();
  if (isEditMode.value) {
    loadTaskData();
  } else {
    // Check for URLs in query parameters (from search results)
    if (route.query.urls && typeof route.query.urls === 'string') {
      const urlsFromQuery = route.query.urls.split('\n').map(url => url.trim()).filter(url => url.length > 0);
      if (urlsFromQuery.length > 0) {
        urls.value = urlsFromQuery.join('\n');
        // Set extraction type to ManualInputUrl (index 0)
        emailtype.value = emailTypelist.value.find(item => item.index === 0);
      }
    }
    receiveMsg();
  }
})
const showProxytable = () => {
  console.log("show proxy table");
  proxytableshow.value = !proxytableshow.value;
};


const capletter = CapitalizeFirstLetter

const handleSelectedChanged = (newValue: ProxyListEntity[]) => {
  // console.log(`selectedProxy changed to ${newValue}`);
  // proxyValue.value=[];
  if (newValue && newValue.length > 0) {
    //loop new value and add to proxyValue

    for (let i = 0; i < newValue.length; i++) {
      if (newValue[i] && newValue[i].id) {
        let isexist = false;
        for (let is = 0; is < proxyValue.value.length; is++) {
          if (proxyValue.value[is].id == newValue[i].id) {
            isexist = true;
          }
        }
        console.log("isexist:" + isexist.toString());
        if (!isexist) {
          if((newValue[i].host)&&( newValue[i].port)){
          proxyValue.value.push({
            id: newValue[i].id,
            host: newValue[i].host!,
            port: newValue[i].port!,
            user: newValue[i].username,
            pass: newValue[i].password,
            protocol: newValue[i].protocol,
          });
          console.log(proxyValue.value);
        }
        }
      }
    }
  }
};
const handleSearchtaskChanged = (newValue: SearchtaskItem[]|undefined) => {
  // console.log(`selectedProxy changed to ${newValue}`);
  // proxyValue.value=[];
  console.log("search change")
  console.log(newValue)
  if(newValue&& newValue.length > 0){
    if (newValue[0] && newValue[0].id) {
    searchtaskId.value=newValue[0].id;
    console.log("search task id is"+searchtaskId.value)
    }
  }else{
    searchtaskId.value=0;
  }
};

const receiveMsg = () => {
  receiveSearchEmailevent(EMAILEXTRACTIONMESSAGE, function (res) {
    console.log(res)
    const obj = JSON.parse(res) as CommonDialogMsg
    if (obj.status) {
      if (obj.data) {
        if (obj.data.action) {
          if (obj.data.action == 'emailscrape.emailsearch_task_start') {
            router.push({
              path: '/emailextraction/tasklist'
            });
          }else if(obj.data.action == 'error'){
            //error notice
            setAlert(t(obj.data.content), t(obj.data.title), "error");
          }
        }
      }
    }
  })
}
async function onSubmit() {
  if (!form.value) return;
  const { valid } = await form.value.validate();
  if (!valid) {
    //console.log("form is not valid");
    setAlert(t('common.fill_require_field'), "Error", "error");
  } else {
    if(!emailtype.value){
      setAlert(t('emailextraction.choose_email_extraction_type'), "Error", "error");
      return;
    }
    const validateurl:Array<string>=[]
    let extratype = "";
    console.log(emailtype.value)
    if(emailtype.value?.index==0){
      extratype=emailtype.value.key;
      if(urls.value==""){
        setAlert(t('emailextraction.input_urls_empty'), "Error","error");
        return;
      }
    
    const urlarr = urls.value.split('\n').map(keyword => keyword.trim());
  
    //validate item in urls array is valid url
    urlarr.forEach((item) => {
      //check url is valid
      isValidUrl(item)?validateurl.push(item):null
    })
    // Check if there are any valid URLs after validation
    if (validateurl.length === 0) {
      setAlert(t('emailextraction.no_valid_urls'), "Warning", "warning");
      return;
    }

  }else if(emailtype.value?.index==1){
    extratype=emailtype.value.key;
    if(searchtaskId.value==0||!searchtaskId.value){
      setAlert(t('emailextraction.choose_search_task'), "Error", "error");
      return;
  }

}

   const scraperData:EmailscFormdata={
    extratype:extratype,
    urls:validateurl,
    pagelength:page_length.value,
    concurrency:concurrent_quantity.value,
    notShowBrowser:!convertNumberToBoolean(showinbrwoser.value),
    proxys:proxyValue.value,
    searchTaskId:searchtaskId.value,
    processTimeout:processTimeout.value,
    maxPageNumber:maxPageNumber.value
   }
   console.log(scraperData)
   
   if (isEditMode.value) {
     // Edit mode - update existing task
     try {
       loading.value = true;
       await updateEmailSearchTask(currentTaskId.value, scraperData);
       setAlert(t('emailextraction.update_success'), "Success", "success");
       setTimeout(() => {
         router.push('/emailextraction/tasklist');
       }, 1500);
     } catch (error) {
       console.error('Error updating task:', error);
       setAlert(error instanceof Error ? error.message : t('emailextraction.update_error'), "Error", "error");
     } finally {
       loading.value = false;
     }
   } else {
     // Create mode - submit new task
     submitScraper(scraperData).catch(function (err) {
       //catch error
       setAlert(err.message, "Error", "error");
       return null
     })
   }
  }
}
</script>
