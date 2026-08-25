<template>
  <AppPageShell
    page-id="email-service-editor"
    title-key="route.email_service_create"
    content-width="form"
  >
    <v-sheet class="mx-auto" rounded>

    <v-form ref="form" v-model="validForm" @submit.prevent="onSubmit" class="ml-2 mr-2">
      <v-alert
v-model="alert" border="start" variant="tonal" closable close-label="Close Alert" title="Information"
        :color="alertcolor">
        {{ alertContent }}
      </v-alert>

      <v-row>
        <v-col cols="12" md="12">
          <v-text-field
v-model="name" :label="t('emailservice.name')" type="input"
            :hint="t('emailservice.name_hint')" :readonly="loading" clearable required
            :rules="[rules.required]"></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <v-text-field
v-model="from" :label="t('emailservice.from')" type="email"
            :hint="t('emailservice.from_hint')" :readonly="loading" clearable required
            :rules="[rules.email]"></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <v-text-field
v-model="password" :label="t('emailservice.password')" :type="show ? 'text' : 'password'"
            @click:append="show = !show" :hint="t('emailservice.password')" :readonly="loading" clearable required
            :append-icon="show ? 'mdi-eye' : 'mdi-eye-off'"></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <v-text-field
v-model="host" :label="t('emailservice.host')" type="input"
            :hint="t('emailservice.host_hint')" :readonly="loading" clearable required></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <v-number-input
:reverse="false" control-variant="default" label="port" :hint="t('emailservice.port_hint')"
            :min="1" :max="65535" v-model="port" :readonly="loading" clearable></v-number-input>

        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <p><b>{{ t('emailservice.ssl') }}:</b></p>
          <v-btn-toggle v-model="ssl" mandatory>
            <v-btn :value="1" color="primary"> {{ t('common.yes') }}</v-btn>
            <v-btn :value="0" color="success">{{ t('common.no') }}</v-btn>
          </v-btn-toggle>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" class="d-flex justify-center">
          <v-btn color="blue" @click="openTestDialog">
            {{ t('common.test') }}
          </v-btn>
        </v-col>
      </v-row>

      <!-- ===== Inbound receive settings ===== -->
      <v-divider class="mt-4 mb-2"></v-divider>
      <v-row>
        <v-col cols="12" md="12">
          <p><b>{{ t('emailReceive.receive_settings') }}</b></p>
          <v-btn-toggle v-model="receiveEnabled" mandatory>
            <v-btn :value="1" color="primary">{{ t('emailReceive.receive_enabled') }}</v-btn>
            <v-btn :value="0" color="success">{{ t('emailReceive.receive_disabled') }}</v-btn>
          </v-btn-toggle>
        </v-col>
      </v-row>
      <v-row v-if="receiveEnabled === 1">
        <v-col cols="12" md="4">
          <v-select
v-model="receiveProtocol" :items="[{ title: 'IMAP', value: 'imap' }, { title: 'POP3', value: 'pop3' }]"
            :label="t('emailReceive.receive_protocol')" :readonly="loading"></v-select>
        </v-col>
        <v-col cols="12" md="4">
          <v-text-field
v-model="receiveFolder" :label="t('emailReceive.folder')" :hint="t('emailReceive.folder_hint')"
            :readonly="loading"></v-text-field>
        </v-col>
        <v-col cols="12" md="4" class="d-flex align-center">
          <v-btn color="blue" :loading="testingReceive" @click="testReceiveConnection">
            {{ t('emailReceive.test_connection') }}
          </v-btn>
        </v-col>
      </v-row>
      <template v-if="receiveEnabled === 1 && receiveProtocol === 'imap'">
        <v-row>
          <v-col cols="12" md="8">
            <v-text-field
