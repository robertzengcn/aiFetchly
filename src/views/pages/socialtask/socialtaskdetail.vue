<template>
    <v-sheet class="mx-auto" rounded>
        <v-form ref="form" @submit.prevent="onSubmit">
            <v-text-field v-model="socialtaskId" label="Id" type="input"
                v-show="isEdit" :readonly="true"></v-text-field>
            <v-text-field v-model="name" label="Name" type="input" hint="input the name" :rules="[rules.required]" required
                :readonly="loading"></v-text-field>

            <v-select v-model="type" item-title="name" item-value="id" :items="typeitems" label="Type" required
                :readonly="loading" :rules="[rules.required]"></v-select>

            <v-combobox v-model="infokeyword" :items="keywords" label="Select keyword or create a new one" multiple
                chips></v-combobox>

            <v-combobox v-model="infotag" :items="tags" label="Select tag or create a new one" multiple chips></v-combobox>
            <input type="hidden" :value="campaignId" name="campaignId" />
            <v-alert v-model="alert" border="start" variant="tonal" closable close-label="Close Alert" title="Information"
                :color="alertcolor">
                {{ alertContent }}
            </v-alert>

            <div class="d-flex flex-column">
                <v-btn color="success" class="mt-4" block type="submit" :loading="loading">
                    Submit
                </v-btn>

                <v-btn color="error" class="mt-4" block @click="router.go(-1)">
                    Return
                </v-btn>
            </div>
        </v-form>
    </v-sheet>
</template>
<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
    getSocialtaskinfo,
    getSocialtasktype,
    getTaglist,
} from "@/views/api/socialtask";
import { useRoute, useRouter } from "vue-router";
import { SocialTaskEntity } from "@/entityTypes/socialtask-type";
import { saveSocialTask } from "@/views/api/socialtask";
const $route = useRoute();
const router = useRouter();
const FakeAPI = {
    async fetch(id: number): Promise<SocialTaskEntity> {
        return await getSocialtaskinfo({ id: id });
    },
};
//defined the value in page
const form = ref<HTMLFormElement>();
const name = ref("");
const type = ref();
const typeitems = ref();
const keywords = ref();
const infotag = ref<Array<string>>([]);
const infokeyword = ref<Array<string>>([]);
const tags = ref<Array<string>>([]);
const campaignId = ref(0);
const loading = ref(false);
const alert = ref(false);
const alertContent = ref("");
const alertcolor = ref("");
const isEdit = ref(false);
const socialtaskId=ref(0);
const rules = {
    required: (value) => !!value || "Field is required",
};

const initialize = async () => {
    
    if($route.params.id){
    socialtaskId.value = parseInt($route.params.id.toString());
    }
    
    if (socialtaskId.value>0) {//edit
        isEdit.value = true;
        FakeAPI.fetch(parseInt(socialtaskId.value.toString())).then((res) => {
            name.value = res.task_name;
            type.value = res.type_id;
            if (res.keywords != null) {
                res.keywords.map((item) => {
                    infokeyword.value.push(item);
                });
            }
            if (res.tag != null) {
                res.tag.map((item) => {
                    infotag.value.push(item);
                });
            }
            campaignId.value = res.campaign_id;
        });
    }else{//add new item
        isEdit.value = false;
        if($route.params.campaignId){
        campaignId.value=parseInt($route.params.campaignId.toString());
        }
    
    }
    //get social task type
    const tasktypelist = await getSocialtasktype();
    // console.log(tasktypelist)
    if (tasktypelist != null) {
        // console.log(tasktypelist)
        typeitems.value = tasktypelist.map((item) => {
            return {
                id: item.id,
                name: item.name,
            };
        });
        console.log(typeitems.value);
    }
    //get tag list
    const taglist = await getTaglist();
    if (taglist != null) {
        tags.value = taglist.map((item) => {
            return item.name;
        });
    }
};

async function onSubmit() {
    console.log("submit");
    if (!form.value) return;
    const { valid } = await form.value.validate();
    console.log(valid);
    loading.value = true;
    if(!valid){
        loading.value = false;
        console.log("form is not valid")
    }else{
        const sotaskentity: SocialTaskEntity = {
            task_name: name.value,
            type_id: type.value,
            keywords: infokeyword.value,
            tag: infotag.value,
            campaign_id: campaignId.value,
        };
        if ($route.params.id) {
            sotaskentity.id = parseInt($route.params.id.toString());
        }
        console.log(sotaskentity)
        await saveSocialTask(sotaskentity)
            .then((res) => {
                loading.value = false;
                if (res.id > 0) {
                    alert.value = true;
                    alertcolor.value = "success";
                    alertContent.value = "Save success, the task id is "+res.id;
                    sotaskentity.id=socialtaskId.value=res.id;
                    $route.params.id=res.id.toString();
                    isEdit.value = true;
                } else {
                    alert.value = true;
                    alertcolor.value = "error";
                    alertContent.value = "Save fail";
                }
                setTimeout(() => {
                    alert.value = false;
                }, 5000);
            })
            .catch((err) => {
                alert.value = true;
                alertcolor.value = "error";
                alertContent.value = err.message;
            });
    }
    loading.value = false;
    //if (valid) alert('Form is valid')
    // loading.value = true
    //setTimeout(() => (loading.value = false), 3000)
}

onMounted(() => {
    initialize();
});
</script>
