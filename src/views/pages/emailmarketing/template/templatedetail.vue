<template>
  <v-sheet class="mx-auto" rounded>

    <v-form ref="form" @submit.prevent="onSubmit">
      <v-row>
        <v-col cols="12" md="8">
          <v-text-field
ref="inputs" v-model="tplTitle" :label="t('emailmarketing.title')" type="input"
            :hint="t('emailmarketing.title_hint')" :readonly="loading" clearable
            required></v-text-field>
          <!-- <v-text-field v-model="tplcontent" :label="$t('emailmarketing.content')" type="input"
            :hint="$t('emailmarketing.title_content')" :rules="[rules.required]" required :readonly="loading"
            clearable></v-text-field> -->
          <!-- https://www.vue2editor.com/examples/#basic-setup -->
          <!-- <vue-editor v-model="tplcontent" /> -->
          <v-textarea
ref="textarea" v-model="tplcontent" :label="t('emailmarketing.content')"
            :hint="t('emailmarketing.content_hint')" :rules="[rules.required]" :readonly="loading" clearable rows="10"
            required auto-grow></v-textarea>
        
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

          <!-- AI Email Template Generation Button -->
          <v-btn @click="aiPanelOpen = !aiPanelOpen" color="purple-darken-3" class="mb-2 ml-2 mt-4" rounded="lg" size="small" prepend-icon="mdi-robot">
            {{ t('aiTemplateGeneration.title') || 'Generate with AI' }}
          </v-btn>

          <!-- AI Generation Expansion Panel -->
          <v-expansion-panels v-model="aiPanelOpen" class="ml-2 mt-2">
            <v-expansion-panel title="AI Template Generation">
              <v-expansion-panel-text>
                <v-textarea
                  v-model="prompt"
                  :label="t('aiTemplateGeneration.promptLabel') || 'Email Description'"
                  :placeholder="t('aiTemplateGeneration.promptPlaceholder') || 'Describe what email you want to create...'"
                  rows="3"
                  counter="500"
                  :readonly="isStreaming"
                  class="mb-2"
                ></v-textarea>

                <v-select
                  v-model="tone"
                  :label="t('aiTemplateGeneration.tone') || 'Tone'"
                  :items="[
                    { title: 'Formal', value: 'formal' },
                    { title: 'Casual', value: 'casual' },
                    { title: 'Friendly', value: 'friendly' },
                    { title: 'Professional', value: 'professional' }
                  ]"
                  :readonly="isStreaming"
                  class="mb-2"
                ></v-select>

                <v-select
                  v-model="templateType"
                  :label="t('aiTemplateGeneration.templateType') || 'Email Type'"
                  :items="[
                    { title: 'Cold Outreach', value: 'cold_outreach' },
                    { title: 'Follow Up', value: 'follow_up' },
                    { title: 'Newsletter', value: 'newsletter' },
                    { title: 'Promotion', value: 'promotion' },
                    { title: 'Custom', value: 'custom' }
                  ]"
                  :readonly="isStreaming"
                  class="mb-2"
                ></v-select>

                <!-- Advanced Options -->
                <v-expansion-panels class="mb-2">
                  <v-expansion-panel title="Advanced Options">
                    <v-expansion-panel-text>
                      <v-checkbox
                        v-model="useRAG"
                        :label="t('aiTemplateGeneration.useKnowledgeBase') || 'Use knowledge base for context'"
                        :disabled="isStreaming"
                        density="compact"
                      ></v-checkbox>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>

                <!-- Streaming Output Display -->
                <v-card v-if="isStreaming || streamedContent" class="mb-2" variant="outlined">
                  <v-card-text>
                    <div v-if="isStreaming" class="text-caption text-grey mb-2">
                      {{ t('aiTemplateGeneration.generating') || 'Generating template...' }}
                    </div>
                    <div class="text-body-2 streamed-content">
                      {{ streamedContent }}
                    </div>
                  </v-card-text>
                </v-card>

                <!-- Action Buttons -->
                <div class="d-flex">
                  <v-btn
                    v-if="!isStreaming"
                    @click="generateTemplate"
                    color="primary"
                    :disabled="!prompt || prompt.trim().length < 10"
                    block
                  >
                    {{ t('aiTemplateGeneration.generateButton') || 'Generate' }}
                  </v-btn>
                  <v-btn
                    v-else
                    @click="stopGeneration"
                    color="error"
                    block
                  >
                    {{ t('aiTemplateGeneration.stopButton') || 'Stop Generating' }}
                  </v-btn>
                </div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>

        </v-col>
      </v-row>
      <v-alert
v-model="alert" border="start" variant="tonal" closable close-label="Close Alert" title="Information"
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
    <v-card
max-width="400" prepend-icon="mdi-update" text="Input follow variable content to preview email"
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
          <v-text-field
v-model="EmailTitlepreview" :label="t('emailmarketing.title')" type="input"
            readonly></v-text-field>
        </v-row>
        <v-row dense>
          <v-textarea
