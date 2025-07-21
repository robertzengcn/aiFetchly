<template>
  <v-sheet class="mx-auto" rounded>

    <v-form ref="form" @submit.prevent="onSubmit">
      <v-row>
        <v-col cols="12" md="8">
          <v-text-field ref="inputs" v-model="tplTitle" :label="t('emailmarketing.title')" type="input"
            :hint="t('emailmarketing.title_hint')" :readonly="loading" clearable
            required></v-text-field>
          <!-- <v-text-field v-model="tplcontent" :label="$t('emailmarketing.content')" type="input"
            :hint="$t('emailmarketing.title_content')" :rules="[rules.required]" required :readonly="loading"
            clearable></v-text-field> -->
          <!-- https://www.vue2editor.com/examples/#basic-setup -->
          <!-- <vue-editor v-model="tplcontent" /> -->
          <v-textarea ref="textarea" v-model="tplcontent" :label="t('emailmarketing.content')"
            :hint="t('emailmarketing.content_hint')" :rules="[rules.required]" :readonly="loading" clearable rows="10"
            required auto-grow></v-textarea>
        </v-col>
        <v-col cols="12" md="1">
          <v-textarea 
            v-model="tplDescription" 
            :label="t('emailmarketing.description')+' (' + t('common.optional') + ')'" 
            :hint="t('emailmarketing.description_hint') + ' (' + t('common.optional') + ')'" 
            :readonly="loading" 
            clearable 
            rows="3"
            auto-grow
            optional
          ></v-textarea>
        </v-col>
        <v-col cols="12" md="3">
          <!-- Content for the 1/3 column -->
          <v-btn @click="insertVariable('{$send_time}')" color="primary" class="mb-2 ml-2" rounded="lg" size="small">
            {{ t('emailmarketing.insert_time_variable') }}
          </v-btn>
          <v-btn @click="insertVariable('{$sender}')" color="primary" class="mb-2 ml-2" rounded="lg" size="small">
            {{ t('emailmarketing.insert_sender_variable') }}
          </v-btn>
          <v-btn @click="insertVariable('{$receiver_email}')" color="primary" class="mb-2 ml-2" rounded="lg" size="small">
            {{ t('emailmarketing.insert_receiver_variable') }}
          </v-btn>
          <v-btn @click="insertVariable('{$url}')" color="primary" class="mb-2 ml-2" rounded="lg" size="small">
            {{ t('emailmarketing.insert_source') }}
          </v-btn>
          <v-btn @click="insertVariable('{$description}')" color="primary" class="mb-2 ml-2" rounded="lg" size="small">
            {{ t('emailmarketing.insert_description') }}
          </v-btn>
            
        </v-col>
      </v-row>
      <v-alert v-model="alert" border="start" variant="tonal" closable close-label="Close Alert" title="Information"
        :color="alertcolor">
        {{ alertContent }}
      </v-alert>
      <div class="d-flex flex-column">
        <v-row>
          <v-col cols="12" md="4">
            <v-btn color="blue" class="mt-4" block @click="submitpreview" :loading="loading">
              {{ t('emailmarketing.preview') }}
            </v-btn>
          </v-col>
          <v-col cols="12" md="4">
            <v-btn color="success" class="mt-4" block type="submit" :loading="loading">
              {{ t('common.submit') }}
            </v-btn>
          </v-col>
          <v-col cols="12" md="4">
            <v-btn color="error" class="mt-4" block @click="router.go(-1)">
              {{ t('common.return') }}
            </v-btn>
          </v-col>
        </v-row>
      </div>
    </v-form>
  </v-sheet>
  <!-- preview dialog -->
  <v-dialog v-model="previewdialog" width="auto" scrollable>
    <v-card max-width="400" prepend-icon="mdi-update" text="Input follow variable content to preview email"
      title="Email Preview">
      <v-card-text>
        <v-row dense>
          <v-col cols="12" md="6" sm="6">
            <v-text-field v-model="Sendervar" label="Sender" required></v-text-field>
          </v-col>
          <v-col cols="12" md="6" sm="6">
            <v-text-field v-model="Receivervar" label="Receiver" required></v-text-field>

          </v-col>

        </v-row>
        <v-row dense>
          <v-col cols="12" md="12" sm="12">
            <v-text-field v-model="Sourcevar" label="Source" required></v-text-field>
          </v-col>
        </v-row>
        <v-row dense>
          <v-col cols="12" md="12" sm="12">
            <v-text-field v-model="DescriptionVar" label="Description" required></v-text-field>
          </v-col>
        </v-row>

        <v-row dense>
          <v-text-field v-model="EmailTitlepreview" :label="t('emailmarketing.title')" type="input"
            readonly></v-text-field>
        </v-row>
        <v-row dense>
          <v-textarea v-model="EmailContentpreview" :label="t('emailmarketing.content')" readonly rows="10" required
            auto-grow></v-textarea>
        </v-row>
      </v-card-text>
      <template v-slot:actions>
        <v-spacer></v-spacer>
        <v-btn text="Close" @click="previewdialog = false"></v-btn>

      </template>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
