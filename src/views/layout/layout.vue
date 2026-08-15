<template>
    <v-layout
class="layout-shell"
:class="{
        isMini: navState.isMini,
        isMobile: mainStore.isMobile,
        chatDockOpen: v2ChatPanelOpen,
    }"
:style="{ '--ai-chat-dock-width': chatPanelWidth + 'px' }">
        <v-navigation-drawer
class="my-4 layout_navigation" :rail="navState.rail" expand-on-hover rail-width="77"
            @update:rail="navigationRail" :permanent="permanent" v-model="navState.menuVisible" style="position: fixed">
            <v-list class="py-4 mx-2 logo" nav>
                <v-list-item :prepend-avatar="logo" class="mx-1" @click="gotodashborad()">
                    <v-list-item-title class="title">{{ appName }}</v-list-item-title>
                    <v-list-item-subtitle>{{ t('layout.platform_subtitle') }}</v-list-item-subtitle>
                </v-list-item>
            </v-list>
            <v-divider></v-divider>

            <v-list nav class="mx-2 navigation_routes">
                <v-list-subheader>{{ t('route.dashboard') }}</v-list-subheader>
                <template v-for="(item, key) in navState.routes" :key="key">
                    <v-list-item
v-if="item.meta?.visible && (!item.children || visibleRouteChildren(item).length === 1)" :prepend-icon="(singleVisibleChild(item)?.meta?.icon || item.meta?.icon as any)"
                        :title="getTranslatedTitle((singleVisibleChild(item)?.meta?.title || item.meta?.title) as string)" :to="{ name: singleVisibleChild(item)?.name || item.name }" class="mx-1"
                        active-class="nav_active"></v-list-item>

                    <v-list-group v-if="item.meta?.visible && item.children && visibleRouteChildren(item).length > 1" class="mx-1">
                        <template v-slot:activator="{ props }">
                            <v-list-item v-bind="props" :prepend-icon="item.meta.icon" :title="getTranslatedTitle(item.meta.title as string)" />
                        </template>
                        <template v-for="(row, i) in visibleRouteChildren(item)" :key="i">
                            <v-list-item
                                :title="getTranslatedTitle(row.meta?.title as string)"
                                :prepend-icon="navState.isMini ? (row.meta?.icon as any) : ''"
                                :to="{ name: row.name }" />
                        </template>
                    </v-list-group>
                    <v-list-subheader v-if="item.name === 'Miscellaneous'">Other</v-list-subheader>
                </template>
                    <v-list-item prepend-icon="mdi-text-box" class="mx-1">
                    <v-list-item-title><a
target="_blank" href="https://docs.aifetchly.com"
                            class="link">Document</a></v-list-item-title>
                </v-list-item>
            </v-list>
            <v-list nav class="mx-2 navigation_account">
                <v-menu :location="location">
                    <template v-slot:activator="{ props }">
                        <v-list-item
                            v-bind="props"
                            class="mx-1 account_item"
                            :title="showAccountText ? accountEmail : undefined"
                        >
                            <template v-slot:prepend>
                                <v-avatar class="account_icon" size="32">
                                    <v-icon icon="mdi-account-circle" size="20" />
                                </v-avatar>
                            </template>
                            <template v-if="showAccountText" v-slot:append>
                                <v-icon icon="mdi-chevron-up" size="small" />
                            </template>
                        </v-list-item>
                    </template>
                    <v-list nav class="h_a_menu">
                        <v-list-item
                            v-if="accountPlanLabel"
                            :title="accountPlanLabel"
                            :prepend-icon="accountPlanIcon"
                            class="plan_menu_item"
                        />
                        <v-list-item
                            v-if="showUpgradePlan"
                            :title="t('layout.upgrade_plan') || 'Upgrade'"
                            prepend-icon="mdi-rocket-launch"
                            class="upgrade_menu_item"
                            @click="openPricingPlan"
                        />
                        <v-list-item :title="t('layout.system_setting')" prepend-icon="mdi-cog" @click="gotoSystemsetting" />
                        <v-list-item :title="t('layout.login_out')" prepend-icon="mdi-login" @click="Usersignout" />
                    </v-list>
                </v-menu>
            </v-list>
        </v-navigation-drawer>
        <main class="app_main">
            <header class="header">
                <Breadcrumbs v-if="!mainStore.isMobile" />
                <div v-if="!mainStore.isMobile" class="mt-3 ml-9 gamepad" @click="changeRail">
                    <v-icon v-if="navState.rail" icon="mdi-sort-variant-lock-open" />
                    <v-icon v-else icon="mdi-sort-variant" />
                </div>
                <div v-if="mainStore.isMobile" class="head_logo ml-4 mr-1">
                    <img :src="logo" height="40" />
                </div>
                <v-btn
