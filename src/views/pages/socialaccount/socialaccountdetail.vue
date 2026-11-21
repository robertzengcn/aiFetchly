<template>
  <AppPageShell
    :page-id="isEdit ? 'socialaccount-edit' : 'socialaccount-create'"
    :title-key="isEdit ? 'route.edit_tool_account' : 'route.add_tool_account'"
    content-width="form"
  >
    <!-- Objective title + context (IPR-019); the form owns its fields. -->
    <template #context>
      <button
        type="button"
        class="back-link"
        data-testid="socialaccount-detail-back"
        @click="router.go(-1)"
      >
        <v-icon icon="mdi-arrow-left" size="14" aria-hidden="true" />
        {{ t('route.tool_account_list') }}
      </button>
    </template>
    <v-sheet class="mx-auto" rounded>
    <v-form ref="form" @submit.prevent="onSubmit">
      <v-text-field
        v-model="socialaccountId"
        :label="t('socialaccount.col_id')"
        type="input"
        v-show="isEdit"
        :readonly="true"
        clearable
      ></v-text-field>
      <v-text-field
        v-model="user"
        :label="t('socialaccount.user')"
        type="input"
        :hint="t('socialaccount.user_hint')"
        :rules="[rules.required]"
        required
        :readonly="loading"
        clearable
      ></v-text-field>
      <v-text-field
        v-model="pass"
        :label="t('socialaccount.pass') + ' (' + t('common.optional') + ')'"
        
        :hint="t('socialaccount.pass_hint')"
        :readonly="loading"
        :type="show ? 'text' : 'password'"
            @click:append="show = !show"
        clearable
        :append-icon="show ? 'mdi-eye' : 'mdi-eye-off'"
      ></v-text-field>
      
      <v-label class="text-body-2 font-weight-medium mb-2 text-capitalize">{{ t('common.status') }}</v-label>
      <v-btn-toggle v-model="status" mandatory>
        <v-btn :value="0" color="primary">{{ t('socialaccount.inactive') }}</v-btn>
        <v-btn :value="1" color="success">{{ t('socialaccount.active') }}</v-btn>
      </v-btn-toggle>

      <!-- Q-01/B10: per-account AI opt-in (editable for existing accounts). -->
      <div v-if="isEdit" class="mt-3" data-testid="socialaccount-ai-optin">
        <v-checkbox
          :model-value="aiUseEnabled"
          :label="t('socialaccount.ai_use_enabled')"
          :hint="t('socialaccount.ai_use_enabled_hint')"
          persistent-hint
          density="compact"
          :disabled="aiUseSaving || !aiUseLoaded"
          data-testid="socialaccount-ai-optin-checkbox"
          @update:model-value="onAiUseToggled"
        ></v-checkbox>
        <v-alert
          v-if="aiUseError !== null"
          type="error"
          density="compact"
          class="mt-1"
          data-testid="socialaccount-ai-optin-error"
        >
          {{ aiUseError }}
        </v-alert>
        <!-- R08/Q-01: a FAILED opt-in load is distinct from a confirmed
             disabled state — the checkbox stays inert until a successful
             read, with an explicit retry. -->
        <div v-if="aiUseLoadError !== null" class="mt-1">
          <v-alert
            type="warning"
            density="compact"
            data-testid="socialaccount-ai-optin-load-error"
          >
            {{ aiUseLoadError }}
          </v-alert>
          <v-btn
            size="x-small"
            variant="text"
            class="mt-1"
            :disabled="aiUseLoadRetrying"
            data-testid="socialaccount-ai-optin-retry"
            @click="loadAiUseOptIn"
          >
            {{ t('socialaccount.ai_use_retry') }}
          </v-btn>
        </div>
      </div>
      
      <v-autocomplete
        class="mt-3"
        v-model="social_type_id"
        :items="platformitems"
         density="comfortable"
        item-title="displayName"
        item-value="id"
        :label="t('socialaccount.platform')"
        required
        :readonly="loading"
        :rules="[rules.required]"
        clearable
        :menu-props="{ maxHeight: 400 }"
        no-data-text="No platforms available"
      >
        <!-- <template v-slot:item="{ props, item }">
          <v-list-item v-bind="props">
            <template v-slot:title>
              <div class="d-flex align-center">
                <span class="font-weight-medium">{{ (item as unknown as PlatformItem).displayName }}</span>
                <v-chip
                  size="small"
                  :color="getCategoryColor((item as unknown as PlatformItem).category)"
                  class="ml-2"
                  variant="tonal"
                >
                  {{ (item as unknown as PlatformItem).category }}
                </v-chip>
              </div>
            </template>
            <template v-slot:subtitle>
              <span class="text-caption text-grey">{{ (item as unknown as PlatformItem).url }}</span>
            </template>
          </v-list-item>
        </template> -->
      </v-autocomplete>
      <v-text-field
        v-model="name"
        :label="t('socialaccount.name') + ' (' + t('common.optional') + ')'"
        type="input"
        :hint="t('socialaccount.name_hint')"
        :readonly="loading"
      ></v-text-field>
      <v-text-field
        v-model="phone"
        clearable
        :label="t('socialaccount.phone') + ' (' + t('common.optional') + ')'"
        type="input"
        :hint="t('socialaccount.phone_hint')"
        :readonly="loading"
      ></v-text-field>
      <v-text-field
        v-model="email"
        clearable
        :label="t('socialaccount.email') + ' (' + t('common.optional') + ')'"
        type="input"
        :hint="t('socialaccount.email_hint')"
        :readonly="loading"
      ></v-text-field>

      <v-combobox
        v-model="proxyValue"
        :items="proxyValue"
        :label="t('socialaccount.select_proxy') + ' (' + t('common.optional') + ')'"
        item-title="host"
        multiple
        return-object
        chips
        clearable
      ></v-combobox>
      <v-btn color="primary" @click="showProxytable">{{ t('socialaccount.change_proxy') }}</v-btn>

      <div v-if="proxytableshow">
        <ProxyTableselected @change="handleSelectedChanged" />
      </div>

      <v-card
        v-if="isEdit && socialaccountId > 0"
        class="mt-4"
        variant="tonal"
        color="primary"
      >
        <v-card-title class="text-body-2 font-weight-medium d-flex align-center">
          <v-icon size="small" class="me-2">mdi-cookie</v-icon>
          {{ t('socialaccount.cookies') }}
        </v-card-title>
        <v-card-subtitle class="text-caption pb-2 d-flex align-center">
          <span>{{ t('socialaccount.uploadfilemsg_title') }}</span>
          <v-chip
            v-if="sessionStatus"
            size="x-small"
            class="ms-2"
            :color="sessionStatusColor"
            label
          >
            {{ t(`socialaccount.session_status_${sessionStatus}`) }}
            <span v-if="cookieCount > 0" class="ms-1">({{ cookieCount }})</span>
          </v-chip>
        </v-card-subtitle>
        <v-card-actions>
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-upload"
            @click="uploadCookies"
          >
            {{ t('socialaccount.upload_cookies_button') }}
          </v-btn>
          <!-- R10/P-FR-01: the session's proxy route — ids only. -->
          <v-select
            v-if="socialaccountId > 0"
            v-model="sessionProxyChoice"
            :items="[
              { title: 'Account default', value: 'default' },
              { title: 'Direct (no proxy)', value: 'direct' },
              ...savedProxies.map((p) => ({ title: p.label, value: String(p.id) })),
            ]"
            item-title="title"
            item-value="value"
            density="compact"
            hide-details
            style="max-width: 220px"
            data-testid="session-proxy-choice"
          ></v-select>
          <v-btn
            v-if="socialaccountId > 0"
            color="secondary"
            variant="tonal"
            prepend-icon="mdi-monitor"
            :loading="openingManagedBrowser"
            data-testid="open-managed-browser"
            @click="openManagedBrowser"
          >
            {{ t('socialaccount.open_managed_browser') || 'Open managed browser' }}
          </v-btn>
        </v-card-actions>
      </v-card>

      <BrowserProfileImportDialog
        v-model="importDialog"
        :account-id="socialaccountId"
        @imported="refreshMetadata"
      />

      <v-alert
        v-model="alert"
        border="start"
        variant="tonal"
        closable
        close-label="Close Alert"
        title="Information"
        :color="alertcolor"
      >
        {{ alertContent }}
      </v-alert>

      <div class="d-flex flex-row">
        <v-btn
          color="success"
          class="mt-4 me-4 flex-grow-1"
          type="submit"
          :loading="loading"
        >
          {{ t('common.submit') }}
        </v-btn>

        <v-btn color="error" class="mt-4 flex-grow-1" @click="router.go(-1)">
          {{ t('common.return') }}
        </v-btn>
      </div>
    </v-form>
  </v-sheet>
  </AppPageShell>