// import router from '@/views/router';
import { ref, onMounted, watch,onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getEmailtemplatebyid, updateEmailtemplate } from "@/views/api/emailmarketing"
import { EmailTemplateRespdata, EmailTemplatePreviewdata } from "@/entityTypes/emailmarketingType"
import { convertVariableInTemplate } from "@/views/utils/emailFun"
// import { VueEditor } from "vue2-editor";
const { t } = useI18n({ inheritLocale: true });
const templateId = ref<number>(0);


const $route = useRoute();
const router = useRouter();
const FakeAPI = {
  async fetch(id: number): Promise<EmailTemplateRespdata> {
    return await getEmailtemplatebyid(id.toString());
  },
};
//defined the value in page
const form = ref<HTMLFormElement>();
const tplTitle = ref<string>(""); //template title
const tplcontent = ref<string>(""); //template
const tplDescription = ref<string>(""); //template description
const previewdialog = ref<boolean>(false);
const loading = ref<boolean>(false);
const alert = ref<boolean>(false);
const alertContent = ref("");
const alertcolor = ref("");
const isEdit = ref(false);
const textarea = ref<HTMLTextAreaElement | null>(null);
const inputs = ref<HTMLInputElement | null>(null);
const Sendervar = ref<string>("");
const DescriptionVar= ref<string>("");
const Receivervar = ref<string>("");
const EmailTitlepreview = ref<string>("");
const EmailContentpreview = ref<string>("");
const Sourcevar= ref<string>("");
let lastFocusedElement: HTMLTextAreaElement | HTMLInputElement | null = null;
// import { RefSymbol } from "@vue/reactivity";
// const selectedProxy = ref<ProxyListEntity>();

const rules = {
  required: (value) => !!value || "Field is required",
};


const initialize = async () => {
  if ($route.params.id) {
    templateId.value = parseInt($route.params.id.toString());
  }

  if (templateId.value > 0) {
    //edit
    isEdit.value = true;
    FakeAPI.fetch(parseInt(templateId.value.toString())).then((res) => {
      //set value
      if (res) {
        console.log(res)
        tplTitle.value = res.TplTitle;
        tplcontent.value = res.TplContent;
        tplDescription.value = res.TplDescription || "";
      }
    });
  } else {
    //add new item
    isEdit.value = false;
    // if($route.params.campaignId){
    // campaignId.value=parseInt($route.params.campaignId.toString());
    // }
  }

};

watch(Sendervar, (newValue, oldValue) => {
  //console.log('EmailContentpreview changed from', oldValue, 'to', newValue);
  // Call your function here
  onEmailContentpreviewChange();
});
watch(Receivervar, (newValue, oldValue) => {
  //console.log('EmailContentpreview changed from', oldValue, 'to', newValue);
  // Call your function here
  onEmailContentpreviewChange();
});
watch(DescriptionVar, (newValue, oldValue) => {
  //console.log('EmailContentpreview changed from', oldValue, 'to', newValue);
  // Call your function here
  onEmailContentpreviewChange();
});
watch(Sourcevar, (newValue, oldValue) => {
  //console.log('EmailContentpreview changed from', oldValue, 'to', newValue);
  // Call your function here
  onEmailContentpreviewChange();
});
function handleFocus(event: FocusEvent) {
  const target = event.target as HTMLTextAreaElement | HTMLInputElement;
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
    lastFocusedElement = target;
  }
}

