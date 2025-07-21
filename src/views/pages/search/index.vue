<template>
  <v-sheet class="mx-auto px-6" rounded>
    <v-form ref="form" @submit.prevent="onSubmit">
      <h3>{{ t('search.use_hint') }}</h3>
      <v-textarea class="mt-3" v-model="keywords" :label="t('search.input_keywords_hint')"></v-textarea>
      <v-select v-model="enginer" :items="searchplatform" :label="t('search.search_enginer_name')" required
        :readonly="loading" :rules="[rules.required]" class="mt-3" item-title="name" item-value="key"></v-select>


      <v-text-field v-model="page_number" :label="t('search.page_number')" clearable class="mt-3"></v-text-field>

      <v-text-field v-model="concurrent_quantity" :label="t('search.concurrent_quantity')" clearable
        class="mt-3"></v-text-field>
      <v-combobox v-model="proxyValue" :items="proxyValue" label="Select proxy" item-title="host" multiple return-object
        chips clearable></v-combobox>
      <v-btn color="primary" @click="showProxytable">{{ t('search.choose_proxy') }}</v-btn>

      <div v-if="proxytableshow" class="mt-3">
        <ProxyTableselected @change="handleSelectedChanged" />
      </div>
     
        <v-row>
          <v-col cols="6" md="6">
            <p class="mt-5">{{ capletter(t('search.use_local_browser')) }}:</p>
            <v-btn-toggle v-model="useLocalBrowser" mandatory class="mt-3">
              <v-btn :value=false color="primary">No</v-btn>
              <v-btn :value=true color="success">Yes</v-btn>
            </v-btn-toggle>
          </v-col>
        </v-row>
      
      
        <v-row v-if="useLocalBrowser == true">
          <v-col cols="6" md="6">
            <v-select v-model="localBrowser" :items="LocalBrowerList" :label="t('search.choose_local_browser')" required
              :readonly="loading" :rules="[rules.required]"></v-select>
          </v-col>
        </v-row>
     
        <v-row>
          <p class="mt-5">{{ capletter(t('search.use_search_enginer_account')) }}:</p>
          <v-col cols="12" md="12">
            <v-btn-toggle v-model="useAccount" mandatory class="mt-3">
              <v-btn :value="false" color="primary">No</v-btn>
              <v-btn :value="true" color="success">Yes</v-btn>
            </v-btn-toggle>
          </v-col>
        </v-row>
    

      <v-container v-if="useAccount == true">
        <AccountSelectedTable :accountSource="enginer" @change="handleAccountChange" />
      </v-container>

      <p class="mt-5">{{ capletter(t('search.show_in_Browser')) }}:</p>
      <v-btn-toggle v-model="showinbrwoser" mandatory class="mt-3">
        <v-btn :value="0" color="primary">No</v-btn>
        <v-btn :value="1" color="success">Yes</v-btn>
      </v-btn-toggle>
      <div class="d-flex justify-space-between mt-4 mb-4">
        <v-btn color="success" type="submit" :loading="loading" class="flex-grow-1 mr-2">
          {{ t('common.submit') }}
        </v-btn>

        <v-btn color="error" @click="router.go(-1)" class="flex-grow-1 ml-2">
          {{ t('common.return') }}
        </v-btn>
      </div>


      <!-- <div class="d-flex flex-column">
        <v-btn color="success" class="mt-4" block type="submit" :loading="loading">
          Submit
        </v-btn>

        <v-btn color="error" class="mt-4" block @click="router.go(-1)">
          Return
        </v-btn>
      </div> -->

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
import { useRoute, useRouter } from "vue-router";
import AccountSelectedTable from "@/views/pages/socialaccount/widgets/AccountSelectedTable.vue";

type SearchOption = {
  key: string;
  name: string;
  index: number;
};
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
//import router from '@/views/router';
import { SearhEnginer } from "@/config/searchSetting"
import { ToArray, CapitalizeFirstLetter } from "@/views/utils/function"
import { submitScraper, receiveSearchevent } from "@/views/api/search"
import { Usersearchdata } from "@/entityTypes/searchControlType"
import { convertNumberToBoolean } from "@/views/utils/function"
import { SEARCHEVENT } from "@/config/channellist"
import { CommonDialogMsg } from "@/entityTypes/commonType"
import ProxyTableselected from "@/views/pages/proxy/widgets/ProxySelectedTable.vue";
import { ProxyEntity, ProxyListEntity } from "@/entityTypes/proxyType";
import { LocalBrowerList } from "@/config/searchSetting"
import { SocialAccountListData } from '@/entityTypes/socialaccount-type'