v-model="imapHost" :label="t('emailReceive.imap_host')" :readonly="loading" clearable></v-text-field>
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
v-model="imapPort" :label="t('emailReceive.imap_port')" :readonly="loading" clearable></v-text-field>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12" md="12">
            <p><b>{{ t('emailReceive.imap_ssl') }}:</b></p>
            <v-btn-toggle v-model="imapSsl" mandatory>
              <v-btn :value="1" color="primary">{{ t('common.yes') }}</v-btn>
              <v-btn :value="0" color="success">{{ t('common.no') }}</v-btn>
            </v-btn-toggle>
          </v-col>
        </v-row>
      </template>
      <template v-if="receiveEnabled === 1 && receiveProtocol === 'pop3'">
        <v-row>
          <v-col cols="12" md="8">
            <v-text-field
v-model="pop3Host" :label="t('emailReceive.pop3_host')" :readonly="loading" clearable></v-text-field>
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
v-model="pop3Port" :label="t('emailReceive.pop3_port')" :readonly="loading" clearable></v-text-field>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12" md="12">
            <p><b>{{ t('emailReceive.pop3_ssl') }}:</b></p>
            <v-btn-toggle v-model="pop3Ssl" mandatory>
              <v-btn :value="1" color="primary">{{ t('common.yes') }}</v-btn>
              <v-btn :value="0" color="success">{{ t('common.no') }}</v-btn>
            </v-btn-toggle>
          </v-col>
        </v-row>
      </template>
      <v-row v-if="receiveEnabled === 1">
        <v-col cols="12" md="6">
          <v-text-field
v-model="receiveUsername" :label="t('emailReceive.receive_username')" :hint="t('emailReceive.receive_username_hint')"
            :readonly="loading" clearable></v-text-field>
        </v-col>
        <v-col cols="12" md="6">
          <v-text-field
v-model="receivePassword" :label="t('emailReceive.receive_password')" :type="showReceivePassword ? 'text' : 'password'"
            @click:append="showReceivePassword = !showReceivePassword" :readonly="loading" clearable
            :append-icon="showReceivePassword ? 'mdi-eye' : 'mdi-eye-off'"></v-text-field>
        </v-col>
      </v-row>

      <v-alert
v-model="alert" border="start" variant="tonal" closable close-label="Close Alert" title="Information"
        :color="alertcolor">
        {{ alertContent }}
      </v-alert>

      <div class="d-flex flex-column mt-4 mb-4">
        <v-row>

          <v-col cols="6" md="6">
            <v-btn color="error" block @click="router.go(-1)">
              {{ t('common.return') }}
            </v-btn>
          </v-col>
          <v-col cols="6" md="6">
            <v-btn color="success" type="submit" :loading="loading">
              {{ t('common.submit') }}
            </v-btn>
          </v-col>


        </v-row>
      </div>
    </v-form>
  </v-sheet>
  <!-- test service valid dialog -->
  <v-dialog v-model="showtestdialog" max-width="600" persistent>
    <v-form ref="testform" @submit.prevent="submitTestemail" class="ml-2 mr-2" v-model="testvalidForm" lazy-validation>
      <v-card prepend-icon="mdi-account" :title="CapitalizeFirstLetter(t('emailservice.test_email_service'))">
        <v-card-text>
          <v-container fluid>
            <v-row>
              <v-col cols="12" md="12">
                <v-text-field
v-model="testemailReceiver" :label="t('emailservice.test_email_receiver')" type="input"
                  :hint="t('emailservice.test_email_receiver_hint')" :readonly="loading" clearable required
                  :rules="[rules.required, rules.email]"></v-text-field>
              </v-col>
            </v-row>
            <v-row>
              <v-col cols="12" md="12">
                <v-text-field
v-model="testemailTitle" :label="t('emailservice.test_email_title')" type="input"
                  :hint="t('emailservice.test_email_title_hint')" :readonly="loading" clearable required
                  :rules="[rules.required]"></v-text-field>
              </v-col>
            </v-row>
            <v-row>
              <v-textarea
:label="t('emailservice.test_email_content_hint')" v-model="testemailContent"
                name="input-7-1" variant="filled" auto-grow :rules="[rules.required]"></v-textarea>
            </v-row>
          </v-container>

        </v-card-text>

        <v-divider></v-divider>

        <v-card-actions>
          <v-spacer></v-spacer>

          <v-btn text="Close" variant="plain" @click="showtestdialog = false"></v-btn>

          <v-btn color="primary" :text="t('common.send')" variant="tonal" type="submit"></v-btn>
        </v-card-actions>

      </v-card>
    </v-form>
  </v-dialog>
  <ErrorDialog