v-if="mainStore.isMobile" variant="text" icon="mdi-menu"
                    @click="navState.menuVisible = !navState.menuVisible">
                    <v-icon size="small"></v-icon>
                </v-btn>
                <v-spacer></v-spacer>
                <div v-if="!mainStore.isMobile" style="width: 220px" class="search_ip mr-2">
                </div>
                <div class="tool_btns">
                    <v-btn
@click="mainStore.onTheme" variant="text" :icon="mainStore.theme === 'light' ? 'mdi-weather-sunny' : 'mdi-weather-night'
        " />
                    <v-menu :location="location">
                        <template v-slot:activator="{ props }">
                            <v-btn variant="text" icon="mdi-translate" v-bind="props">
                                <v-icon size="small"></v-icon>
                            </v-btn>
                        </template>
                        <v-list>
                            <v-list-item v-for="(item, index) in languages" :key="index" @click="switchLanguage(item.key)">
                                <v-list-item-title>{{ item.title }}</v-list-item-title>
                            </v-list-item>
                        </v-list>
                    </v-menu>
                    <v-btn variant="text" icon="mdi-chat" @click="toggleChat">
                        <v-icon size="small"></v-icon>
                    </v-btn>
                </div>
                <div style="position: fixed; right: 20px; bottom: 100px; z-index: 99999">
                    <v-btn icon="mdi-cog" />
                </div>
            </header>
            <div class="app_main__body">
                <div class="router">
                    <AiArtifactWorkspace
                        v-if="activeArtifact"
                        :artifact="activeArtifact"
                        :loading="artifactLoading"
                        :error="artifactError ?? undefined"
                        @close="closeAiArtifact"
                        @copy-html="copyActiveArtifactHtml"
                    />
                    <RouterView v-else />
                </div>
                <div
                    class="ai-chat-dock"
                    :class="{ 'dock-open': v2ChatPanelOpen }"
                >
                    <div
                        v-if="v2ChatPanelOpen && !mainStore.isMobile"
                        class="chat-resize-handle"
                        @mousedown="startResize"
                    ></div>
                    <AiChatV2
                        v-show="v2ChatPanelOpen"
                        :prompt-request="pendingAiPromptRequest"
                        :open-conversation-request="pendingOpenConversationRequest"
                        @open-artifact="openAiArtifact"
                        @copy-artifact-html="copyArtifactHtml"
                    />
                </div>
            </div>
        </main>

          <!-- Multiple Messages Display -->
          <div class="messages-container">
            <div
              v-for="msg in messages"
              :key="msg.id"
              class="message-item"
              :class="msg.type"
            >
              <div class="message-content">
                <v-icon :icon="getMessageIcon(msg.type)" class="me-2" />
                <span>{{ msg.message }}</span>
                <v-btn
                  variant="text"
                  icon="mdi-close"
                  size="small"
                  @click="removeMessage(msg.id)"
                  class="ms-2"
                ></v-btn>
              </div>
            </div>
          </div>

          <NoticeSnackbar
          v-model="showNotice"
          :message="noticeMessage"
          :type="noticeType"
          :timeout="snaptimeout"
        />

        <!-- AI Chat Panel -->
        <div
          class="ai-chat-panel"
          :class="{ 'panel-open': chatPanelOpen }"
          :style="chatPanelOpen ? { width: chatPanelWidth + 'px' } : {}"
        >
          <!-- Resize handle -->
          <div
            v-if="chatPanelOpen"
            class="chat-resize-handle"
            @mousedown="startResize"
          ></div>
          <AiChatBox
            :visible="chatPanelOpen"
            @close="toggleChatPanel"
          />
        </div>

        <!-- Backdrop overlay -->
        <div
          v-if="chatPanelOpen"
          class="chat-backdrop"
          @click="toggleChatPanel"
        ></div>
    </v-layout>
