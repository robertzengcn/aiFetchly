<template>
  <v-sheet class="mx-auto" rounded>

    <v-form ref="form" @submit.prevent="onSubmit" class="ml-2 mr-2">
      <v-alert v-model="alert" border="start" variant="tonal" closable close-label="Close Alert" title="Information"
        :color="alertcolor">
        {{ alertContent }}
      </v-alert>
      <v-row>
        <v-col cols="12" md="12">
          <v-text-field ref="inputs" v-model="filteName" :label="t('emailfilter.name')" type="input"
            :hint="t('emailfilter.inputname_hint')" :readonly="loading" clearable required></v-text-field>
          <!-- <v-text-field v-model="tplcontent" :label="$t('emailmarketing.content')" type="input"
            :hint="$t('emailmarketing.title_content')" :rules="[rules.required]" required :readonly="loading"
            clearable></v-text-field> -->
          <!-- https://www.vue2editor.com/examples/#basic-setup -->
          <!-- <vue-editor v-model="tplcontent" /> -->
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12" md="12">
          <v-text-field v-model="description" :label="t('emailfilter.description')" type="input"
            :hint="t('emailfilter.description_hint')" :readonly="loading" clearable required></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <v-col v-for="(filter, index) in filterDetailArr" :key="index" cols="12" md="12">
          <v-row>
            <v-col cols="8" md="8">
                <v-text-field v-model="filter.content" :label="t('emailfilter.filtercontent')"
                :hint="t('emailfilter.filtercontent_hint')" :readonly="loading" clearable required></v-text-field>
            </v-col>
            <v-col cols="4" md="4">
              <!--if item is last one in filterDetailArr-->
              <div class="mt-3">
                <v-btn v-if="index === filterDetailArr.length - 1" @click="filterDetailArr.push({ content: '' })"
                  density="compact" icon="mdi-plus">
                </v-btn>
                <v-btn v-if="index != 0" density="compact" icon="mdi-minus" class="ml-2" @click="removeFilter(index)">
                </v-btn>
              </div>
            </v-col>
          </v-row>
        </v-col>
      </v-row>

      <div class="d-flex flex-column">
        <v-row>
          <v-col cols="12" md="4">
            <v-btn color="success" class="mt-4 mb-4" type="submit" :loading="loading">
              {{ t('common.submit') }}
            </v-btn>
          </v-col>
        </v-row>
      </div>
      <v-alert v-model="alert" border="start" variant="tonal" closable close-label="Close Alert" title="Information"
        :color="alertcolor">
        {{ alertContent }}
      </v-alert>
    </v-form>
  </v-sheet>


</template>
<script setup lang="ts">
// import router from '@/views/router';
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { getEmailfilterbyid, updateEmailfilter } from "@/views/api/emailfilter";
import { EmailFilterdata, EmailFilterDetialdata } from "@/entityTypes/emailmarketingType"
// import { convertVariableInTemplate } from "@/views/utils/function"
// import { VueEditor } from "vue2-editor";
import { CommonIdrequest } from "@/entityTypes/commonType"
import router from "@/views/router";

const { t } = useI18n({ inheritLocale: true });
const filterId = ref<number>(0);


const $route = useRoute();
const FakeAPI = {
  async fetch(id: number): Promise<EmailFilterdata> {
    const data: CommonIdrequest<number> = {
      id: id
    }
    return await getEmailfilterbyid(data);
  },
};
//defined the value in page
const form = ref<HTMLFormElement>();
const filteName = ref<string>(""); //template title
const filterDetailArr = ref<Array<EmailFilterDetialdata>>([]);
const description = ref<string>("");
const loading = ref<boolean>(false);
const alert = ref<boolean>(false);
const alertContent = ref("");
const alertcolor = ref("");
const isEdit = ref(false);


// import { RefSymbol } from "@vue/reactivity";
// const selectedProxy = ref<ProxyListEntity>();

// const rules = {
//   required: (value) => !!value || "Field is required",
// };


const initialize = async () => {
  if ($route.params.id) {
    filterId.value = parseInt($route.params.id.toString());
  }

  if (filterId.value > 0) {
    //edit
    isEdit.value = true;
    FakeAPI.fetch(parseInt(filterId.value.toString())).then((res) => {
      console.log(res)
      //set value
      if (res) {

        filteName.value = res.name;
        description.value = res.description;
        if(res.filter_details){
        res.filter_details.forEach((element: EmailFilterDetialdata) => {
          filterDetailArr.value.push(element);
        });
      }
      }
    });
  } else {
    //add new item
    isEdit.value = false;
    const filterdetailinit: EmailFilterDetialdata = {
      content: ""
    }
    filterDetailArr.value.push(filterdetailinit)
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
    loading.value=false
    alert.value = true;
    alertcolor.value = "error";
    alertContent.value = "form is not valid";
  } else {
    const soacc: EmailFilterdata = {
      name: filteName.value,
      description: description.value,
      filter_details: filterDetailArr.value,
      created_time:new Date().toISOString().split('T')[0]
    };


    if ($route.params.id) {
      soacc.id = parseInt($route.params.id.toString());
    }
    console.log(soacc);
    await updateEmailfilter(soacc)
      .then((res) => {
        loading.value = false;
        console.log(res)
        if (res) {
          if (res.id && res.id > 0) {
            alert.value = true;
            alertcolor.value = "success";
            alertContent.value = "Save success";
            soacc.id = res.id;
            $route.params.id = res.id.toString();
            isEdit.value = true;
            filterId.value = res.id;
          } else {
            alert.value = true;
            alertcolor.value = "error";
            alertContent.value = "Save fail";
          }
          setTimeout(() => {
            alert.value = false;
            if (res.id && res.id > 0) {
              router.push({
                name: 'Email_Marketing_Filter_LIST'
              });
            }
          }, 5000);
        }
      }
      )
      .catch((err) => {
        loading.value = false;
        alert.value = true;
        alertcolor.value = "error";
        alertContent.value = err.message;
      });
  }
  loading.value = false;
}

function removeFilter(index: number) {
  filterDetailArr.value.splice(index, 1);
}


onMounted(() => {
  initialize();

});

</script>
<style scoped>
.rounded-text-field .v-input__control {
  border-radius: 12px;
  /* Adjust the value as needed */
}
</style>
