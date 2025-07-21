<template>
    <v-data-table-server v-model:items-per-page="itemsPerPage" :headers="computedHeaders" :items-length="totalItems"
        :items="serverItems" :loading="loading" item-value="name" @update:options="loadItems"
        :show-select="isSelectedtable">
        <template v-slot:[`item.actions`]="{ item }">
            <v-btn v-if="!item.installed" @click="openDialog(item, true)" :loading="item.loading"
                loading-text="{{$t('common.installing')}}..." size="small">
                {{ t('common.install') }}
            </v-btn>
            <v-btn v-if="item.installed" @click="openDialog(item, false)" :loading="item.loading"
                loading-text="{{$t('common.uninstalling')}}..." color="primary" size="small" class="ml-2 mr-2 mb-2">
                {{ t('common.uninstall') }}
            </v-btn>
            <v-btn v-if="item.installed&&item.upgradeAvailable" @click="openUpgradeDialog(item)" :loading="item.upgradeLoading"
                loading-text="{{$t('common.upgrading')}}..." color="secondary" size="small" class="ml-2 mr-2 mb-2">
                {{ t('common.upgrade') }}
            </v-btn>

            <!-- <v-icon
            size="small"
            class="me-2"
            @click="editItem(item)"
          >
            mdi-pencil
          </v-icon> -->

        </template>
        <template v-slot:item.installed="{ item }">
            <span>{{ item.installed ? CapitalizeFirstLetter(t('extramodule.installed')) :
                CapitalizeFirstLetter(t('extramodule.notInstalled')) }}</span>
        </template>
    </v-data-table-server>

    <v-dialog v-model="dialog" persistent max-width="290">
        <v-card>
            <v-card-title class="headline">{{ CapitalizeFirstLetter(t('common.confirmation')) }}</v-card-title>
            <v-card-text>{{ dialogtext }}</v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="green darken-1"
                    @click="dialog = false">{{ CapitalizeFirstLetter(t('common.cancel')) }}</v-btn>
                <v-btn color="green darken-1"
                    @click="confirmAction">{{ CapitalizeFirstLetter(t('common.confirm')) }}</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
    <ErrorDialog :showDialog="showDialog" :alertext="alertext" :alertitle="alertitle"
        @dialogclose="showDialog = false" />
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { getExtramodulelist, installExtramodule, receiveInExtramoduleLog, removeExtramodule, upgradeExtramodule,upgradeExtramoduleMsg } from "@/views/api/extramodules"
import { ref, computed, onMounted,reactive } from 'vue'
import { SearchResult } from '@/views/api/types'
// import router from '@/views/router';
import { ExtraModule, ExtraModuleItem } from "@/entityTypes/extramoduleType"
const { t } = useI18n({ inheritLocale: true });
import { CapitalizeFirstLetter } from '@/views/utils/function'
import ErrorDialog from "@/views/components/widgets/errorDialog.vue"
import {Header,CommonDialogMsg} from "@/entityTypes/commonType"
//const showDeleteModal = ref(false);
const showDialog = ref<boolean>(false);
const alertext = ref<string>("")
const alertitle = ref<string>("")
// const deleteId = ref(0);
// const campaignId = i18n.t("campaignId");
type Fetchparam = {
    page: number,
    itemsPerPage: number,
    sortBy: string,
}

const FakeAPI = {
    async fetch(fetchparam: Fetchparam): Promise<SearchResult<ExtraModule>> {
        const fpage = (fetchparam.page - 1) * fetchparam.itemsPerPage
        return await getExtramodulelist({ page: fpage, size: fetchparam.itemsPerPage, sortby: fetchparam.sortBy })
    }
}
const itemsPerPage = ref(10);
const serverItems = ref<Array<ExtraModuleItem>>([]);
const loading = ref(false);
const totalItems = ref(0);
// const search = ref('');
const dialog = ref(false);
const currentItem = ref<ExtraModuleItem>();
const dialogtext = ref("");
const dialogAction = ref('');
const headers = computed<Array<Header>>(() => [
    {
        title: CapitalizeFirstLetter(t("extramodule.extramoduleName")),
        align: 'start',
        sortable: false,
        key: 'packagenameTr',
    },
    {
        title: CapitalizeFirstLetter(t("extramodule.extramoduleDescription")),
        align: 'start',
        sortable: false,
        key: 'description',
    },
    {
        title: CapitalizeFirstLetter(t("extramodule.installed_version")),
        align: 'start',
        sortable: false,
        key: 'installVersion',
    },
    {
        title: CapitalizeFirstLetter(t("extramodule.require_version")),
        align: 'start',
        sortable: false,
        key: 'version',
    },
    {
        title: CapitalizeFirstLetter(t("extramodule.extramoduleStatus")),
        align: 'start',
        sortable: false,
        key: 'installed',
    },
    { 
        title: CapitalizeFirstLetter(t("extramodule.actions")), 
        key: 'actions', 
        sortable: false 
    },
]);
const options = reactive({
  page: 1, // Initial page
  itemsPerPage: 10, // Items per page
});

