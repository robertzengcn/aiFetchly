<template>
    <div class="search_bar mt-4 mb-4 d-flex jsb">
        <div class="d-flex jsb search_tool">
            <div class="search_wrap mr-4">
                <v-text-field rounded class="elevation-0" density="compact" variant="solo" label="Search"
                    append-inner-icon="mdi-magnify" single-line hide-details v-model="search"></v-text-field>
            </div>
            <!-- <v-btn class="btn" variant="flat" prepend-icon="mdi-filter-variant"><span> More</span></v-btn> -->
            <v-btn class="btn" variant="flat" prepend-icon="mdi-plus" color="#5865f2" @click="createAccount()">
                {{ t('socialaccount.create_account') }}
            </v-btn>
        </div>
        <div>
        </div>
    </div>
    <!-- <div class="mt-4 jsb">
        <v-alert
      v-model="alert"
      :text="alerttext"
      :title="alerttitle"
      :type="alerttype"
    ></v-alert>
      </div> -->
    <v-data-table-server v-model:items-per-page="itemsPerPage" :search="search" :headers="headers"
        :items-length="totalItems" :items="serverItems" :loading="loading" item-value="name"
        @update:options="loadItems">
        <template v-slot:[`item.status`]="{ item }">
            <v-chip color="red" v-if="item.status === 0">
                Disable
            </v-chip>
            <v-chip color="green" v-if="item.status === 1">
                Enable
            </v-chip>
        </template>
        <template v-slot:[`item.actions`]="{ item }">
            <v-icon size="small" class="me-2" @click="editAccount(item)">
                mdi-pencil
            </v-icon>
            <v-icon size="small" @click="deleteAccount(item)">
                mdi-delete
            </v-icon>
            <v-icon size="small" @click="loginAccount(item)">
                mdi-login
            </v-icon>
            <v-icon size="small" @click="clearCookies(item)">
                mdi-close
            </v-icon>

        </template>
        <template v-slot:item.proxy="{ item }">
            <span>{{ item.use_proxy ? CapitalizeFirstLetter(t('common.configured')) :
                CapitalizeFirstLetter(t('common.not_configured')) }}</span>
        </template>
        <template v-slot:item.cookies="{ item }">
            <span>{{ item.cookies ? CapitalizeFirstLetter(t('common.configured')) :
                CapitalizeFirstLetter(t('common.not_configured')) }}</span>
        </template>
    </v-data-table-server>


    <!-- Social Account Table -->
    <!-- Your existing code for the social account table goes here -->

    <!-- Delete Confirmation Modal -->
    <v-dialog v-model="showDeleteModal" width="auto">
        <v-card max-width="400" prepend-icon="mdi-update" text="The account will be delete"
            title="Confirm to delete account">
            <template v-slot:actions>
                <v-btn class="ms-auto" text="Ok" color="secondary" @click="confirmrmAccount">
                </v-btn>
                <v-btn class="ms-auto" text="Cancel" @click="showDeleteModal = false"></v-btn>

            </template>
        </v-card>
    </v-dialog>
    <div>

        <!-- Define the alert dialog component -->
        <!-- <v-dialog v-model="showDialog" max-width="500px">
            <v-alert
            color="pink"
            dark
            border="top"
            icon="mdi-home"
            transition="slide-y-transition"
            >
            {{alertext}}
   </v-alert>
        </v-dialog> -->
        <ErrorDialog :showDialog="alert" :alertext="alertContent" :alertitle="alertTitle" @dialogclose="closeAlert" />
    </div>
    <confirmDialog :showDialog="confirmDialogctl" :noticeText="confirmContent" :noticeTitle="confirmTitle"
        @dialogclose="confirmDialogctl = false" @okCallback="openNextstepdialog" />
</template>

<script setup lang="ts">
import { getSocialAccountlist, deleteSocialAccount, socialaccountLogin, receiveAccountLoginevent, requireCookiesselecttab, cleanCookies, showPlatformpage } from '@/views/api/socialaccount'
import { ref, onMounted, reactive } from 'vue'
import { SearchResult } from '@/views/api/types'
import { SocialAccountListData } from '@/entityTypes/socialaccount-type'
import { RequireCookiesMsgbox, RequireCookiesParam } from '@/entityTypes/cookiesType'
// import { useRoute } from "vue-router";
import router from '@/views/router';
import { useI18n } from "vue-i18n";
import { CommonDialogMsg } from "@/entityTypes/commonType";
import { CapitalizeFirstLetter } from "@/views/utils/function"
import { SOCIAL_ACCOUNT_LOGIN_MESSSAGE } from "@/config/channellist"
import confirmDialog from '@/views/components/widgets/confirmDialog.vue';
import ErrorDialog from '@/views/components/widgets/errorDialog.vue';

const { t } = useI18n({ inheritLocale: true });
const gstatus = ref<number>(0);
const alert = ref(false);
const alertTitle = ref("");
// const alerttext= ref("");
const alertContent = ref("");
const confirmTitle = ref("")
const confirmContent = ref("")
const options = reactive({
    page: 1, // Initial page
    itemsPerPage: 10, // Items per page
});
//const alertcolor = ref("");
const alerttype = ref<"success" | "error" | "warning" | "info" | undefined>("success");
type Fetchparam = {
    // id:number
    page: number,
    itemsPerPage: number,
    sortBy: { key: string, order: string },
    search: string
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<SocialAccountListData>> {
        // console.log(fetchparam.search)
        const fpage = (fetchparam.page - 1) * fetchparam.itemsPerPage
        const res = await getSocialAccountlist({ page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy, search: fetchparam.search })
        console.log(res)
        return res
    }
}


