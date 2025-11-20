<template>
  <v-sheet class="mx-auto px-6" rounded>
    <v-form ref="form" @submit.prevent="onSubmit">
      <h3>{{ isEditMode ? t('search.edit_task') : t('search.use_hint') }}</h3>
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
        <AccountSelectedTable :accountSource="enginer" :preSelectedAccounts="accounts" @change="handleAccountChange" />
      </v-container>

      <p class="mt-5">{{ capletter(t('search.show_in_Browser')) }}:</p>
      <v-btn-toggle v-model="showinbrwoser" mandatory class="mt-3">
        <v-btn :value="0" color="primary">No</v-btn>
        <v-btn :value="1" color="success">Yes</v-btn>
      </v-btn-toggle>
      <div class="d-flex justify-space-between mt-4 mb-4">
        <v-btn color="success" type="submit" :loading="loading" class="flex-grow-1 mr-2">
          {{ isEditMode ? t('common.update') : t('common.submit') }}
        </v-btn>

        <v-btn v-if="!isEditMode" color="primary" @click="onSaveOnly" :loading="loading" class="flex-grow-1 mx-2">
          {{ t('search.save_only') }}
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
import { ref, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
//import router from '@/views/router';
import { SearhEnginer } from "@/config/searchSetting"
import { ToArray, CapitalizeFirstLetter } from "@/views/utils/function"
import { submitScraper, receiveSearchevent, getSearchTaskDetails, updateSearchTask, createSearchTaskOnly } from "@/views/api/search"
import { getSocialaccountinfo } from "@/views/api/socialaccount"
import { Usersearchdata } from "@/entityTypes/searchControlType"
import { convertNumberToBoolean } from "@/views/utils/function"
import { SEARCHEVENT } from "@/config/channellist"
import { CommonDialogMsg } from "@/entityTypes/commonType"
import ProxyTableselected from "@/views/pages/proxy/widgets/ProxySelectedTable.vue";
import { ProxyEntity, ProxyListEntity } from "@/entityTypes/proxyType";
import { LocalBrowerList } from "@/config/searchSetting"
import { SocialAccountListData } from '@/entityTypes/socialaccount-type'

const { t } = useI18n({ inheritLocale: true });
const route = useRoute();
const router = useRouter();

// Check if we're in edit mode
const isEditMode = ref(!!route.params.id);
const taskId = ref(isEditMode.value ? Number(route.params.id) : null);

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
const yandexTipShown = ref(false); // Track if tip has been shown to avoid repeated alerts
const googleAccountTipShown = ref(false); // Track if Google account tip has been shown
const keywords = ref();
const searchplatform = ref<Array<SearchOption>>([]);
const showinbrwoser = ref(0);
const page_number = ref(1);
const concurrent_quantity = ref(1);
const proxyValue = ref<Array<ProxyEntity>>([]);
const proxytableshow = ref(false);
const accounts = ref<Array<SocialAccountListData>>([])
const initialize = () => {
  //searchplatform.value = ToArray(SearhEnginer);
  const seArr: string[] = ToArray(SearhEnginer);

  //console.log(seArr);
  seArr.map((item, index) => {
    searchplatform.value?.push({ name: t('search.' + item.toLowerCase()), key: item, index: index })
  })
  console.log("searchplatform.value")
  console.log(searchplatform.value)
  //searchplatform.value=seArr
};

const loadTaskDetails = async () => {
  if (!taskId.value) return;
  
  try {
    loading.value = true;
    const taskDetails = await getSearchTaskDetails(taskId.value);
    console.log(taskDetails)
    //if (taskDetails.status && taskDetails.data) {
        const data = taskDetails;
      console.log("data")
      console.log(taskDetails)
      // Populate form fields
      // Find the engine name by engine ID
      if(data.engineName){
      const engineItem = searchplatform.value.find(item => item.key === data.engineName);
      console.log("engineItem:"+engineItem)
      enginer.value = engineItem ? engineItem.key : data.engine.toString();
      }
      keywords.value = data.keywords.join('\n');
      page_number.value = data.num_pages;
      concurrent_quantity.value = data.concurrency;
      showinbrwoser.value = data.notShowBrowser ? 0 : 1;
      useLocalBrowser.value = !!data.localBrowser;
      localBrowser.value = data.localBrowser || '';
      useAccount.value = data.accounts && data.accounts.length > 0;
      
      // Set proxies
      if (data.proxys && data.proxys.length > 0) {
        proxyValue.value = data.proxys.map(proxy => ({
          id: 0, // We don't have the original proxy ID in the response
          host: proxy.host,
          port: proxy.port.toString(),
          user: proxy.user || '',
          pass: proxy.pass || '',
          protocol: 'http' // Default protocol
        }));
      }
      
      // Set accounts
      if (data.accounts && data.accounts.length > 0) {
        // Fetch account details for each account ID
        try {
          const accountDetails = await Promise.all(
            data.accounts.map(async (id) => {
              try {
                const accountDetail = await getSocialaccountinfo(id);
                return {
                  id: accountDetail.id || 0,
                  social_type_id: accountDetail.social_type_id || 1,
                  user: accountDetail.user,
                  pass: accountDetail.pass,
                  status: accountDetail.status,
                  use_proxy: accountDetail.proxy && accountDetail.proxy.length > 0 ? 1 : 0,
                  cookies: false // cookies property doesn't exist in SocialAccountDetailData
                };
              } catch (error) {
                console.error(`Failed to fetch account details for ID ${id}:`, error);
                // Return a fallback account object if fetching fails
                return {
                  id: id,
                  social_type_id: 1,
                  user: `Account ${id}`,
                  pass: '',
                  status: 1,
                  use_proxy: 0,
                  cookies: false
                };
              }
            })
          );
          accounts.value = accountDetails;
        } catch (error) {
          console.error('Error fetching account details:', error);
          // Fallback to basic account objects if bulk fetch fails
          accounts.value = data.accounts.map(id => ({ 
            id: id, 
            social_type_id: 1,
            user: `Account ${id}`,
            pass: '',
            status: 1,
            use_proxy: 0,
            cookies: false
          }));
        }
      }
    //}
  } catch (error) {
    console.error('Error loading task details:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to load task details';
    const translatedMessage = errorMessage.startsWith('search.') ? t(errorMessage) : errorMessage;
    setAlert(translatedMessage, 'Error', 'error');
  } finally {
    loading.value = false;
  }
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

// Watch for Yandex selection and show tip if local browser is not used
watch([enginer, useLocalBrowser], ([newEngine, newUseLocalBrowser], [oldEngine, oldUseLocalBrowser]) => {
  const isYandex = newEngine && newEngine.toLowerCase() === 'yandex';
  const wasYandex = oldEngine && oldEngine.toLowerCase() === 'yandex';
  
  // Show tip when:
  // 1. User selects Yandex and local browser is not enabled
  // 2. User disables local browser while Yandex is selected
  // Only show once per session unless user switches away and back
  if (isYandex && !newUseLocalBrowser) {
    // Reset tip flag if user switched away from Yandex
    if (!wasYandex) {
      yandexTipShown.value = false;
    }
    
    // Show tip if not already shown for this Yandex selection
    if (!yandexTipShown.value) {
      setTimeout(() => {
        setAlert(t('search.yandex_local_browser_tip'), t('search.use_local_browser'), 'info');
        yandexTipShown.value = true;
      }, 500);
    }
  } else if (isYandex && newUseLocalBrowser) {
    // Reset flag when local browser is enabled
    yandexTipShown.value = false;
  } else if (!isYandex) {
    // Reset flag when switching away from Yandex
    yandexTipShown.value = false;
  }
}, { immediate: false });

// Watch for Google selection and show tip if account is not used
watch([enginer, useAccount], ([newEngine, newUseAccount], [oldEngine, oldUseAccount]) => {
  const isGoogle = newEngine && newEngine.toLowerCase() === 'google';
  const wasGoogle = oldEngine && oldEngine.toLowerCase() === 'google';
  
  // Show tip when:
  // 1. User selects Google and account is not enabled
  // 2. User disables account while Google is selected
  // Only show once per session unless user switches away and back
  if (isGoogle && !newUseAccount) {
    // Reset tip flag if user switched away from Google
    if (!wasGoogle) {
      googleAccountTipShown.value = false;
    }
    
    // Show tip if not already shown for this Google selection
    if (!googleAccountTipShown.value) {
      setTimeout(() => {
        setAlert(t('search.google_account_tip'), t('search.use_search_enginer_account'), 'info');
        googleAccountTipShown.value = true;
      }, 500);
    }
  } else if (isGoogle && newUseAccount) {
    // Reset flag when account is enabled
    googleAccountTipShown.value = false;
  } else if (!isGoogle) {
    // Reset flag when switching away from Google
    googleAccountTipShown.value = false;
  }
}, { immediate: false });

onMounted(async () => {
  initialize();
  receiveMsg();
  
  // If in edit mode, load task details
  if (isEditMode.value && taskId.value) {
    await loadTaskDetails();
  }
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
    setAlert("Please fill all required fields", "Error", "error");
    loading.value = false;
    return;
  }
  
  if (!enginer.value) {
    setAlert(t("search.search_enginer_empty"), "Error", "error");
    loading.value = false;
    return;
  }
  
  if (!keywords.value) {
    setAlert(t("search.keywords_empty"), "Error", "error");
    loading.value = false;
    return;
  }
  
  const subkeyword = keywords.value.split('\n').map(keyword => keyword.trim());
  let localbowser: string = ""
  if (useLocalBrowser.value) {
    localbowser = localBrowser.value
  }
  let accountids: Array<number> = []
  if (useAccount.value) {
    accountids = accounts.value.map(item => item.id)
  }
  
  const subdata: Usersearchdata = {
    searchEnginer: enginer.value,
    keywords: subkeyword,
    num_pages: page_number.value,
    concurrency: concurrent_quantity.value,
    notShowBrowser: !convertNumberToBoolean(showinbrwoser.value),
    proxys: proxyValue.value,
    localBrowser: localbowser,
    accounts: accountids
  }
  
  try {
    if (isEditMode.value && taskId.value) {
      // Update existing task
      const updateData = {
        engine: subdata.searchEnginer,
        keywords: subdata.keywords,
        num_pages: subdata.num_pages,
        concurrency: subdata.concurrency,
        notShowBrowser: subdata.notShowBrowser,
        localBrowser: subdata.localBrowser,
        proxys: subdata.proxys?.map(proxy => ({
          host: proxy.host,
          port: parseInt(proxy.port),
          user: proxy.user,
          pass: proxy.pass
        })),
        accounts: subdata.accounts
      };
      
      const result = await updateSearchTask(taskId.value, updateData);
      console.log("result")
      if (result) {
        setAlert(t('search.task_updated_successfully'), 'Success', 'success');
        // Navigate back to task list after a short delay
        setTimeout(() => {
          router.push({ name: 'Searchtasklist' });
        }, 1500);
      } else {
        setAlert('Failed to update task', 'Error', 'error');
      }
    } else {
      // Create new task
      await submitScraper(subdata).catch(function (err) {
        setAlert(err.message, "Error", "error");
        return null;
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An error occurred';
    const translatedMessage = errorMessage.startsWith('search.') ? t(errorMessage) : errorMessage;
    setAlert(translatedMessage, 'Error', 'error');
  } finally {
    loading.value = false;
  }
}

/**
 * Save search task without running it
 */
async function onSaveOnly() {
  if (!form.value) return;
  loading.value = true;
  const { valid } = await form.value.validate();
  if (!valid) {
    setAlert("Please fill all required fields", "Error", "error");
    loading.value = false;
    return;
  }
  
  if (!enginer.value) {
    setAlert(t("search.search_enginer_empty"), "Error", "error");
    loading.value = false;
    return;
  }
  
  if (!keywords.value) {
    setAlert(t("search.keywords_empty"), "Error", "error");
    loading.value = false;
    return;
  }
  
  const subkeyword = keywords.value.split('\n').map(keyword => keyword.trim());
  let localbowser: string = ""
  if (useLocalBrowser.value) {
    localbowser = localBrowser.value
  }
  let accountids: Array<number> = []
  if (useAccount.value) {
    accountids = accounts.value.map(item => item.id)
  }
  
  const subdata: Usersearchdata = {
    searchEnginer: enginer.value,
    keywords: subkeyword,
    num_pages: page_number.value,
    concurrency: concurrent_quantity.value,
    notShowBrowser: !convertNumberToBoolean(showinbrwoser.value),
    proxys: proxyValue.value,
    localBrowser: localbowser,
    accounts: accountids
  }
  
  try {
    const result = await createSearchTaskOnly(subdata);
    console.log("result")
    console.log(result)
    if (result) {
      setAlert(`${t('search.task_saved_successfully')} (ID: ${result})`, 'Success', 'success');
      // Navigate back to task list after a short delay
      setTimeout(() => {
        router.push({ name: 'Searchtasklist' });
      }, 1500);
    } else {
      setAlert('Failed to save task', 'Error', 'error');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An error occurred';
    const translatedMessage = errorMessage.startsWith('search.') ? t(errorMessage) : errorMessage;
    setAlert(translatedMessage, 'Error', 'error');
  } finally {
    loading.value = false;
  }
}
</script>