</template>
<script setup lang="ts">
import logo from '@/assets/images/icon.png';
import { RouterView, type RouteRecordRaw, useRouter } from 'vue-router';
import Breadcrumbs from '@/views/components/breadcrumbs/breadcrumbs.vue';
import { reactive, computed, watch } from 'vue';
import { useMainStore } from '@/views/store/appMain';
import { Signout } from '@/views/api/users'
import {setLanguage} from '@/views/utils/cookies'
import {useI18n} from "vue-i18n";
import { ref, onMounted, onUnmounted } from 'vue'
import {receiveSystemMessage} from '@/views/api/layout'
import {CommonDialogMsg} from "@/entityTypes/commonType"
import NoticeSnackbar from '@/views/components/widgets/noticeSnackbar.vue';
import AiChatBox from '@/views/components/aiChat/AiChatBox.vue';
import AiChatV2 from '@/views/components/aiChatV2/AiChatV2.vue';
import AiArtifactWorkspace from '@/views/components/aiArtifacts/AiArtifactWorkspace.vue';
import { getAIArtifact } from '@/views/api/aiArtifacts';
import type { AIArtifactRecord } from '@/entityTypes/aiArtifactTypes';
import {GetloginUserInfo} from '@/views/api/users'
import type { UserPlanType } from '@/entityTypes/userType'
import { getAppName } from '@/views/api/app'
import { packageAppName } from '@/config/appPackage'
import { getLanguagePreference } from '@/views/api/language'
import { initializeLanguageDetection } from '@/views/utils/browserLanguageDetection'
import { initializeLanguageSynchronization, syncLanguageChange } from '@/views/utils/languageSynchronization'
import { getIpcTransport } from '@/views/utils/ipcTransport'
import { AI_CHAT_V2_OPEN_FROM_NOTIFY } from '@/config/channellist'


// import {ref, watchEffect} from "vue";
type NoticeType = 'success' | 'error' | 'warning' | 'info';

interface MessageItem {
  id: string;
  message: string;
  type: NoticeType;
  timestamp: number;
}

interface AiChatOpenEventDetail {
  prompt?: string;
}

interface AiPromptRequest {
  id: number;
  text: string;
}

