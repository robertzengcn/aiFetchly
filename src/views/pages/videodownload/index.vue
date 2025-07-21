<template>
  <v-sheet class="mx-auto" rounded>
    <v-form ref="form" @submit.prevent="onSubmit">
      <v-row>
        <v-col cols="12" md="12">
          <v-text-field v-model="taskName" :label="t('video.task_name')" required :readonly="loading"
            :rules="[rules.required]"></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <v-select v-model="type" :items="typeitems" :label="t('video.platform')" required :readonly="loading"
            :rules="[rules.required]"></v-select>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <v-select v-model="chooseType" :items="downloadType" :label="t('video.downloadtype')" required
            :readonly="loading" :rules="[rules.required]"></v-select>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <v-select v-model="cookiesType" :items="cookieslistTypes" :label="t('video.cookies_type')" required
            :readonly="loading" :rules="[rules.required]"></v-select>
        </v-col>
      </v-row>
      <!-- show browser choose  -->
      <v-container v-if="cookiesType == 'browser cookies'">
        <v-row>
          <v-col cols="12" md="12">
            <v-select v-model="browserType" :items="browserlist" :label="t('video.choose_browser')" required
              :readonly="loading" :rules="[rules.required]"></v-select>
          </v-col>
        </v-row>
      </v-container>
      <v-container v-if="cookiesType == 'account cookies'">
        <v-row>
          <v-col cols="12" md="12">
            <v-combobox v-model="accounts" multiple :items="accounts" :label="t('account.select_account_hint')"
              item-title="user" return-object chips clearable @click="changeAccount"></v-combobox>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12" md="12">
            <v-btn color="primary" @click="showAccounttable">{{ t('account.change_account') }}</v-btn>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12" md="12">
            <div v-if="accounttableShow">
              <AccountSelectedTable @change="handleSelectedChanged" accountSource="youtube" />
            </div>
          </v-col>
        </v-row>
      </v-container>
      <v-container v-if="chooseType == 'singleplay' || chooseType == 'playlist'">
        <v-row>
          <v-col cols="12" md="12">
            <v-textarea :label="t('video.video_url')" :hint="t('video.input_video_url_hint')" variant="outlined"
              required v-model="linkstr" class="mt-5"></v-textarea>
          </v-col>
        </v-row>
      </v-container>
      <v-container v-if="chooseType == 'keyword'">
        <v-row>
          <v-col cols="12" md="12">
            <v-textarea :label="t('video.keyword')" :hint="t('video.keyword')" variant="outlined" required
              v-model="keywordstr" class="mt-5"></v-textarea>
          </v-col>
        </v-row>
      </v-container>
      <v-container v-if="chooseType == 'keyword'">
        <v-row>
          <v-col cols="12" md="12">
            <v-text-field
              v-model="maxpagenumber"
              type="number"
              :label="t('video.max_page_number')"
              :hint="t('video.max_page_number_hint')"
              min="1"
              persistent-hint
            ></v-text-field>
          </v-col>
        </v-row>
      </v-container>
      <v-row>
        <v-col cols="12" md="12">
          <v-label>{{ CapitalizeFirstLetter(t('video.source_language')) }}:</v-label>
          <v-select v-model="videolanguage" :items="languagelist" :label="t('video.select_language')" item-title="name"
            item-value="code" return-object class="mt-2" :rules="[rules.required]"></v-select>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <v-text-field :label="t('video.saved_path')" :hint="t('video.input_video_save_path')" persistent-hint required
            type="input" @click="selectPath" v-model="savePath" class="mt-2" :rules="[rules.required]"></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <v-combobox v-model="proxyValue" :items="proxyValue" :label="t('select_proxy')" item-title="host" multiple
            return-object chips clearable></v-combobox>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="6" md="6">
          <v-btn color="primary" @click="showProxytable">{{ t('change_proxy') }}</v-btn>
        </v-col>
        <v-col cols="6" md="6">
          <v-checkbox v-model="useProxyOverride" :label="t('video.use_proxy_override')"></v-checkbox>
        </v-col>
      </v-row>
      
      <v-row v-if="proxytableshow">
        <v-col cols="12" md="12">

          <ProxyTableselected @change="handleProxySelectedChanged" />

        </v-col>
      </v-row>
      <v-row>



        <v-slider v-model="videoQuality" thumb-label="always" thumb-size="20" ticks="always" tick-size="2" tick-labels
          min="0" max="10" step="1" class="" label="video quality, the less, the best"></v-slider>

      </v-row>
      <div class="d-flex flex-column">
        <v-row class="mt-5">
          <v-btn-group class="mt-2">
            <v-btn color="primary" class="mr-2" @click="resetForm">{{
              t("common.reset")
              }}</v-btn>
            <v-btn color="secondary" class="mr-2" @click="onSubmit">{{
              t("common.submit")
              }}</v-btn>
          </v-btn-group>
        </v-row>
      </div>
    </v-form>
    <div>

      <!-- Define the alert dialog component -->
      <v-dialog persistent v-model="alert" width="auto">
        <v-card max-width="400" prepend-icon="mdi-update" :text="alerttext" :title="alerttitle">
          <template v-slot:actions>
            <v-btn class="ms-auto" text="Ok" @click="alert = false"></v-btn>
          </template>
        </v-card>
      </v-dialog>

    </div>

  </v-sheet>
