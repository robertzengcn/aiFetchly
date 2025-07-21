<template>
  <v-sheet class="mx-auto" rounded>
    <v-form ref="form" @submit.prevent="onSubmit">
      <v-text-field
        v-model="socialaccountId"
        label="Id"
        type="input"
        v-show="isEdit"
        :readonly="true"
        clearable
      ></v-text-field>
      <v-text-field
        v-model="user"
        label="User"
        type="input"
        hint="input the name"
        :rules="[rules.required]"
        required
        :readonly="loading"
        clearable
      ></v-text-field>
      <v-text-field
        v-model="pass"
        label="Pass"
        
        hint="input the pass"
        :readonly="loading"
        :type="show ? 'text' : 'password'"
            @click:append="show = !show"
        clearable
        :append-icon="show ? 'mdi-eye' : 'mdi-eye-off'"
      ></v-text-field>
      
      <v-btn-toggle v-model="status" mandatory >
        <v-btn :value="0" color="primary">Inactive</v-btn>
        <v-btn :value="1" color="success">Active</v-btn>
      </v-btn-toggle>
      <v-select class="mt-3"
        v-model="social_type_id"
        item-title="name"
        item-value="id"
        :items="platformitems"
        label="Platform"
        required
        :readonly="loading"
        :rules="[rules.required]"
      ></v-select>
      <v-text-field
        v-model="name"
        label="Name"
        type="input"
        hint="input the account name"
        :readonly="loading"
      ></v-text-field>
      <v-text-field
        v-model="phone"
        clearable
        label="Phone"
        type="input"
        hint="input the account phone"
        :readonly="loading"
      ></v-text-field>
      <v-text-field
        v-model="email"
        clearable
        label="Email"
        type="input"
        hint="input the account email"
        :readonly="loading"
      ></v-text-field>

      <v-combobox
        v-model="proxyValue"
        :items="proxyValue"
        label="Select proxy"
        item-title="host"
        multiple
        return-object
        chips
        clearable
      ></v-combobox>
      <v-btn color="primary" @click="showProxytable">Change Proxy</v-btn>

      <div v-if="proxytableshow">
        <ProxyTableselected @change="handleSelectedChanged" />
      </div>

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
import { ref, onMounted, watch } from "vue";
import {
  getSocialaccountinfo,
  saveSocialAccount,
} from "@/views/api/socialaccount";
import { getSocialPlatformlist } from "@/views/api/social_platform";
import { useRoute, useRouter } from "vue-router";
import { SocialAccountDetailData } from "@/entityTypes/socialaccount-type";
import ProxyTableselected from "@/views/pages/proxy/widgets/ProxySelectedTable.vue";
import { ProxyListEntity, Proxy } from "@/entityTypes/proxyType";
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
const status = ref(0);
const name = ref(""); //username
const phone = ref("");
const email = ref("");
// const proxy = ref(0);
const socialaccountId = ref(0);
const social_type_id = ref<number>();
const proxyValue = ref<Array<Proxy>>([]);
const proxyValueshow = ref<Array<string>>([]);
const loading = ref(false);
const alert = ref(false);
const alertContent = ref("");
const alertcolor = ref("");
const isEdit = ref(false);
const platformitems = ref();
const proxytableshow = ref(false);
// const selectedProxy = ref<ProxyListEntity>();

const rules = {
  required: (value) => !!value || "Field is required",
};
const showProxytable = () => {
  console.log("show proxy table");
  proxytableshow.value = !proxytableshow.value;
};

const initialize = async () => {
  if ($route.params.id) {
    socialaccountId.value = parseInt($route.params.id.toString());
  }

  if (socialaccountId.value > 0) {
    //edit
    isEdit.value = true;
    FakeAPI.fetch(parseInt(socialaccountId.value.toString())).then((res) => {
      user.value = res.user;
      pass.value = res.pass;
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
    });
  } else {
    //add new item
    isEdit.value = false;
    // if($route.params.campaignId){
    // campaignId.value=parseInt($route.params.campaignId.toString());
    // }
  }
  //get social task type
  const platformlist = await getSocialPlatformlist({ page: 0, size: 100 });

  if (platformlist != null) {
    // console.log(tasktypelist)
    platformitems.value = platformlist.map((item) => {
      return {
        id: item.id,
        name: item.name,
      };
    });
    // console.log(typeitems.value);
  }
};

async function onSubmit() {
  console.log("submit");
  if (!form.value) return;
  const { valid } = await form.value.validate();
  // console.log(valid);
  loading.value = true;
  if (!valid) {
    console.log("form is not valid");
    loading.value = false;
    alert.value = true;
    alertcolor.value = "error";
    alertContent.value = "form is not valid";
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
    console.log(soacc);
    await saveSocialAccount(soacc)
      .then((res) => {
        loading.value = false;
        if (res.id > 0) {
          alert.value = true;
          alertcolor.value = "success";
          alertContent.value = "Save success, the account id is " + res.id;
          soacc.id = res.id;
          $route.params.id = res.id.toString();
          isEdit.value = true;
          socialaccountId.value = res.id;
        } else {
          alert.value = true;
          alertcolor.value = "error";
          alertContent.value = "Save fail";
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

onMounted(() => {
  initialize();
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
        console.log("isexist:" + isexist.toString());
        if (!isexist) {
          proxyValue.value.push({
            id: newValue[i].id,
            host: newValue[i].host,
            port: newValue[i].port,
            username: newValue[i].username,
            password: newValue[i].password,
            protocol: newValue[i].protocol,
          });
          console.log(proxyValue.value);
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
