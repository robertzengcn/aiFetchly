<template>
    <v-layout :class="{
        isMini: navState.isMini,
        isMobile: mainStore.isMobile,
    }">
        <v-navigation-drawer class="my-4 layout_navigation" :rail="navState.rail" expand-on-hover rail-width="77"
            @update:rail="navigationRail" :permanent="permanent" v-model="navState.menuVisible" style="position: fixed">
            <v-list class="py-4 mx-2 logo" nav>
                <v-list-item :prepend-avatar="logo" class="mx-1" @click="gotodashborad()">
                    <v-list-item-title class="title">{{ appName }}</v-list-item-title>
                    <v-list-item-subtitle>{{ t('layout.platform_subtitle') }}</v-list-item-subtitle>
                </v-list-item>
            </v-list>
            <v-divider></v-divider>

            <v-list nav class="mx-2">
                <v-list-subheader>{{ t('route.dashboard') }}</v-list-subheader>
                <template v-for="(item, key) in navState.routes" :key="key">
                    <v-list-item v-if="item.meta?.visible && !item.children" :prepend-icon="(item.meta?.icon as any)"
                        :title="getTranslatedTitle(item.meta?.title as string)" :to="{ name: item.name }" class="mx-1"
                        active-class="nav_active"></v-list-item>

                    <v-list-group v-if="item.meta?.visible && item.children && item.children.length > 0" class="mx-1">
                        <template v-slot:activator="{ props }">
                            <v-list-item v-bind="props" :prepend-icon="item.meta.icon" :title="getTranslatedTitle(item.meta.title as string)" />
                        </template>
                        <template v-for="(row, i) in item.children">
                            <v-list-item v-if="(row.meta?.visible as any)" :title="getTranslatedTitle(row.meta?.title as string)"
                                :prepend-icon="navState.isMini ? (row.meta?.icon as any) : ''" :key="i"
                                :to="{ name: row.name }" />
                        </template>
                    </v-list-group>
                    <!-- <v-list-subheader v-if="item.name === 'Dashboard'">Examples</v-list-subheader> -->
                    <v-list-subheader v-if="item.name === 'Miscellaneous'">Other</v-list-subheader>
                </template>
                <v-list-item prepend-icon="mdi-text-box" class="mx-1">
                    <v-list-item-title><a target="_blank" href="https://vuetifyjs.com/"
                            class="link">Document</a></v-list-item-title>
                </v-list-item>
                <!-- <v-list-item prepend-icon="mdi-github" class="mx-1">
                    <v-list-item-title
                        ><a
                            target="_blank"
                            href="https://github.com/armomu/vue-material-admin"
                            class="link"
                            >Github</a
                        ></v-list-item-title
                    >
                </v-list-item> -->
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
                <v-btn v-if="mainStore.isMobile" variant="text" icon="mdi-menu"
                    @click="navState.menuVisible = !navState.menuVisible">
                    <v-icon size="small"></v-icon>
                </v-btn>
                <v-spacer></v-spacer>
                <div v-if="!mainStore.isMobile" style="width: 220px" class="search_ip mr-2">
                    <!-- <div id="docsearch"></div> -->
                    <!-- <v-text-field rounded density="compact" variant="outlined" label="Search here"
                        prepend-inner-icon="mdi-magnify" single-line hide-details clearable></v-text-field> -->
                </div>
                <div class="tool_btns">
                    <v-btn @click="mainStore.onTheme" variant="text" :icon="mainStore.theme === 'light' ? 'mdi-weather-sunny' : 'mdi-weather-night'
        " />
                    <v-btn variant="text" icon="mdi-bell-outline">
                        <v-badge content="2" color="error">
                            <v-icon size="small"></v-icon>
                        </v-badge>
                    </v-btn>
                    <v-btn variant="text" icon="mdi-chat" @click="toggleChatPanel">
                        <v-icon size="small"></v-icon>
                    </v-btn>
                    <v-btn variant="text" append-icon="mdi-chevron-down" class="mr-2">
                        <!-- <v-avatar size="x-small" class="avatar mr-2">
                            <v-img :src="wxtx" alt="{{userName}}"></v-img>
                        </v-avatar> -->
                        <span v-if="!mainStore.isMobile">{{userName}}</span>
                        <v-menu activator="parent">
                            <v-list nav class="h_a_menu">
                                <v-menu :location="location">
                                    <template v-slot:activator="{ props }">
                                        <v-list-item title="Language" prepend-icon="mdi-translate" v-bind="props" />
                                    </template>
                                        <v-list>
                                            <v-list-item v-for="(item, index) in languages" :key="index">
                                                <v-list-item-title @click="switchLanguage(item.key)">{{ item.title }}</v-list-item-title>

                                            </v-list-item>
                                        </v-list>
                                    
                                </v-menu>
                                <v-list-item :title="t('layout.system_setting')" prepend-icon="mdi-cog" @click="gotoSystemsetting" />
                                <v-list-item :title="t('layout.login_out')" prepend-icon="mdi-login" @click="Usersignout" />
                            </v-list>
                        </v-menu>
                    </v-btn>
                </div>
                <div style="position: fixed; right: 20px; bottom: 100px; z-index: 99999">
                    <v-btn icon="mdi-cog" />
                </div>
            </header>
            <div class="router">
                <RouterView />
            </div>
        </main>
        <!-- <v-dialog absolute right persistent width="300" class="dialog-bottom-right">
            <v-card>
              <v-card-title class="headline">{{ dialogTitle }}</v-card-title>
              <v-card-text>
               {{ dialogContent }}
              </v-card-text>
            </v-card>
          </v-dialog> -->
          
          <!-- Multiple Messages Display -->
          <div class="messages-container">
            <div
              v-for="(msg, index) in messages"
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
          
          <!-- Legacy single message snackbar (can be removed later) -->
          <NoticeSnackbar
          v-model="showNotice"
          :message="noticeMessage"
          :type="noticeType"
          :timeout="snaptimeout"
        />

        <!-- AI Chat Panel -->
        <div class="ai-chat-panel" :class="{ 'panel-open': chatPanelOpen }">
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
import wxtx from '@/assets/wx.png';
import { RouterView, useRouter } from 'vue-router';
import Breadcrumbs from '@/views/components/breadcrumbs/breadcrumbs.vue';
import { reactive, computed, watch } from 'vue';
import { useMainStore } from '@/views/store/appMain';
import { Signout } from '@/views/api/users'
import {setLanguage} from '@/views/utils/cookies'
import {useI18n} from "vue-i18n";
import { ref,onMounted,onUnmounted } from 'vue'
import {receiveSystemMessage} from '@/views/api/layout'
import {CommonDialogMsg} from "@/entityTypes/commonType"
import NoticeSnackbar from '@/views/components/widgets/noticeSnackbar.vue';
import AiChatBox from '@/views/components/aiChat/AiChatBox.vue';
import {GetloginUserInfo} from '@/views/api/users'
import { getAppName } from '@/views/api/app'
import { updateLanguagePreference, getLanguagePreference } from '@/views/api/language'
import { initializeLanguageDetection } from '@/views/utils/browserLanguageDetection'
import { initializeLanguageMigration } from '@/views/utils/languageMigration'
import { initializeLanguageSynchronization } from '@/views/utils/languageSynchronization'