const { t } = useI18n({ inheritLocale: true });
const alert = ref(false);
const alerttext = ref("");
const alerttitle = ref("");
const alerttype = ref<"success" | "error" | "warning" | "info" | undefined>(
  "success"
);
const localBrowser = ref("");
const useAccount = ref(false);
const form = ref<HTMLFormElement>();
const loading = ref(false);
const rules = {
  required: (value) => !!value || "Field is required",
};
const useLocalBrowser = ref(false)
const enginer = ref<string>();
const keywords = ref();
const searchplatform = ref<Array<SearchOption>>([]);
const showinbrwoser = ref(0);
const page_number = ref(1);
const concurrent_quantity = ref(1);
const proxyValue = ref<Array<ProxyEntity>>([]);
const proxytableshow = ref(false);
//const $route = useRoute();
const router = useRouter();
const accounts = ref<Array<SocialAccountListData>>([])
const initialize = () => {
  //searchplatform.value = ToArray(SearhEnginer);
  const seArr: string[] = ToArray(SearhEnginer);

  //console.log(seArr);
  seArr.map((item, index) => {
    searchplatform.value?.push({ name: t('search.' + item.toLowerCase()), key: item, index: index })
  })
  console.log(searchplatform.value)
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

onMounted(() => {
  initialize();
  receiveMsg()
})
const showProxytable = () => {
  console.log("show proxy table");
  proxytableshow.value = !proxytableshow.value;
};

const handleAccountChange = (newValue: SocialAccountListData[]) => {
  if (newValue && newValue.length > 0) {

    // accounts.value.length=0;
    // accounts.value=newValue;
    for (let i = 0; i < newValue.length; i++) {
      if (newValue[i] && newValue[i].id) {
        let isexist = false;
        for (let is = 0; is < accounts.value.length; is++) {
          if (accounts.value[is].id == newValue[i].id) {
            isexist = true;
          }
        }
        console.log("isexist:" + isexist.toString());
        if (!isexist) {
          accounts.value.push(newValue[i]);
        }
      }
    }
  }
};

const receiveMsg = () => {
  receiveSearchevent(SEARCHEVENT, function (res) {
    console.log(res)
    const obj = JSON.parse(res) as CommonDialogMsg
    if (obj.status) {
      if (obj.data) {
        if (obj.data.action) {
          if (obj.data.action == 'search_task _start') {
            router.push({
              path: '/search/tasklist'
            });
          }
        } else if (obj.data.action == 'error') {
          //error notice
          setAlert(t(obj.data.content), t(obj.data.title), "error");
        }
      }
    }
  })
}
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
          if ((newValue[i].host) && (newValue[i].port)) {
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
async function onSubmit() {
  if (!form.value) return;
  loading.value = true;
  const { valid } = await form.value.validate();
  if (!valid) {
    //console.log("form is not valid");
    setAlert("Please fill all required fields", "Error", "error");
  } else {
    if (!enginer.value) {
      //return; 
      setAlert(t("search.search_enginer_empty"), "Error", "error");
      return
    }
    if (!keywords.value) {
      setAlert(t("search.keywords_empty"), "Error", "error");
      return
    }
    const subkeyword = keywords.value.split('\n').map(keyword => keyword.trim());
    // let finalser="";
    console.log("enginer value is" + enginer.value)
    // searchplatform.value.forEach((item) => {
    //   console.log(item)
    //   if (item.key == enginer.value) {
    //     finalser = item.index;
    //   }
    // })
    let localbowser: string = ""
    if (useLocalBrowser) {
      localbowser = localBrowser.value
    }
    let accountids:Array<number>=[]
    if(useAccount.value){
      accountids=accounts.value.map(item=>item.id)
    }
    const subdata: Usersearchdata = {
      searchEnginer: enginer.value,
      keywords: subkeyword,
      num_pages: page_number.value,
      concurrency: concurrent_quantity.value,
      notShowBrowser: !convertNumberToBoolean(showinbrwoser.value),
      proxys: proxyValue.value,
      // useLocalbrowserdata:convertNumberToBoolean(useLocalbrowserdata.value),
      localBrowser: localbowser,
      accounts:accountids
      // maxConcurrent:concurrent_quantity.value
    }
    //split keywords one line per one
    // subdata.keywords=
    //submit form
    console.log(subdata)
    await submitScraper(subdata).catch(function (err) {
      //loading.value = false;
      //catch error
      setAlert(err.message, "Error", "error");
      return null
    })
    loading.value = false;
    // if(res){

    // }

  }


}
</script>