interface AiOpenConversationRequest {
  id: number;
  conversationId: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const dialogStatus=ref(false)
const noticeMessage=ref('')
const noticeType=ref<NoticeType>('info')
const userName=ref('')
const userEmail=ref('')
const userPlan=ref('')
const currentPlans=ref<Array<UserPlanType>>([])
const isPlusPlan=ref(false)
const appName=ref(packageAppName)
const snaptimeout=ref<number>(10000)
const messages = ref<MessageItem[]>([]);
const chatPanelOpen = ref(false);
const v2ChatPanelOpen = ref(false);
// AI artifact workspace — layout-owned temporary preview state. When set,
// it replaces the route view; closing restores the prior route.
const activeArtifact = ref<AIArtifactRecord | null>(null);
const artifactLoading = ref(false);
const artifactError = ref<string | null>(null);
const V2_FLAG_KEY = 'aifetchly:aiChatV2Enabled';
const aiChatV2Enabled = ref(localStorage.getItem(V2_FLAG_KEY) !== 'false');
const chatPanelWidth = ref(720);
const pendingAiPromptRequest = ref<AiPromptRequest | null>(null);
let aiPromptRequestId = 0;
const pendingOpenConversationRequest = ref<AiOpenConversationRequest | null>(null);
let openConversationRequestId = 0;
const CHAT_PANEL_MIN_WIDTH = 400;
const CHAT_PANEL_MAX_WIDTH = 1200;
const mainStore = useMainStore();
const router = useRouter();
const navState = reactive({
    menuVisible: true,
    rail: !mainStore.isMobile,
    isMini: !mainStore.isMobile,
    routes: router.options.routes,
});
const visibleRouteChildren = (route: RouteRecordRaw): RouteRecordRaw[] => {
    return (route.children ?? []).filter((row) => Boolean(row.meta?.visible));
};
const singleVisibleChild = (route: RouteRecordRaw): RouteRecordRaw | undefined => {
    const children = visibleRouteChildren(route);
    return children.length === 1 ? children[0] : undefined;
};
const permanent = computed(() => {
    return !mainStore.isMobile;
});
const showAccountText = computed(() => {
    return !navState.isMini || mainStore.isMobile;
});
const accountEmail = computed(() => {
    return userEmail.value || userName.value;
});
const accountPlanLabel = computed(() => {
    return userPlan.value;
});
const accountPlanIcon = computed(() => {
    if (isPlusPlan.value) {
        return 'mdi-plus-circle';
    }
    if (userPlan.value) {
        return 'mdi-star-circle';
    }
    return 'mdi-account-circle';
});
const showUpgradePlan = computed(() => {
    return currentPlans.value.length > 0 && currentPlans.value.every(isFreeSubscriptionPlan);
});
const pricingPlanUrl = computed(() => {
    const baseUrl = normalizeLoginBaseUrl(import.meta.env.VITE_LOGIN_URL);
    return baseUrl ? `${baseUrl}/pricing-plan` : '';
});
const normalizePlanName = (planName: string): string => {
    return planName.toLowerCase().replace(/[^a-z0-9]/g, '');
};
const normalizeLoginBaseUrl = (raw: unknown): string => {
    if (typeof raw !== 'string') return '';
    return raw.trim().replace(/^["']|["']$/g, '').replace(/\/+$/g, '');
};
const getDisplayPlans = (plans: Array<UserPlanType>): Array<UserPlanType> => {
    const namedPlans = plans.filter(plan => Boolean(plan.planName?.trim()));
    const activePlans = namedPlans.filter(plan => plan.status?.toLowerCase() === 'active');
    return activePlans.length > 0 ? activePlans : namedPlans;
};
const isPlusSubscriptionPlan = (plan: UserPlanType): boolean => {
    const planName = normalizePlanName(plan.planName || '');
    const planId = (plan.planId || '').toUpperCase();
    return planName.includes('aifetchplus') || planId === 'PLUS';
};
const isFreeSubscriptionPlan = (plan: UserPlanType): boolean => {
    const planName = normalizePlanName(plan.planName || '');
    const planId = (plan.planId || '').toUpperCase();
    return planName.includes('community') || planName.includes('free') || planId === 'FREE';
};
const showNotice = ref(false);
const {t,locale} = useI18n();
const location="end"
type languageType = {
    title: string,
    key: string
}

const languages: Array<languageType> = [
    { title: "English", key: "en" },
    { title: "中文", key: "zh" },
    { title: "Español", key: "es" },
    { title: "Français", key: "fr" },
    { title: "Deutsch", key: "de" },
    { title: "日本語", key: "ja" },
]

const switchLanguage = async (lang: string) => {
    console.log('Switching language to:', lang)

    try {
        locale.value = lang
        await syncLanguageChange(lang)
        showSuccessMessage(t('layout.language_updated_successfully') || 'Language updated successfully')
    } catch (error) {
        console.error('Error switching language:', error)
        showErrorMessage(t('layout.language_switch_error') || 'Error switching language')
    }
}

const gotoSystemsetting=()=>{
    router.push('/systemsetting/index')
}
const gotodashborad=()=>{
    router.push('/dashboard/home')
}
const openPricingPlan = (): void => {
    if (!pricingPlanUrl.value) {
        showErrorMessage(t('layout.pricing_url_missing') || 'Pricing page URL is not configured')
        return
    }
    window.open(pricingPlanUrl.value, '_blank')
}

watch(permanent, () => {
    navState.menuVisible = true;
    changeRail();
});
const navigationRail = (e: boolean) => {
    if (!navState.rail) return;
    navState.isMini = e;
};


const changeRail = () => {
    navState.rail = !navState.rail;
    navState.isMini = navState.rail;
};
const Usersignout = async () => {
    console.log("signout")
    await Signout()
    router.push('/login')
}

const getTranslatedTitle = (title: string): string => {
    if (title && title.startsWith('route.')) {
        return t(title);
    }
    return title;
}

const toggleChatPanel = () => {
    chatPanelOpen.value = !chatPanelOpen.value;
    if (chatPanelOpen.value) {
        v2ChatPanelOpen.value = false;
    }
}

const toggleV2ChatPanel = () => {
    v2ChatPanelOpen.value = !v2ChatPanelOpen.value;
    if (v2ChatPanelOpen.value) {
        chatPanelOpen.value = false;
    }
}

/** Unified chat toggle: opens V2 when the feature flag is on, legacy chat otherwise. */
const toggleChat = () => {
    if (aiChatV2Enabled.value) {
        toggleV2ChatPanel();
    } else {
        toggleChatPanel();
    }
};

const openAiChatFromDashboard = (event: Event): void => {
    const detail = (event as CustomEvent<AiChatOpenEventDetail>).detail;
    const text = detail?.prompt?.trim();
    if (!text) return;

    if (aiChatV2Enabled.value) {
        pendingAiPromptRequest.value = {
            id: ++aiPromptRequestId,
            text,
        };
        v2ChatPanelOpen.value = true;
        chatPanelOpen.value = false;
        return;
    }

    chatPanelOpen.value = true;
    v2ChatPanelOpen.value = false;
}

const handleOpenFromNotify = (raw: unknown): void => {
    const payload =
        raw && typeof raw === "object"
            ? (raw as { conversationId?: string | null })
            : null;
    const conversationId =
        typeof payload?.conversationId === "string"
            ? payload.conversationId.trim()
            : "";

    if (aiChatV2Enabled.value) {
        v2ChatPanelOpen.value = true;
        chatPanelOpen.value = false;
        if (conversationId.length > 0) {
            pendingOpenConversationRequest.value = {
                id: ++openConversationRequestId,
                conversationId,
            };
        }
        return;
    }

    chatPanelOpen.value = true;
    v2ChatPanelOpen.value = false;
};

const startResize = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = chatPanelWidth.value;

    const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        const newWidth = Math.min(
            CHAT_PANEL_MAX_WIDTH,
            Math.max(CHAT_PANEL_MIN_WIDTH, startWidth + delta)
        );
        chatPanelWidth.value = newWidth;
    };

    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
};

const handleKeyboardShortcut = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleChat();
    }
}