function loadItems({ page, itemsPerPage, sortBy }) {
    loading.value = true
    // console.log(page);
    const fetchitem: Fetchparam = {
        page: page,
        itemsPerPage: itemsPerPage,
        sortBy: sortBy,
        // search: search.value
    }
    FakeAPI.fetch(fetchitem).then(
        ({ data, total }) => {

            console.log(data)
            // console.log(total)
            const epi: Array<ExtraModuleItem> = []
            //loop data
            for (let i = 0; i < data.length; i++) {
                const tranvarname = "modules." + data[i].name + ".name"
                const tranvardesc = "modules." + data[i].name + ".describe"


                let item: ExtraModuleItem = {
                    name: data[i].name,
                    packagename: data[i].packagename,
                    packagenameTr: t(tranvarname),
                    description: t(tranvardesc),
                    installed: false,
                    version: data[i].version,

                }
                if (data[i].installed) {
                    item.installed = true
                }
                if (data[i].installVersion) {
                    item.installVersion = data[i].installVersion
                }
                if (data[i].upgradeAvailable) {
                    item.upgradeAvailable = true
                } else {
                    item.upgradeAvailable = false
                }
                epi.push(item)
            }
            serverItems.value = epi
            totalItems.value = total
            loading.value = false
        }).catch(function (error) {
            console.error(error);
        })
}
const openDialog = (item, install: boolean) => {
    currentItem.value = item;
    dialog.value = true;
    const packagename = item.packagename
    console.log(packagename)
    if (install) {
        dialogtext.value = t("extramodule.installConfirm", { package: packagename });
        dialogAction.value = "install"
    } else {
        dialogtext.value = t("extramodule.uninstallConfirm", { package: packagename });
        dialogAction.value = "uninstall"
    }
}
const openUpgradeDialog = (item) => {
    currentItem.value = item;
    dialog.value = true;
    const packagename = item.packagename
    console.log(packagename)

    dialogtext.value = t("extramodule.installConfirm", { package: packagename });
    dialogAction.value = "upgrade"

}

const confirmAction = () => {
    dialog.value = false;
    if (!currentItem.value) {
        return
    }
    if (dialogAction.value === 'install') {
        installItem(currentItem.value);
    } else if (dialogAction.value === 'uninstall') {
        uninstallItem(currentItem.value)
    }else if(dialogAction.value === 'upgrade'){
        upgradeItem(currentItem.value)
    }

}

// const confirmInstall=()=> {
//       dialog.value = false;
//       if(currentItem.value){
//       installItem(currentItem.value);
//       }
// }
const upgradeItem = (item: ExtraModuleItem) => {
    item.upgradeLoading = true
    upgradeExtramodule(item.packagename)

}
const installItem = async (item: ExtraModuleItem) => {
    item.loading = true
    await installExtramodule(item.packagename)

}
const props = defineProps({
    isSelectedtable: {
        type: Boolean,

        default: false,
    }

});
const computedHeaders = computed(() => {
    if (props.isSelectedtable) {
        return headers.value.filter(value => value.key !== 'actions');
    } else {
        return headers.value;
    }
});
const uninstallItem = (item: ExtraModuleItem) => {
    item.loading = true
    removeExtramodule(item.packagename)
    //reload table

}

onMounted(() => {
    receiveInExtramoduleLog((strobj) => {
        const obj = JSON.parse(strobj)
        console.log(obj)
        if (obj.status) {
            loadItems({ page: options.page, itemsPerPage: itemsPerPage.value, sortBy: "" });
            // for (let i = 0; i < serverItems.value.length; i++) {
            //     if (serverItems.value[i].packagename == obj.data.name) {
            //         serverItems.value[i].loading = false
            //         if (dialogAction.value === 'install') {
            //             serverItems.value[i].installed = true
            //         } else {
            //             serverItems.value[i].installed = false
            //         }
            //         break
            //     }
            // }
            // loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: '' })
        } else {
            console.error(obj.msg)
            alertext.value = obj.msg
            showDialog.value = true
        }
    })
    upgradeExtramoduleMsg((res)=>{
        const obj = JSON.parse(res) as CommonDialogMsg
        if(obj.status){
            alertext.value = t('extramodule.upgrade_start')
            showDialog.value = true
            alertitle.value = t('common.success')
            //loadItems({ page: options.page, itemsPerPage: itemsPerPage.value, sortBy: "" });
        }else{
            //console.error(obj.msg)
            if(obj.msg){
            alertext.value = obj.msg
            showDialog.value = true
            alertitle.value = t('common.error')
            }
        }
    })
})

</script>