:show-dialog="showDialog" :alertext="alertdiatext" :alertitle="alertdiatitle"
    @dialogclose="showDialog = false" />
  <LoadingDialog :load-dialogshow="loadDialogshow" :loadingtitle="CapitalizeFirstLetter(t('common.loading'))" />
</AppPageShell>
</template>
<script setup lang="ts">
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import { ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getEmailServiceDetail, createupdateEmailService, sendTestemail, receiveEmailsendevent } from "@/views/api/emailservice";
import { testEmailReceiveConnection } from "@/views/api/emailreceive";
import { EmailServiceEntitydata, EmailSendParam, EmailRequestData } from "@/entityTypes/emailmarketingType"
import { CapitalizeFirstLetter } from "@/views/utils/function"
import { CommonDialogMsg } from "@/entityTypes/commonType"
import ErrorDialog from "@/views/components/widgets/errorDialog.vue"
import LoadingDialog from "@/views/components/widgets/loadingDialog.vue"
const showDialog = ref<boolean>(false);
const alertdiatext = ref<string>("")
const alertdiatitle = ref<string>("")
const { t } = useI18n({ inheritLocale: true });
const Id = ref<number>(0);
const showtestdialog = ref<boolean>(false);
const validForm = ref<boolean>(true);
const testvalidForm = ref<boolean>(true);
const loadDialogshow = ref<boolean>(false);
watch(loadDialogshow, (newValue) => {
  if (!newValue) {
    console.log("Loading dialog is now shown");
    return;
  }
  setTimeout(() => (loadDialogshow.value = false), 10000)
});

const rules = {
  required: (value) => {
    if (!value) return "The field is required";
    return true;
  },
  email: (value) => {
    if (!value) return "E-mail is required";
    if (!/.+@.+\..+/.test(value)) return "E-mail must be valid.";
    return true;
  },
};
const $route = useRoute();
const router = useRouter();
const FakeAPI = {
  async fetch(id: number): Promise<EmailServiceEntitydata> {
    return await getEmailServiceDetail(id);
  },
};

const form = ref<HTMLFormElement>();
const testform = ref<HTMLFormElement>();
const from = ref<string>("");
const password = ref<string>("");
const host = ref<string>("");
const port = ref<string>("");
const name = ref<string>("");
const ssl = ref<number>(0);

// ---- inbound receive settings ----
const receiveEnabled = ref<number>(0);
const receiveProtocol = ref<"imap" | "pop3">("imap");
const imapHost = ref<string>("");
const imapPort = ref<string>("");
const imapSsl = ref<number>(1);
const pop3Host = ref<string>("");
const pop3Port = ref<string>("");
const pop3Ssl = ref<number>(1);
const receiveUsername = ref<string>("");
const receivePassword = ref<string>("");
const receiveFolder = ref<string>("INBOX");
const showReceivePassword = ref<boolean>(false);
const testingReceive = ref<boolean>(false);

function parseReceivePort(value: string): number | null {
  const port = Number(value.trim());
  return Number.isInteger(port) ? port : null;
}

function syncImplicitTlsPortToggle(protocol: "imap" | "pop3", portValue: string): void {
  const port = parseReceivePort(portValue);
  if (protocol === "imap" && port === 993) {
    imapSsl.value = 1;
  }
  if (protocol === "pop3" && port === 995) {
    pop3Ssl.value = 1;
  }
}

watch(imapPort, (newValue) => {
  syncImplicitTlsPortToggle("imap", newValue);
});

watch(pop3Port, (newValue) => {
  syncImplicitTlsPortToggle("pop3", newValue);
});

const loading = ref<boolean>(false);
const show = ref<boolean>(false);
const alert = ref<boolean>(false);
const alertContent = ref("");
const alertcolor = ref("");

const isEdit = ref(false);
const testemailReceiver = ref<string>("")
const testemailTitle = ref<string>("")
const testemailContent = ref<string>("")