</template>
<script setup lang="ts">
import { ref, onMounted, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import {
  getSocialaccountinfo,
  saveSocialAccount,
  requireCookiesselecttab,
  receiveAccountLoginevent,
  getSessionMetadata,
  getSocialAccountAiUseEnabled,
  setSocialAccountAiUseEnabled,
  listBrowserSites,
} from "@/views/api/socialaccount";
import { SOCIAL_ACCOUNT_LOGIN_MESSSAGE } from "@/config/channellist";
import { CommonDialogMsg } from "@/entityTypes/commonType";
import { useRoute, useRouter } from "vue-router";
import { SocialAccountDetailData } from "@/entityTypes/socialaccount-type";
import ProxyTableselected from "@/views/pages/proxy/widgets/ProxySelectedTable.vue";
import { ProxyListEntity, Proxy } from "@/entityTypes/proxyType";
import { SocialPlatformList } from "@/config/generate";
import BrowserProfileImportDialog from "@/views/components/socialaccount/BrowserProfileImportDialog.vue";

// Interface for platform items with proper typing
interface PlatformItem {
  id: number;
  name: string;
  displayName: string;
  category: string;
  url: string;
}

const { t } = useI18n();
const show = ref<boolean>(false);
const $route = useRoute();
const router = useRouter();
const FakeAPI = {
  async fetch(id: number): Promise<SocialAccountDetailData> {
    return await getSocialaccountinfo(id);
  },
};

//defined the value in page
const form = ref<HTMLFormElement>();
const user = ref(""); //account
const pass = ref(""); //password
const status = ref(1);
const name = ref(""); //username
const phone = ref("");
const email = ref("");
// const proxy = ref(0);
const socialaccountId = ref(0);
const openingManagedBrowser = ref(false);
// R10/P-FR-01: the user's proxy choice for THIS session — "default" uses
// the account's linked proxy, "direct" forces no proxy, an explicit id
// selects a saved proxy. Ids only — never host/port/credentials.
const sessionProxyChoice = ref<string>("default");
const savedProxies = ref<Array<{ id: number; label: string }>>([]);

async function loadSavedProxies(): Promise<void> {
  try {
    const { getProxyList } = await import('@/views/api/proxy');
    const result = await getProxyList({ page: 1, limit: 50 } as never);
    savedProxies.value = (result.data ?? []).map((row) => ({
      id: row.id,
      label: `${row.host}:${row.port}`,
    }));
  } catch {
    savedProxies.value = [];
  }
}

/** TODO-MSB-003: Tool Account entry point — start the managed browser for
 * THIS account from its detail page; the AI chat session card takes over. */
async function openManagedBrowser(): Promise<void> {
  if (socialaccountId.value <= 0 || openingManagedBrowser.value) return;
  openingManagedBrowser.value = true;
  try {
    const { startManagedBrowser } = await import('@/views/api/managedBrowser');
    const proxyArg =
      sessionProxyChoice.value === "default"
        ? undefined
        : sessionProxyChoice.value === "direct"
          ? ("direct" as const)
          : { proxy_id: parseInt(sessionProxyChoice.value, 10) };
    await startManagedBrowser({
      accountId: socialaccountId.value,
      purpose: 'account-page',
      ...(proxyArg !== undefined ? { proxy: proxyArg } : {}),
    });
    await router.push('/aiworkspace');
  } catch (error) {
    console.error('[socialaccountdetail] managed browser start failed:', error);
  } finally {
    openingManagedBrowser.value = false;
  }
}
const social_type_id = ref<number>();
// Q-01/B10: per-account AI opt-in state (existing accounts only).
const aiUseEnabled = ref(false);
// N08: the checkbox is inert until the initial read finishes — loading
// and rollback mutate the ref WITHOUT triggering a write (the write is
// an explicit user toggle only).
const aiUseLoaded = ref(false);
const aiUseSaving = ref(false);
const aiUseError = ref<string | null>(null);
// R08/Q-01: a failed INITIAL LOAD keeps the checkbox inert — editing a
// value we could not read would silently write unchecked.
const aiUseLoadError = ref<string | null>(null);
const aiUseLoadRetrying = ref(false);
// N08: the error text type is string | undefined from the i18n fallback.

// R08/Q-01: the opt-in read (initial load AND explicit retry). Success
// unlocks editing with the loaded value; failure keeps the checkbox
// inert and surfaces a retryable error — never "editable unchecked".
async function loadAiUseOptIn(): Promise<void> {
  const id = parseInt($route.params.id?.toString() ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    return;
  }
  aiUseLoadRetrying.value = true;
  try {
    const enabled = await getSocialAccountAiUseEnabled(id);
    aiUseEnabled.value = enabled;
    aiUseLoaded.value = true;
    aiUseLoadError.value = null;
    aiUseError.value = null;
  } catch (error: unknown) {
    aiUseEnabled.value = false;
    aiUseLoaded.value = false;
    aiUseLoadError.value =
      error instanceof Error
        ? error.message
        : t('socialaccount.ai_use_failed') || null;
  } finally {
    aiUseLoadRetrying.value = false;
  }
}

// N08: the ONLY write path is the user's checkbox change (@update:model-
// value) — the async initial load and the failure rollback assign the ref
// directly, so no implicit write fires.
function onAiUseToggled(enabled: boolean | null): void {
  const id = parseInt($route.params.id?.toString() ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    return;
  }
  // Vuetify can emit null while clearing — treated as unchecked.
  const next = enabled === true;
  if (!aiUseLoaded.value || aiUseSaving.value || next === aiUseEnabled.value) {
    return;
  }
  const previous = aiUseEnabled.value;
  aiUseSaving.value = true;
  aiUseError.value = null;
  setSocialAccountAiUseEnabled(id, next)
    .then(() => {
      // A10: the saved value is ASSIGNED after success — a true→false
      // write leaves the ref false (previously the ref stayed true and
      // the next toggle was dropped by the equality guard).
      aiUseEnabled.value = next;
      aiUseError.value = null;
    })
    .catch((error: unknown) => {
      // Rollback assigns the ref directly — no write fires.
      aiUseEnabled.value = previous;
      aiUseError.value =
        error instanceof Error
          ? error.message
          : (t('socialaccount.ai_use_failed') || null);
    })
    .finally(() => {
      aiUseSaving.value = false;
    });
}
const proxyValue = ref<Array<Proxy>>([]);
const proxyValueshow = ref<Array<string>>([]);
const loading = ref(false);
const alert = ref(false);
const alertContent = ref("");
const alertcolor = ref("");
const isEdit = ref(false);
const platformitems = ref<PlatformItem[]>([]);

const proxytableshow = ref(false);
// const selectedProxy = ref<ProxyListEntity>();

const rules = {
  required: (value: unknown) => !!value || "Field is required",
};



const showProxytable = () => {
  proxytableshow.value = !proxytableshow.value;
};

function uploadCookies(): void {
  if (socialaccountId.value <= 0) return;
  requireCookiesselecttab({ id: socialaccountId.value });
}

// ---- Secure session metadata + browser-profile import ----
const importDialog = ref(false);
const sessionStatus = ref<"available" | "missing" | "invalid" | "migration_pending" | null>(null);
const cookieCount = ref(0);
const sessionStatusColor = computed(() => {
  switch (sessionStatus.value) {
    case "available":
      return "success";
    case "missing":
      return "default";
    case "invalid":
      return "error";
    case "migration_pending":
      return "warning";
    default:
      return "default";
  }
});

async function refreshMetadata(): Promise<void> {
  if (socialaccountId.value <= 0) return;
  try {
    const meta = await getSessionMetadata(socialaccountId.value);
    sessionStatus.value = meta.sessionStatus;
    cookieCount.value = meta.cookieCount;
  } catch {
    // Non-fatal: status chip simply stays empty.
  }
}

function setupUploadCookiesListener(): void {
  receiveAccountLoginevent(SOCIAL_ACCOUNT_LOGIN_MESSSAGE, (value: string) => {
    try {
      const json_value = JSON.parse(value) as CommonDialogMsg;
      if (json_value.code !== socialaccountId.value) return;
      if (json_value.data?.action === "handleCookiesfile") {
        alertcolor.value = json_value.status ? "success" : "error";
        alertContent.value = json_value.data.content
          ? t(json_value.data.content)
          : t(json_value.data.title);
        alert.value = true;
      }
    } catch {
      // ignore parse errors for other message types
    }
  });
}

const initialize = async () => {
  if ($route.params.id) {
    socialaccountId.value = parseInt($route.params.id.toString());
  }
  // R10/P-FR-01: the session-proxy choices load with the page.
  void loadSavedProxies();

  if (socialaccountId.value > 0) {
    //edit
    isEdit.value = true;
    FakeAPI.fetch(parseInt(socialaccountId.value.toString())).then(
      async (res) => {
      user.value = res.user;
      pass.value = res.pass ?? "";
      status.value = res.status;
      name.value = res.name;
      phone.value = res.phone;
      email.value = res.email;
      if (res.proxy != null && res.proxy.length > 0) {
        const proxylist: ProxyListEntity[] = [];
        for (let i = 0; i < res.proxy.length; i++) {
          proxyValue.value.push(res.proxy[i]);
          proxylist.push({
            id: res.proxy[i].id,
            host: res.proxy[i].host,
            port: res.proxy[i].port,
            username: res.proxy[i].username,
            password: res.proxy[i].password,
            protocol: res.proxy[i].protocol,
            addtime: "",
          });
        }
        handleSelectedChanged(proxylist);
      }

      // console.log(proxyValue.value)
      social_type_id.value = res.social_type_id;
      // Q-01/B10/N08/R08: load the per-account AI opt-in — the
      // assignment is NOT a write (the handler only fires on user
      // toggles), and the checkbox stays inert until this read finishes.
      // A FAILED read is NOT a confirmed disabled state: the checkbox
      // stays disabled and an explicit retry is offered.
      await loadAiUseOptIn();
    });
  } else {
    //add new item
    isEdit.value = false;
    // if($route.params.campaignId){
    // campaignId.value=parseInt($route.params.campaignId.toString());
    // }
  }
  // N08/S-FR-06: the SITE REGISTRY is the authoritative selector source —
  // custom/registered sites appear alongside the legacy static list.
  try {
    const registrySites = await listBrowserSites();
    const registryItems = registrySites.map((site) => ({
      id: site.id,
      name: site.name,
      displayName: `${site.name} (${site.registrableDomain})`,
      category: "site",
      url: `https://${site.registrableDomain}`,
    }));
    const staticItems = (SocialPlatformList ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      displayName: `${item.name} (${item.category})`,
      category: item.category,
      url: item.url,
    }));
    // Registry entries win; static entries fill gaps (legacy ids).
    const seen = new Set(registryItems.map((item) => item.id));
    platformitems.value = [...registryItems, ...staticItems.filter((item) => !seen.has(item.id))];
  } catch {
    // Registry unavailable — the static list keeps the editor usable.
    if (SocialPlatformList && Array.isArray(SocialPlatformList) && SocialPlatformList.length > 0) {
      platformitems.value = SocialPlatformList.map((item) => ({
        id: item.id,
        name: item.name,
        displayName: `${item.name} (${item.category})`,
        category: item.category,
        url: item.url,
      }));
    } else {
      platformitems.value = [];
    }
  }
};