const getMessageIcon = (type: NoticeType): string => {
    const icons = {
        success: 'mdi-check-circle',
        error: 'mdi-alert-circle',
        warning: 'mdi-alert',
        info: 'mdi-information'
    };
    return icons[type];
};

const removeMessage = (id: string) => {
    const index = messages.value.findIndex(msg => msg.id === id);
    if (index > -1) {
        messages.value.splice(index, 1);
    }
};

const addMessage = (type: NoticeType, content: string) => {
    const message: MessageItem = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        message: content,
        type: type,
        timestamp: Date.now()
    };
    messages.value.push(message);

    setTimeout(() => {
        removeMessage(message.id);
    }, snaptimeout.value);
};

const showSuccessMessage = (content: string) => addMessage('success', content);
const showErrorMessage = (content: string) => addMessage('error', content);

// --- AI artifact workspace ----------------------------------------------
const openAiArtifact = async (artifactId: string): Promise<void> => {
  artifactLoading.value = true;
  artifactError.value = null;
  try {
    const artifact = await getAIArtifact(artifactId);
    if (!artifact) {
      artifactError.value = t('aiArtifacts.not_found') || 'Artifact not found.';
      showErrorMessage(artifactError.value);
      return;
    }
    activeArtifact.value = artifact;
  } catch (error: unknown) {
    artifactError.value = error instanceof Error ? error.message : String(error);
    showErrorMessage(artifactError.value);
  } finally {
    artifactLoading.value = false;
  }
};

