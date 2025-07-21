<template>
    <v-container class="bg-surface-variant">
        <h1>{{ task_name }}</h1>
        <v-row no-gutters>
            <v-col cols="6" class="ps-3">
                <v-list lines="two">
                    <v-list-subheader>Task Info</v-list-subheader>
                    <v-list-item v-for="(item, i) in items" :key="i" :value="item" :title=item.title :subtitle=item.content
                        color="primary">
                        <!-- <template v-slot:prepend>
            <v-icon :icon="item.icon"></v-icon>
          </template> -->

                    </v-list-item>
                </v-list>
            </v-col>
            <v-col cols="6" class="ps-3">
                <v-textarea label="Log" clearable
                clear-icon="mdi-close-circle" v-model="runlog"></v-textarea>
            </v-col>
        </v-row>
        <v-row no-gutters class="mt-5">
            <v-col cols="9"></v-col>
            <v-col cols="3">
                <v-btn v-if="socialtaskId>0" @click="starttask()" :disabled="buttonDisable">
                    {{ buttonName }}
                </v-btn>
            </v-col>
        </v-row>
    </v-container>
</template>
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { v4 as uuidv4 } from 'uuid';
import { SocialTaskEntity } from "@/entityTypes/socialtask-type";
// import * as randomstring from "randomstring";
import {
    getSocialtaskinfo, startSocialTask,receiveSocialTaskLog
} from "@/views/api/socialtask";
// import {ipcRenderer} from 'electron'
const task_name = ref('')
const $route = useRoute();
const socialtaskId = ref()
const items = ref<{ title: string, content: string }[]>([]);
const buttonName = ref("")
const buttonDisable=ref(false)
const runlog=ref("")
const FakeAPI = {
    async fetch(id: number): Promise<SocialTaskEntity> {
        return await getSocialtaskinfo({ id: id });
    },
};

const initialize = async () => {
    buttonName.value = "Start"
    if ($route.params.id) {
        socialtaskId.value = parseInt($route.params.id.toString());
    }
    console.log("socialtask id:"+socialtaskId.value)
    if (socialtaskId.value > 0) {
        FakeAPI.fetch(parseInt(socialtaskId.value.toString())).then((res) => {
            task_name.value = res.task_name;
            const compaigntext = { title: "campaign Id:", content: res.campaign_id.toString() }
            items.value.push(compaigntext)
            if (res.tag != null) {
                let tagStr = "";
                res.tag.map((item) => {
                    tagStr += item + ","
                });
                items.value.push({ title: "Tags: ", content: tagStr })
            }
            const typeStr = { title: "Type name: ", content: res.type_name + "(" + res.type_id + ")" }
            items.value.push(typeStr)
            if (res.keywords != null) {
                let keywordsStr = "";
                res.keywords.map((item) => {
                    keywordsStr += item + ","
                });
                items.value.push({ title: "Keywords: ", content: keywordsStr })
            }
            console.log(items.value)
        });
    }
}
onMounted(() => {
    initialize();
    // ipcRenderer.on('socialtask:start', (event, arg) => {
    //         console.log(arg)
    // })
});
// $vuetify.display
// const cols = computed(() => {
//     const { lg, sm } = this.$vuetify.display;
//         return lg ? [9, 3]
//           : sm ? [9, 3]
//             : [6, 6]
// })
const starttask = () => {
    console.log("start task"+socialtaskId.value)
    // buttonDisable.value=true
    const runNum=socialtaskId.value+":"+uuidv4()
    startSocialTask(socialtaskId.value,runNum);
    //recive message
    receiveMsg(runNum)
}

const receiveMsg=(channel:string)=>{
    receiveSocialTaskLog(channel,function (value) {
        console.log(value)
        runlog.value=runlog.value+value
    })  
}

</script>