function onEmailContentpreviewChange() {
  const changeData: EmailTemplatePreviewdata = {
    Sender: Sendervar.value,
    Receiver: Receivervar.value,
    TplTitle: tplTitle.value,
    TplContent: tplcontent.value,
    Url:Sourcevar.value,
    Description:DescriptionVar.value
  }
  const tplres = convertVariableInTemplate(changeData)
  console.log(tplres)
  EmailTitlepreview.value = tplres.TplTitle;
  EmailContentpreview.value = tplres.TplContent;
}

async function onSubmit() {
  console.log("submit");
  if (!form.value) return;
  const { valid } = await form.value.validate();
  // console.log(valid);
  loading.value = true;
  if (!valid) {
    console.log("form is not valid");
    loading.value = false;
    alert.value = true;
    alertcolor.value = "error";
    alertContent.value = "form is not valid";
  } else {
    const soacc: EmailTemplateRespdata = {

      TplTitle: tplTitle.value,
      TplContent: tplcontent.value,
      TplDescription: tplDescription.value,
    };


    if ($route.params.id) {
      soacc.TplId = parseInt($route.params.id.toString());
    }
    console.log(soacc);
    await updateEmailtemplate(soacc)
      .then((res) => {
        loading.value = false;
        console.log(res)
        if (res.id > 0) {
          alert.value = true;
          alertcolor.value = "success";
          alertContent.value = "Save success";
          soacc.TplId = res.id;
          $route.params.id = res.id.toString();
          isEdit.value = true;
          templateId.value = res.id;
        } else {
          alert.value = true;
          alertcolor.value = "error";
          alertContent.value = "Save fail";
        }
        setTimeout(() => {
          alert.value = false;
          if (res.id > 0) {
            router.push({
              path: "/emailmarketing/template/list",
            });
          }
        }, 5000);
      })
      .catch((err) => {
        loading.value = false;
        alert.value = true;
        alertcolor.value = "error";
        alertContent.value = err.message;
      });
  }
  loading.value = false;
}

function submitpreview() {
  previewdialog.value = true;
  console.log(tplcontent.value)
  console.log(tplTitle.value)
  EmailContentpreview.value = tplcontent.value;
  EmailTitlepreview.value = tplTitle.value;
  onEmailContentpreviewChange();
}

function insertVariable(variable: string) {
  const activeElement = lastFocusedElement;
  console.log(activeElement)
  if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
  //  console.log(244)
    //insert variable to content
    // if (textarea.value) {
    //   const el = textarea.value;
    //   if (el) {
    //     const start = el.selectionStart;
    //     const end = el.selectionEnd;
    //     const text = tplcontent.value;
    //     tplcontent.value = text.slice(0, start) + variable + text.slice(end);
    //     // Move the cursor to the end of the inserted variable
    //     el.selectionStart = el.selectionEnd = start + variable.length;
    //     el.focus();
    //   }
    // }
    const start = activeElement.selectionStart;
    const end = activeElement.selectionEnd;
    const text = activeElement.value;
    if (start !== null && end !== null) {
      console.log(start, end)
      activeElement.value = text.slice(0, start) + variable + text.slice(end);

      // Move the cursor to the end of the inserted variable
      activeElement.selectionStart = activeElement.selectionEnd = start + variable.length;
      activeElement.focus();
    }
    console.log(activeElement)
    console.log(textarea.value)
    // Update the corresponding Vue ref if necessary

    if (activeElement.tagName === 'TEXTAREA') {
      tplcontent.value = activeElement.value;
    }else if (activeElement.tagName === 'INPUT') {
      tplTitle.value = activeElement.value;
    }
    // if (activeElement) {
    //   tplcontent.value = activeElement.value;
    // } else if (activeElement.tagName === 'INPUT' && activeElement.type === 'text') {
    //   tplTitle.value = activeElement.value;
    // }

  }
}

onMounted(() => {
  initialize();
  document.addEventListener('focusin', handleFocus);
});
onBeforeUnmount(() => {
  document.removeEventListener('focusin', handleFocus);
});
</script>
