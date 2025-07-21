<template>
  <v-sheet class="mx-auto" rounded>
    <v-form ref="form" @submit.prevent="onSubmit">
      <v-text-field
        v-model="proxyId"
        label="Id"
        type="input"
        v-show="isEdit"
        :readonly="true"
      ></v-text-field>
      <v-text-field
        v-model="host"
        label="Host"
        type="input"
        hint="input the host"
        required
        :rules="[rules.required]"
        :readonly="loading"
      ></v-text-field>
      <v-text-field
        v-model="port"
        label="Port"
        type="input"
        hint="input the port"
        required
        :rules="[rules.required]"
        :readonly="loading"
      ></v-text-field>
      <v-text-field
        v-model="user"
        label="User"
        type="input"
        hint="input the name"
        :readonly="loading"
      ></v-text-field>
      <v-text-field
        v-model="pass"
        label="Pass"
        type="input"
        hint="input the pass"       
        :readonly="loading"
      ></v-text-field>
    
      <v-select
        v-model="protocol"
        :items="protollist"
        label="Protocol"
        required
        :readonly="loading"
        :rules="[rules.required]"
      ></v-select>
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

      <div class="d-flex flex-column">
        <v-btn
          color="success"
          class="mt-4"
          block
          type="submit"
          :loading="loading"
        >
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
  getProxy,saveProxy
} from "@/views/api/proxy";

import { useRoute, useRouter } from "vue-router";
import {ProxyEntity} from "@/entityTypes/proxyType";
// import { saveSocialTask } from "@/views/api/socialtask";
const $route = useRoute();
const router = useRouter();
const FakeAPI = {
  async fetch(id: number): Promise<ProxyEntity> {
    return await getProxy(id);
  },
};
//defined the value in page
const form = ref<HTMLFormElement>();
const host = ref("");
const port = ref("");
const user = ref(""); //account
const pass = ref(""); //password
// const status = ref(0);
const protocol = ref(""); //username
const country_code = ref("");
const proxyId=ref(0);

const loading = ref(false);
const alert = ref(false);
const alertContent = ref("");
const alertcolor = ref("");
const isEdit = ref(false);
const protollist=ref(["http","https","socket5"]);

const rules = {
  required: (value) => !!value || "Field is required",
};

const initialize = async () => {
  if ($route.params.id) {
    proxyId.value = parseInt($route.params.id.toString());
  }
  // protollist.value=[] as string[];
  if (proxyId.value > 0) {
    //edit
    isEdit.value = true;
    FakeAPI.fetch(parseInt(proxyId.value.toString())).then((res) => {
      if(res.user){
      user.value = res.user.toString();
      }
      if(res.pass){
      pass.value = res.pass;
      }
      if(res.host){
      host.value = res.host;
      }
      if(res.port){
        port.value = res.port;
      }
      if(res.protocol){
        protocol.value = res.protocol;
      }
      if(res.country_code){
        country_code.value = res.country_code;
      }

    });
  } else {
    //add new item
    isEdit.value = false;
    // if($route.params.campaignId){
    // campaignId.value=parseInt($route.params.campaignId.toString());
    // }
  }
  //get social task type
  // const platformlist = await getSocialPlatformlist({ page: 0, size: 100 });

  // if (platformlist != null) {
  //   // console.log(tasktypelist)
  //   platformitems.value = platformlist.map((item) => {
  //     return {
  //       id: item.id,
  //       name: item.name,
  //     };
  //   });
  //   // console.log(typeitems.value);
  // }
};

async function onSubmit() {
  console.log("submit");
  if (!form.value) return;
  const { valid } = await form.value.validate();
  // console.log(valid);
  loading.value = true;
  if (!valid) {
    loading.value = false;
    console.log("form is not valid");
  } else {
    const pe: ProxyEntity = {
      host: host.value,
      port: port.value,
      user: user.value,
      pass: pass.value,
      protocol:protocol.value,
      country_code:country_code.value,  
    };
    if ($route.params.id) {
      pe.id = parseInt($route.params.id.toString());
    }
    
    await saveProxy(pe)
      .then((res) => {

        loading.value = false;
        console.log(res)
        if (res.id > 0) {
          alert.value = true;
          alertcolor.value = "success";
          alertContent.value = "Save success, the account id is " + res.id;
          pe.id = res.id;
          $route.params.id = res.id.toString();
          isEdit.value = true;
          proxyId.value =res.id;
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
        loading.value = false;
        alert.value = true;
        alertcolor.value = "error";
        alertContent.value = err.message;
      });
  }
  loading.value = false;
}

onMounted(() => {
  initialize();
});
</script>