// import {ref, watchEffect} from "vue";
type NoticeType = 'success' | 'error' | 'warning' | 'info';

interface MessageItem {
  id: string;
  message: string;
  type: NoticeType;
  timestamp: number;
}

const dialogStatus=ref(false)
const noticeMessage=ref('')
const noticeType=ref<NoticeType>('info')
const userName=ref('')
const appName=ref('Social Marketing')
const snaptimeout=ref<number>(10000)
const messages = ref<MessageItem[]>([]);
// const dialogTitle=ref('')
// const dialogContent=ref('')
const mainStore = useMainStore();
const router = useRouter();
const navState = reactive({
    menuVisible: true,
    rail: !mainStore.isMobile,
    isMini: !mainStore.isMobile,
    routes: router.options.routes,
});
const permanent = computed(() => {
    return !mainStore.isMobile;
});
const showNotice = ref(false);
const showCloudflareNotification = ref(false);
const currentCloudflareNotification = ref<CommonDialogMsg | null>(null);
const chatPanelOpen = ref(false);
const {t,locale} = useI18n();
const location="end"
type languageType = {
    title: string,
    key: string
}

const languages: Array<languageType> = [
    { title: "English",key:"en" },
    { title: "中文",key:"zh"},
]
// const currentLanguage = languages.find((x) => x.key === locale.value)?.key ?? "en";
// const selectedOption = ref(currentLanguage);
// watchEffect(() => {
//  locale.value = languages.find((x) => x.key === selectedOption.value)!.key;
// })
const switchLanguage = async (lang: string) => {
    console.log('Switching language to:', lang)
    
    try {
        // Update UI immediately for better user experience
        locale.value = lang
        setLanguage(lang)
        
        // Persist to system settings in the background
        const success = await updateLanguagePreference(lang)
        
        if (success) {
            showSuccessMessage(t('layout.language_updated_successfully') || 'Language updated successfully')
        } else {
            showWarningMessage(t('layout.language_update_failed') || 'Language update failed, but UI has been updated')
        }
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
}

// Keyboard shortcut for toggling chat (Ctrl/Cmd + K)
const handleKeyboardShortcut = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleChatPanel();
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
    
    // Auto-remove message after timeout
    setTimeout(() => {
        removeMessage(message.id);
    }, snaptimeout.value);
};

