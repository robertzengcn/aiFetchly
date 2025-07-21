<template>
    <v-layout :class="{
        isMini: navState.isMini,
        isMobile: mainStore.isMobile,
    }">
        <v-navigation-drawer class="my-4 layout_navigation" :rail="navState.rail" expand-on-hover rail-width="77"
            @update:rail="navigationRail" :permanent="permanent" v-model="navState.menuVisible" style="position: fixed">
            <v-list class="py-4 mx-2 logo" nav>
                <v-list-item :prepend-avatar="logo" class="mx-1" @click="gotodashborad()">
                    <v-list-item-title class="title">Material UI</v-list-item-title>
                    <v-list-item-subtitle>vue-material-admin</v-list-item-subtitle>
                </v-list-item>
            </v-list>
            <v-divider></v-divider>

            <v-list nav class="mx-2">
                <v-list-subheader>Dashboard</v-list-subheader>
                <template v-for="(item, key) in navState.routes" :key="key">
                    <v-list-item v-if="item.meta?.visible && !item.children" :prepend-icon="(item.meta?.icon as any)"
                        :title="(item.meta?.title as any)" :to="{ name: item.name }" class="mx-1"
                        active-class="nav_active"></v-list-item>

                    <v-list-group v-if="item.meta?.visible && item.children && item.children.length > 0" class="mx-1">
                        <template v-slot:activator="{ props }">
                            <v-list-item v-bind="props" :prepend-icon="item.meta.icon" :title="item.meta.title as string" />
                        </template>
                        <template v-for="(row, i) in item.children">
                            <v-list-item v-if="(row.meta?.visible as any)" :title="(row.meta?.title as any)"
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
                    <v-text-field rounded density="compact" variant="outlined" label="Search here"
                        prepend-inner-icon="mdi-magnify" single-line hide-details clearable></v-text-field>
                </div>
                <div class="tool_btns">
                    <v-btn @click="mainStore.onTheme" variant="text" :icon="mainStore.theme === 'light' ? 'mdi-weather-sunny' : 'mdi-weather-night'
        " />
                    <v-btn variant="text" icon="mdi-bell-outline">
                        <v-badge content="2" color="error">
                            <v-icon size="small"></v-icon>
                        </v-badge>
                    </v-btn>
                    <v-btn variant="text" append-icon="mdi-chevron-down" class="mr-2">
                        <v-avatar size="x-small" class="avatar mr-2">
                            <v-img :src="wxtx" alt="{{userName}}"></v-img>
                        </v-avatar>
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
          <NoticeSnackbar
          v-model="showNotice"
          :message="noticeMessage"
          :type="noticeType"
          :timeout="snaptimeout"
        />
    </v-layout>
   
</template>
<script setup lang="ts">
import logo from '@/assets/admin-logo.png';
import wxtx from '@/assets/wx.png';
import { RouterView, useRouter } from 'vue-router';
import Breadcrumbs from '@/views/components/breadcrumbs/breadcrumbs.vue';
import { reactive, computed, watch } from 'vue';
import { useMainStore } from '@/views/store/appMain';
import { Signout } from '@/views/api/users'
import {setLanguage} from '@/views/utils/cookies'
import {useI18n} from "vue-i18n";
import { ref,onMounted } from 'vue'
import {receiveSystemMessage} from '@/views/api/layout'
import {CommonDialogMsg} from "@/entityTypes/commonType"
import NoticeSnackbar from '@/views/components/widgets/noticeSnackbar.vue';
import {GetloginUserInfo} from '@/views/api/users'


// import {ref, watchEffect} from "vue";
type NoticeType = 'success' | 'error' | 'warning' | 'info';
const dialogStatus=ref(false)
const noticeMessage=ref('')
const noticeType=ref<NoticeType>('info')
const userName=ref('')
const snaptimeout=ref<number>(10000)
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
const switchLanguage = (lang: string) => {
    console.log(lang)
    // i18n.locale = lang
    locale.value=lang
    setLanguage(lang)
    // router.go(0)
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
onMounted(async () => {
    await GetloginUserInfo().then(res=>{
        console.log(res)
        userName.value=res.name
    })
    receiveSystemMessage((res:CommonDialogMsg)=>{
       
        //revice system message
        if(res.data){
            console.log(t(res.data.title))
        showDialog(res.status, t(res.data.title)+": "+t(res.data.content))
        }
    })
}
)
const showDialog=(status:boolean, content:string)=>{
    // dialogTitle.value=title  
    // dialogContent.value=content
    // dialogStatus.value=status;
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
</style>