v-model="EmailContentpreview" :label="t('emailmarketing.content')" readonly rows="10" required
            auto-grow></v-textarea>
        </v-row>
      </v-card-text>
      <template v-slot:actions>
        <v-spacer></v-spacer>
        <v-btn text="Close" @click="previewdialog = false"></v-btn>

      </template>
    </v-card>
  </v-dialog>

  <!-- Regenerate Confirmation Dialog -->
  <v-dialog v-model="showRegenerateConfirm" max-width="500">
    <v-card>
      <v-card-title>
        {{ t('aiTemplateGeneration.regenerateConfirmTitle') || 'Regenerate Template' }}
      </v-card-title>
      <v-card-text>
        {{ t('aiTemplateGeneration.regenerateConfirm') || 'Replace current generated template?' }}
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn @click="cancelRegenerate">
          {{ t('common.cancel') || 'Cancel' }}
        </v-btn>
        <v-btn @click="confirmRegenerate" color="primary">
          {{ t('common.replace') || 'Replace' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
// import router from '@/views/router';
import { ref, onMounted, watch,onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getEmailtemplatebyid, updateEmailtemplate, generateAIEmailTemplate } from "@/views/api/emailmarketing"
import { EmailTemplateRespdata, EmailTemplatePreviewdata, AIEmailTemplateRequest } from "@/entityTypes/emailmarketingType"
import { convertVariableInTemplate } from "@/views/utils/emailFun"
import {
  AI_EMAIL_TEMPLATE_GENERATE_CHUNK,
  AI_EMAIL_TEMPLATE_GENERATE_COMPLETE,
  AI_EMAIL_TEMPLATE_ERROR,
  AI_EMAIL_TEMPLATE_STOP
} from "@/config/channellist"
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

// AI Email Template Generation State
const aiPanelOpen = ref<boolean>(false);
const prompt = ref<string>("");
const tone = ref<string>("professional");
const templateType = ref<string>("cold_outreach");
const useRAG = ref<boolean>(false);
const isStreaming = ref<boolean>(false);
const streamedContent = ref<string>("");
const showRegenerateConfirm = ref<boolean>(false);
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

// AI Email Template Generation Functions
async function generateTemplate() {
  // Check if we already have generated content
  if (streamedContent.value && !showRegenerateConfirm.value) {
    showRegenerateConfirm.value = true;
    return;
  }

  if (!prompt.value || prompt.value.trim().length < 10) {
    alert.value = true;
    alertcolor.value = "error";
    alertContent.value = t("aiTemplateGeneration.error.promptTooShort") || "Prompt must be at least 10 characters";
    return;
  }

  isStreaming.value = true;
  streamedContent.value = "";
  aiPanelOpen.value = true; // Ensure panel is open during generation

  const requestData: AIEmailTemplateRequest = {
    prompt: prompt.value,
    tone: tone.value as any,
    templateType: templateType.value as any,
    useRAG: useRAG.value,
  };

  try {
    const result = await generateAIEmailTemplate(
      requestData,
      (chunkData) => {
        // Handle streaming chunks
        if (chunkData.content) {
          streamedContent.value = chunkData.fullContent || "";
        }
      }
    );

    // Generation complete - result is handled by event listeners
    console.log("AI generation complete:", result);
  } catch (error) {
    console.error("AI generation error:", error);
    isStreaming.value = false;
    alert.value = true;
    alertcolor.value = "error";
    alertContent.value = error instanceof Error ? error.message : "Generation failed";
  }
}

function stopGeneration() {
  if (window.api) {
    window.api.send(AI_EMAIL_TEMPLATE_STOP, {});
  }
  isStreaming.value = false;
}

function confirmRegenerate() {
  showRegenerateConfirm.value = false;
  streamedContent.value = "";
  generateTemplate();
}

function cancelRegenerate() {
  showRegenerateConfirm.value = false;
}

// Handle streaming chunk event
function handleChunk(_event: unknown, chunkData: { type: string; content: string; fullContent: string }): void {
  if (chunkData.type === "chunk") {
    streamedContent.value = chunkData.fullContent || "";
  }
}

// Handle generation complete event
function handleComplete(_event: unknown, response: { type: string; status: boolean; data: any }): void {
  isStreaming.value = false;

  if (response.status && response.data) {
    const { title, content, hasInvalidVariables, invalidVariables } = response.data;

    // Populate the form fields
    tplTitle.value = title || "";
    tplcontent.value = content || "";

    // Show warning if invalid variables were found
    if (hasInvalidVariables && invalidVariables && invalidVariables.length > 0) {
      alert.value = true;
      alertcolor.value = "warning";
      alertContent.value =
        t("aiTemplateGeneration.invalidVariables") +
        " " +
        invalidVariables.join(", ");
    } else {
      // Show success message
      alert.value = true;
      alertcolor.value = "success";
      alertContent.value = "Template generated successfully!";
    }

    // Collapse panel after successful generation
    setTimeout(() => {
      aiPanelOpen.value = false;
    }, 1000);
  }
}

// Handle generation error event
function handleError(_event: unknown, error: { type: string; status: boolean; msg: string }): void {
  isStreaming.value = false;
  alert.value = true;
  alertcolor.value = "error";

  // Check if this is an AI disabled error
  if (error.msg && error.msg.includes("AI features are not enabled")) {
    alertContent.value = t("aiTemplateGeneration.error.aiDisabled") || error.msg;
  } else {
    alertContent.value = error.msg || "Generation failed";
  }
}

onMounted(() => {
  initialize();
  document.addEventListener('focusin', handleFocus);

  // Register AI email template event listeners
  if (window.api) {
    window.api.receive(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, handleChunk);
    window.api.receive(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, handleComplete);
    window.api.receive(AI_EMAIL_TEMPLATE_ERROR, handleError);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('focusin', handleFocus);

  // Clean up AI email template event listeners
  if (window.api) {
    window.api.removeListener(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, handleChunk);
    window.api.removeListener(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, handleComplete);
    window.api.removeListener(AI_EMAIL_TEMPLATE_ERROR, handleError);
  }
});
</script>