const initialize = async () => {
  const routeId = Number($route.params.id);
  if (Number.isInteger(routeId) && routeId > 0) {
    Id.value = routeId;
  }

  if (Id.value > 0) {
    isEdit.value = true;
    FakeAPI.fetch(Id.value).then((res) => {
      console.log(res)
      if (res) {
        if (res.id && res.id > 0) {
          Id.value = res.id;
        }
        from.value = res.from;
        password.value = res.password;
        host.value = res.host;
        port.value = res.port;
        name.value = res.name;
        ssl.value = res.ssl;
        // receive settings (optional)
        receiveEnabled.value = res.receiveEnabled ?? 0;
        receiveProtocol.value = (res.receiveProtocol === "pop3" ? "pop3" : "imap");
        imapHost.value = res.imapHost ?? "";
        imapPort.value = res.imapPort ?? "";
        imapSsl.value = res.imapSsl ?? 1;
        pop3Host.value = res.pop3Host ?? "";
        pop3Port.value = res.pop3Port ?? "";
        pop3Ssl.value = res.pop3Ssl ?? 1;
        receiveUsername.value = res.receiveUsername ?? "";
        receivePassword.value = res.receivePassword ?? "";
        receiveFolder.value = res.receiveFolder ?? "INBOX";

      }
    });
  } else {
    isEdit.value = false;

  }


};



/** Test inbound receive connectivity. Can test before saving by sending settings directly. */
async function testReceiveConnection() {
  const missing: string[] = [];
  const usernameForTest = receiveUsername.value || from.value;
  const passwordForTest = receivePassword.value || password.value;
  const canUseStoredPassword = isEdit.value && Id.value > 0;
  if (!receiveProtocol.value) missing.push(t('emailReceive.receive_protocol'));
  if (!imapHost.value && receiveProtocol.value === 'imap') missing.push(t('emailReceive.imap_host'));
  if (!imapPort.value && receiveProtocol.value === 'imap') missing.push(t('emailReceive.imap_port'));
  if (!pop3Host.value && receiveProtocol.value === 'pop3') missing.push(t('emailReceive.pop3_host'));
  if (!pop3Port.value && receiveProtocol.value === 'pop3') missing.push(t('emailReceive.pop3_port'));
  if (!usernameForTest) missing.push(t('emailReceive.receive_username'));
  if (!passwordForTest && !canUseStoredPassword) missing.push(t('emailReceive.receive_password'));
  if (missing.length > 0) {
    alert.value = true;
    alertcolor.value = "error";
    alertContent.value = (t('emailservice.required_fields_missing') || 'Please fill in all required fields') + ': ' + missing.join(', ');
    return;
  }

  const isImap = receiveProtocol.value === 'imap';
  const settings = {
    protocol: receiveProtocol.value,
    host: isImap ? imapHost.value : pop3Host.value,
    port: parseInt(isImap ? imapPort.value : pop3Port.value, 10),
    ssl: isImap ? imapSsl.value === 1 : pop3Ssl.value === 1,
    username: usernameForTest,
    folder: receiveFolder.value || 'INBOX',
  };
  if (passwordForTest) {
    Object.assign(settings, { password: passwordForTest });
  }

  testingReceive.value = true;
  try {
    const res = await testEmailReceiveConnection(Id.value || 0, settings);
    alert.value = true;
    alertcolor.value = res.success ? "success" : "error";
    alertContent.value = res.success
      ? t("emailReceive.test_connection_success")
      : `${t("emailReceive.test_connection_failed")}${res.error ? ": " + res.error : ""}`;
  } catch (err) {
    alert.value = true;
    alertcolor.value = "error";
    alertContent.value = err instanceof Error ? err.message : String(err);
  } finally {
    testingReceive.value = false;
  }
}