const closeAiArtifact = (): void => {
  activeArtifact.value = null;
  artifactError.value = null;
};

const copyArtifactHtml = async (artifactId: string): Promise<void> => {
  try {
    const artifact = await getAIArtifact(artifactId);
    if (!artifact) {
      showErrorMessage(t('aiArtifacts.not_found') || 'Artifact not found.');
      return;
    }
    await navigator.clipboard.writeText(artifact.content);
    showSuccessMessage(t('aiArtifacts.copy_success') || 'HTML copied.');
  } catch {
    showErrorMessage(t('aiArtifacts.copy_error') || 'Could not copy HTML.');
  }
};

const copyActiveArtifactHtml = (): void => {
  if (activeArtifact.value) {
    void copyArtifactHtml(activeArtifact.value.id);
  }
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const showWarningMessage = (content: string) => addMessage('warning', content);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const showInfoMessage = (content: string) => addMessage('info', content);

const initializeSavedLanguage = async (): Promise<void> => {
    try {
        const systemLanguage = await getLanguagePreference()
        if (systemLanguage) {
            console.log('Loading language preference from system settings:', systemLanguage)
            locale.value = systemLanguage
            setLanguage(systemLanguage)
        }
    } catch (error) {
        console.warn('Failed to load language preference from system settings, using current locale:', error)
    }
}

onMounted(async () => {
    await initializeSavedLanguage()

    initializeLanguageDetection(async (selectedLanguage): Promise<void> => {
        console.log('User selected language:', selectedLanguage)
        await switchLanguage(selectedLanguage)
    })

    await initializeLanguageSynchronization()

    try {
        const res = await GetloginUserInfo()
        console.log(res)
        userName.value = res.name
        userEmail.value = res.email
        if (res.plans && res.plans.length > 0) {
            const displayPlans = getDisplayPlans(res.plans)
            currentPlans.value = displayPlans
            isPlusPlan.value = displayPlans.some(isPlusSubscriptionPlan)
            userPlan.value = displayPlans.map(plan => plan.planName).join(', ')
        }
    } catch (error) {
        console.error('Failed to load login user info:', error)
    }

    try {
        const name = await getAppName()
        appName.value = name
    } catch (error) {
        console.error('Failed to load app name:', error)
    }

    window.addEventListener('keydown', handleKeyboardShortcut)
    window.addEventListener('aifetchly:open-ai-chat', openAiChatFromDashboard)
    getIpcTransport().receive(
        AI_CHAT_V2_OPEN_FROM_NOTIFY,
        handleOpenFromNotify as (value: unknown) => void
    )

    receiveSystemMessage((res:CommonDialogMsg)=>{
       console.log(res)
        if(res.data){
            console.log(t(res.data.title))
        showDialog(res.status, t(res.data.title)+": "+t(res.data.content))
        }
    })
}
)

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyboardShortcut)
    window.removeEventListener('aifetchly:open-ai-chat', openAiChatFromDashboard)
    getIpcTransport().removeListener(
        AI_CHAT_V2_OPEN_FROM_NOTIFY,
        handleOpenFromNotify as (value: unknown) => void
    )
})