</template>
<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { VideoDownloadlist, VideodownlodType, CookiesSelectType, BrowerList } from "@/config/videosetting";
import { opendialog, downloadVideo } from "@/views/api/video";
import { useI18n } from "vue-i18n";
import { DownloadVideoControlparam } from "@/entityTypes/videoType";
import { receiveVideoDownloadMessage } from "@/views/api/video";
import AccountSelectedTable from "@/views/pages/socialaccount/widgets/AccountSelectedTable.vue";
import { SocialAccountListData } from '@/entityTypes/socialaccount-type'
import { CommonDialogMsg } from "@/entityTypes/commonType";
import router from '@/views/router';
import ProxyTableselected from "@/views/pages/proxy/widgets/ProxySelectedTable.vue";
import { ProxyListEntity, Proxy } from "@/entityTypes/proxyType";
import { LanguageConfig } from "@/config/LanguageConfig"
import { LanguageItem } from '@/entityTypes/commonType'
import { CapitalizeFirstLetter } from "@/views/utils/function"
//import ErrorDialog from "@/views/components/widgets/errorDialog.vue"
const proxyValue = ref<Array<Proxy>>([]);
const proxyValueshow = ref<Array<string>>([]);
const proxytableshow = ref(false);
const type = ref("");
const cookiesType = ref("");
const browserType = ref("");
//const showlog = ref(false);
const useProxyOverride = ref(false);
//const logs = ref("");
const typeitems = ref<Array<string>>();
const chooseType = ref<"playlist"|"singleplay"|"keyword">("singleplay");
const downloadType = ref<Array<string>>();
const cookieslistTypes = ref<Array<string>>(CookiesSelectType);
const browserlist = ref<Array<string>>(BrowerList);
const loading = ref(false);
const { t } = useI18n({ inheritLocale: true });
const savePath = ref("");
const form = ref<HTMLFormElement>();
const alert = ref(false);
const alerttext = ref("");
const alerttitle = ref("");
const taskName = ref("")
const alerttype = ref<"success" | "error" | "warning" | "info" | undefined>(
  "success"
);
const maxpagenumber=ref<number>(10);
const videolanguage = ref<LanguageItem>()
const languagelist = ref<Array<LanguageItem>>(LanguageConfig)
const videoQuality = ref(0);
const linkstr = ref("");
const keywordstr = ref("");
const rules = {
  required: (value) => !!value || "Field is required",
};
const accounts = ref<Array<SocialAccountListData>>([])
const initialize = () => {
  typeitems.value = VideoDownloadlist;
  downloadType.value = VideodownlodType;
  // cookieslistTypes.value=CookiesSelectType;
};
const selectPath = async () => {
  const res = await opendialog();
  console.log(res);
  savePath.value = res;
};
const accounttableShow = ref(false);
const showAccounttable = () => {

  accounttableShow.value = !accounttableShow.value;
};
const changeAccount = () => {
  if (accounts.value.length < 1) {
    accounttableShow.value = true;
  }


};
const showProxytable = () => {
  console.log("show proxy table");
  proxytableshow.value = !proxytableshow.value;
};
const handleSelectedChanged = (newValue: SocialAccountListData[]) => {
  // console.log(`selectedProxy changed to ${newValue}`);
  // proxyValue.value=[];
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

const handleProxySelectedChanged = (newValue: ProxyListEntity[]) => {
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
        // console.log("isexist:" + isexist.toString());
        if (!isexist) {
          proxyValue.value.push({
            id: newValue[i].id,
            host: newValue[i].host,
            port: newValue[i].port,
            username: newValue[i].username,
            password: newValue[i].password,
            protocol: newValue[i].protocol,
          });
          console.log(proxyValue.value);
        }
      }
    }
  }
};
watch(proxyValue.value, (newValue, oldValue) => {
  console.log(`proxyValue changed from ${oldValue} to ${newValue}`);
  if (newValue && newValue.length > 0) {
    // let proxystr = "";
    for (let i = 0; i < newValue.length; i++) {
      if (newValue[i] && newValue[i].id) {
        // proxystr += newValue[i].host + ":" + newValue[i].port + ",";
        const target = newValue[i].host + ":" + newValue[i].port;
        if (proxyValueshow.value.indexOf(target) == -1) {
          proxyValueshow.value.push(target);
        }
        // proxyValueshow.value.push();
      }
    }
  } else {
    proxyValueshow.value = [];
  }
});
onMounted(() => {
  initialize();
  receiveVideoDownloadMessage((res: CommonDialogMsg) => {
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
      if (res.code == 200) {
        // route to new page
        router.push({
          path: '/video/dowloadtasklist'
        });
      }
    } else {
      if (res.data) {
        setAlert(t(res.data.content), t('common.error'), "error");
      }
      //handle failure
      //append msg to logs with red color
      // logs.value += res.data.content + "\n";
    }
  });
});
const setAlert = (
  text: string,
  title: string,
  type: "success" | "error" | "warning" | "info" | undefined
) => {
  loading.value = false
  alerttext.value = text;
  alerttitle.value = title;
  alerttype.value = type;
  alert.value = true;
  setTimeout(() => {
    alert.value = false;
  }, 5000);
};
function resetForm() {
  if (!form.value) return;
  form.value.reset();
}
async function onSubmit() {

  if (!form.value) return;
  const { valid } = await form.value.validate();

  // downloadVideo()
  loading.value = true;
  if (!valid) {
    setAlert("Please fill all required fields", "Error", "error");
    return
  } else {
    let validUrls: Array<string> = [];
    let keywordArr: Array<string> = [];
    if (chooseType.value == "keyword") {
      const keywords = keywordstr.value.split("\n");
      console.log(keywords);
      keywordArr = keywords.filter((line) => {
        return line.length > 0;
      });
    } else if (chooseType.value == "playlist"|| chooseType.value == "singleplay") {


      // console.log(valid);
      const lines = linkstr.value.split("\n");

      validUrls = lines.filter((line) => {
        try {
          new URL(line);
          return true;
        } catch (_) {
          return false;
        }
      });
    }
    const accountIds: Array<number> = [];
    accounts.value.forEach((element) => {
      accountIds.push(element.id);
    });
    const proxyIds: Array<number> = [];
    proxyValue.value.forEach((element) => {
      if (element.id) {
        proxyIds.push(element.id);
      }
    });
    const isPlaylist = chooseType.value == "playlist" ? true : false
    if (!videolanguage.value) {
      setAlert("video.select_language_error", "Error", "error");
      return;
    }
    const data: DownloadVideoControlparam = {
      taskName: taskName.value,
      accountId: accountIds,
      platform: type.value,
      link: validUrls,
      downloadType: chooseType.value,
      keywords: keywordArr,
      savePath: savePath.value,
      isplaylist: isPlaylist,
      proxy: proxyIds,
      ProxyOverride: useProxyOverride.value,
      cookies_type: cookiesType.value,
      browserName: browserType.value,
      videoQuality: videoQuality.value,
      language_code: videolanguage.value.code,
      maxpagenumber: maxpagenumber.value,
    };
    if ((chooseType.value=='playlist'||chooseType.value=='singleplay')&&(validUrls.length === 0)) {
      setAlert("Please input valid url", "Error", "error");
      return;
    }
    if( chooseType.value == 'keyword' && (keywordArr.length === 0)) {
      setAlert("Please input valid keyword", "Error", "error");
      return;
    }
    console.log(data);
    downloadVideo(data);

  }
}
</script>