async function onSubmit() {
  console.log("submit");
  if (!form.value) return;
  const { valid } = await form.value.validate();
  console.log(valid);
  loading.value = true;
  if (!valid) {
    loading.value = false
    console.log("form is not valid");
    alert.value = true;
    alertcolor.value = "error";
    alertContent.value = "form is not valid";
    loading.value = false;
    return
  } else {
    if (port.value.length > 5) {

      alert.value = true;
      alertcolor.value = "error";
      alertContent.value = t("emailservice.port_lenght_error");
      loading.value = false;
      return;
    }
    const soacc: EmailServiceEntitydata = {
      name: name.value,
      from: from.value,
      password: password.value,
      host: host.value,
      port: port.value,
      ssl: ssl.value,
      receiveEnabled: receiveEnabled.value,
      receiveProtocol: receiveProtocol.value,
      imapHost: imapHost.value || null,
      imapPort: imapPort.value || null,
      imapSsl: imapSsl.value,
      pop3Host: pop3Host.value || null,
      pop3Port: pop3Port.value || null,
      pop3Ssl: pop3Ssl.value,
      receiveUsername: receiveUsername.value || null,
      receivePassword: receivePassword.value || null,
      receiveFolder: receiveFolder.value || "INBOX",
    };


    if (isEdit.value && Id.value > 0) {
      soacc.id = Id.value;
    }
    console.log(soacc);
    await createupdateEmailService(soacc)
      .then((res) => {
        console.log(res)
        if (res) {
          if (res.id && res.id > 0) {
            alert.value = true;
            alertcolor.value = "success";
            alertContent.value = CapitalizeFirstLetter(t("common.save_success"));
            soacc.id = res.id;
            isEdit.value = true;
            Id.value = res.id;
          } else {
            alert.value = true;
            alertcolor.value = "error";
            alertContent.value = "Save fail";
          }
          setTimeout(() => {
            alert.value = false;
            if (res.id && res.id > 0) {
              router.push({
                name: 'Email_Marketing_Service_LIST'
              });
            }
          }, 3000);
        }
      }
      )
      .catch((err) => {
        alert.value = true;
        alertcolor.value = "error";
        alertContent.value = err.message;
      });
  }
  loading.value = false;
}

const openTestDialog = () => {
  const missing: string[] = [];
  if (!name.value) missing.push(t('emailservice.name'));
  if (!from.value) missing.push(t('emailservice.from'));
  if (!password.value) missing.push(t('emailservice.password'));
  if (!host.value) missing.push(t('emailservice.host'));
  if (!port.value) missing.push(t('emailservice.port'));
  if (missing.length > 0) {
    alert.value = true;
    alertcolor.value = "error";
    alertContent.value = (t('emailservice.required_fields_missing') || 'Please fill in all required fields') + ': ' + missing.join(', ');
    return;
  }
  showtestdialog.value = true;
};

const submitTestemail = async () => {
  if (!testform.value) return;
  const { valid } = await testform.value.validate();
  console.log(valid)
  if (!valid) {

    console.log("test form is not valid");
    return

  }
  const emailSetting: EmailServiceEntitydata = {
    name: name.value,
    from: from.value,
    password: password.value,
    host: host.value,
    port: port.value,
    ssl: ssl.value
  }
  const emailRequestdata: EmailRequestData = {
    From: from.value,
    Title: testemailTitle.value,
    Content: testemailContent.value,
    Receiver: testemailReceiver.value
  }
  const emailsendParam: EmailSendParam = {
    Setting: emailSetting,
    EmailRequestData: emailRequestdata
  }
  loadDialogshow.value = true
  sendTestemail(emailsendParam)

}

const receiveMsg = () => {
  receiveEmailsendevent(function (res) {
    console.log(res)
    const obj = JSON.parse(res) as CommonDialogMsg
    loadDialogshow.value = false
    if (!obj) {
      return
    }
    showtestdialog.value = false
    showDialog.value = true
    if (obj.data) {
      if (obj.status) {
        alertdiatext.value = t("emailservice.email_send_success")
      } else {
        alertdiatext.value = obj.data?.content
      }

      alertdiatitle.value = t(obj.data?.title)
    } else {
      alertdiatext.value = t("common.unkonw_error")
      alertdiatitle.value = t("common.unkonw_error")
    }

  })
}


onMounted(() => {
  initialize();
  receiveMsg()
});


</script>
<style scoped>
.rounded-text-field .v-input__control {
  border-radius: 12px;
  /* Adjust the value as needed */
}
</style>