const showDialog=(status:boolean, content:string)=>{
    const messageType: NoticeType = status ? 'success' : 'error';
    addMessage(messageType, content);

    showNotice.value=true
    if(status){
        noticeType.value='success'
    }else{
        noticeType.value='error'
    }
    noticeMessage.value=content
}
</script>
<style scoped lang="scss">
.layout-shell {
    display: flex;
    align-items: stretch;
    width: 100%;
    min-height: 100vh;
    overflow-x: hidden;
}

:deep(.app_main) {
    min-width: 0;
}

.app_main__body {
    display: flex;
    flex: 1;
    min-height: calc(100vh - 92px);
    align-items: stretch;
}

.messages-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 400px;
    pointer-events: none;
}

.message-item {
    pointer-events: auto;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideInRight 0.3s ease-out;
    transition: all 0.3s ease;

    &.success {
        background-color: #4caf50;
        color: white;
    }

    &.error {
        background-color: #f44336;
        color: white;
    }

    &.warning {
        background-color: #ff9800;
        color: white;
    }

    &.info {
        background-color: #2196f3;
        color: white;
    }
}

.message-content {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    font-size: 14px;
    line-height: 1.4;
}

@keyframes slideInRight {
    from {
        transform: translateX(100%);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}

.message-item:hover {
    transform: translateX(-4px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

/* AI Chat Panel Styles */
.ai-chat-panel {
    position: fixed;
    top: 0;
    right: -420px;
    width: 420px;
    height: 100vh;
    background-color: #ffffff;
    box-shadow: -2px 0 16px rgba(0, 0, 0, 0.1);
    transition: right 0.3s ease-in-out;
    z-index: 9998;
}

.ai-chat-panel.panel-open {
    right: 0;
}

.ai-chat-dock {
    position: relative;
    align-self: stretch;
    flex: 0 0 0;
    width: 0;
    height: auto;
    max-height: calc(100vh - 92px);
    min-height: 0;
    padding-top: 32px;
    box-sizing: border-box;
    overflow: hidden;
    background-color: #ffffff;
    border-left: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: -2px 0 16px rgba(0, 0, 0, 0.08);
    transition: flex-basis 0.3s ease-in-out, width 0.3s ease-in-out;
}

.ai-chat-dock.dock-open {
    flex-basis: var(--ai-chat-dock-width);
    width: var(--ai-chat-dock-width);
}

.chat-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.3);
    z-index: 9997;
    animation: fadeIn 0.3s ease-in-out;
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}



@media (max-width: 768px) {
    .ai-chat-panel {
        width: 100%;
        right: -100%;
    }

    .ai-chat-panel.panel-open {
        right: 0;
    }

    .ai-chat-dock {
        position: fixed;
        top: 0;
        align-self: auto;
        right: -100%;
        width: 100%;
        height: 100vh;
        min-height: 0;
        padding-top: 0;
        flex-basis: auto;
        transition: right 0.3s ease-in-out;
        z-index: 9998;
    }

    .ai-chat-dock.dock-open {
        right: 0;
        width: 100%;
    }
}

.chat-resize-handle {
    position: absolute;
    top: 0;
    left: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 9999;
    background: transparent;
    transition: background-color 0.2s;
}

.chat-resize-handle:hover {
    background-color: rgba(var(--v-theme-primary), 0.3);
}
</style>

<style>
:root[theme="dark"] .ai-chat-panel {
    background-color: #1e1e1e;
    box-shadow: -2px 0 16px rgba(0, 0, 0, 0.5);
}

:root[theme="dark"] .ai-chat-dock {
    background-color: #1e1e1e;
    border-left-color: rgba(255, 255, 255, 0.12);
    box-shadow: -2px 0 16px rgba(0, 0, 0, 0.5);
}
</style>