async function onSubmit() {
  if (!form.value) return;
  const { valid } = await form.value.validate();
  loading.value = true;
  if (!valid) {
    loading.value = false;
    alert.value = true;
    alertcolor.value = "error";
    alertContent.value = t('socialaccount.form_not_valid');
  } else {
    const soacc: SocialAccountDetailData = {
      social_type_id: social_type_id.value,
      user: user.value,
      pass: pass.value,
      status: status.value,
      name: name.value,
      phone: phone.value,
      email: email.value,
      proxy: proxyValue.value,
    };

    if ($route.params.id) {
      soacc.id = parseInt($route.params.id.toString());
    }
    // B15/A-FR-15: the object carries `pass` — never print it to the
    // renderer console (D-13: no secret in logs).
    await saveSocialAccount(soacc)
      .then((res) => {
        loading.value = false;
        if (res.id > 0) {
          alert.value = true;
          alertcolor.value = "success";
          alertContent.value = t('socialaccount.save_success') + " " + res.id;
          soacc.id = res.id;
          $route.params.id = res.id.toString();
          isEdit.value = true;
          socialaccountId.value = res.id;
        } else {
          alert.value = true;
          alertcolor.value = "error";
          alertContent.value = t('socialaccount.save_fail');
        }
        setTimeout(() => {
          alert.value = false;
          if (res.id > 0) {
            router.push({
              path: "/socialaccount/list",
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

onMounted(async () => {
  try {
    await initialize();
    setupUploadCookiesListener();
    void refreshMetadata();
  } catch (error) {
    console.error('Error during initialization:', error);
  }
});
// watch(ProxyTableselected.selected, (newValue, oldValue) => {
//   console.log(`selectedProxy changed from ${oldValue} to ${newValue}`);
//   if (newValue && newValue.id) {

//     selectedProxy.value = ProxyTableselected.selected;

//   }
// });
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
        if (!isexist) {
          proxyValue.value.push({
            id: newValue[i].id,
            host: newValue[i].host,
            port: newValue[i].port,
            username: newValue[i].username,
            password: newValue[i].password,
            protocol: newValue[i].protocol,
          });
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
</script>