// Helper functions for different message types
// Usage: Call these functions from anywhere in the component to show messages
// Multiple messages will be displayed vertically without covering each other
const showSuccessMessage = (content: string) => addMessage('success', content);
const showErrorMessage = (content: string) => addMessage('error', content);
const showWarningMessage = (content: string) => addMessage('warning', content);
const showInfoMessage = (content: string) => addMessage('info', content);
onMounted(async () => {
    await GetloginUserInfo().then(res=>{
        console.log(res)
        userName.value=res.name
    })
    
    // Load app name from backend
    try {
        const name = await getAppName()
        appName.value = name
    } catch (error) {
        console.error('Failed to load app name:', error)
        // Keep default value if loading fails
    }
    
    // Initialize language migration first
    await initializeLanguageMigration()
    
    // Load language preference from system settings
    try {
        const systemLanguage = await getLanguagePreference()
        if (systemLanguage && systemLanguage !== locale.value) {
            console.log('Loading language preference from system settings:', systemLanguage)
            locale.value = systemLanguage
            setLanguage(systemLanguage)
        }
    } catch (error) {
        console.warn('Failed to load language preference from system settings, using current locale:', error)
        // Keep current locale if loading fails
    }
    
    // Initialize browser language detection for new users
    initializeLanguageDetection(async (selectedLanguage) => {
        console.log('User selected language:', selectedLanguage)
        await switchLanguage(selectedLanguage)
    })
    
    // Initialize language synchronization
    initializeLanguageSynchronization()
    
    // Add keyboard shortcut listener
    window.addEventListener('keydown', handleKeyboardShortcut)
    
    receiveSystemMessage((res:CommonDialogMsg)=>{
       console.log(res)
        //revice system message
        if(res.data){
            console.log(t(res.data.title))
        showDialog(res.status, t(res.data.title)+": "+t(res.data.content))
        }
    })
}
)

onUnmounted(() => {
    // Clean up keyboard shortcut listener
    window.removeEventListener('keydown', handleKeyboardShortcut)
})
const showDialog=(status:boolean, content:string)=>{
    // Use the new message system for multiple messages
    const messageType: NoticeType = status ? 'success' : 'error';
    addMessage(messageType, content);
    
    // Keep the legacy single message system for backward compatibility
    showNotice.value=true
    if(status){
        noticeType.value='success'
    }else{
        noticeType.value='error'
    }
    noticeMessage.value=content

//   setTimeout(() => {
//     dialogStatus.value= false
//         }, 10000)
}
</script>
<style scoped lang="scss">
.dialog-bottom-right {
    bottom: 0;
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
    width: 400px;
    height: 100vh;
    background-color: #ffffff;
    box-shadow: -2px 0 16px rgba(0, 0, 0, 0.1);
    transition: right 0.3s ease-in-out;
    z-index: 9998;
}

.ai-chat-panel.panel-open {
    right: 0;
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

/* Dark theme support for chat panel */
:deep(.v-theme--dark) {
    .ai-chat-panel {
        background-color: #1e1e1e;
        box-shadow: -2px 0 16px rgba(0, 0, 0, 0.5);
    }
}

/* Mobile responsiveness for chat panel */
@media (max-width: 768px) {
    .ai-chat-panel {
        width: 100%;
        right: -100%;
    }

    .ai-chat-panel.panel-open {
        right: 0;
    }
}
</style>