const headers: Array<any> = [
    {
        title: 'Id',
        align: 'start',
        sortable: false,
        key: 'id',
    },
    {
        title: 'Type',
        align: 'start',
        sortable: false,
        key: 'social_type',
    },
    {
        title: 'User Name',
        align: 'start',
        sortable: false,
        key: 'user',
    },
    { title: 'Cookies', key: 'cookies', sortable: false },
    { title: 'Proxy', key: 'proxy', sortable: false },
    { title: 'Status', key: 'status', sortable: false },
    { title: 'Actions', key: 'actions', sortable: false },

];
const itemsPerPage = ref(10);
const serverItems = ref<Array<SocialAccountListData>>([]);
const loading = ref(false);
const totalItems = ref(0);
const search = ref('');
// const $route = useRoute();
const showDeleteModal = ref(false);
const deleteAccountid = ref(0);
const showDialog = ref(false);
const confirmDialogctl = ref(false);


const tmpId = ref(0);
const tmpPlatform = ref("");
function loadItems({ page, itemsPerPage, sortBy }) {
    loading.value = true
    const fetchitem: Fetchparam = {
        // id:parseInt(campaignId),
        page: page,
        itemsPerPage: itemsPerPage,
        sortBy: sortBy,
        search: search.value
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {

            console.log(total)
            if(!data){
                data=[]
            }
            serverItems.value = data
            totalItems.value = total
            loading.value = false
        }).catch(function (error) {
            console.error(error);
        })
}
// },
// }
// const editItem = (item) => {
//     // router.push({
//     //     path: '/graphics/oasis-engine',
//     // });
// };
// const runtask=(item)=>{
//     console.log("run task")
//     console.log("item id is "+item.id)
//     const routeData = router.resolve({name: 'Runtask', params: {id: item.id}});
//     console.log(routeData.href)
//     window.open(routeData.href, '_blank')
// }
const editAccount = (item) => {
    router.push({
        name: 'editSocialAccount', params: { id: item.id }
    });
}
const deleteAccount = (item) => {
    showDeleteModal.value = true;
    deleteAccountid.value = item.id;
}
// const cancelDelete=()=> {
//       showDeleteModal.value = false;
// }
//confirm delete account
const confirmrmAccount = () => {
    console.log("delete account")
    deleteSocialAccount(deleteAccountid.value).then(
        (res) => {
            console.log(res)
            showDeleteModal.value = false;
            loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: '' })
        }).catch(function (error) {
            console.error(error);
            // alertTitle.value=t('socialaccount.delete_account_errror')
            // alertContent.value=error.message;
            setAlert(t('socialaccount.delete_account_errror'), error.message, "error")
        })
}
const createAccount = () => {
    router.push({
        name: 'CreateSocialAccount'
    });
}
//login social account
const loginAccount = (item: SocialAccountListData) => {
    socialaccountLogin({ id: item.id,platform:item.social_type })
    tmpId.value = item.id
    tmpPlatform.value = item.social_type
}
const clearCookies = (item) => {
    cleanCookies({ id: item.id })
}

const receiveLoginMsg = (channel: string) => {
    receiveAccountLoginevent(channel, function (value) {
        console.log(value)
        const json_value = JSON.parse(value) as CommonDialogMsg
        if (!json_value.status) {
            if(json_value.msg){
                setAlert(t("socialaccount.login_account_error"), json_value.msg, "error")
            }

            if (json_value.data) {
                if (json_value.data.action == "error") {
                    console.log(json_value.data.content)
                    setAlert(t("socialaccount.login_account_error"), json_value.data.content, "error")
                } else if (json_value.data.action == "uploadfileMsg") {
                    if (json_value.code) {
                        tmpId.value = json_value.code
                    }
                    gstatus.value = 1
                    confirmDialogctl.value = true
                    confirmContent.value = t(json_value.data.content)
                    confirmTitle.value = t(json_value.data.title)
                } else if (json_value.data.action == "handleCookiesfile") {
                    setAlert(t(json_value.data.title), t(json_value.data.content), "error")
                } else if (json_value.data.action == "manualLoginMsg") {
                    gstatus.value = 2
                    confirmDialogctl.value = true
                    confirmContent.value = t(json_value.data.content)
                    confirmTitle.value = t(json_value.data.title)

                }
            }
        } else {//success
            loadItems({ page: options.page, itemsPerPage: itemsPerPage.value, sortBy: "" });
        }
    }
    )
}
const closeAlert=()=>{
    alert.value=false
}
//open upload file dialog
const openNextstepdialog = () => {
    confirmDialogctl.value = false
    if (tmpId.value > 0) {
        const requireParam: RequireCookiesMsgbox = {
            id: tmpId.value,
            platform: tmpPlatform.value
        }
        if (gstatus.value == 1) {

            requireCookiesselecttab(requireParam)
        } else {
            const requireParam: RequireCookiesParam = {
                id: tmpId.value,
            }
            showPlatformpage(requireParam)

        }
    }
}
onMounted(() => {
    // socialaccount:login:msg
    receiveLoginMsg(SOCIAL_ACCOUNT_LOGIN_MESSSAGE)
});
const setAlert = (title: string, text: string, type: "success" | "error" | "warning" | "info" | undefined) => {
    alertContent.value = text;
    alertTitle.value = title;
    alerttype.value = type;
    alert.value = true;
    setTimeout(() => {
        alert.value = false
    }, 5000)
}

</script>