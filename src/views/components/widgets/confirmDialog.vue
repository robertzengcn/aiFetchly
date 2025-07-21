<template>
    
      <v-dialog
      :modelValue="showDialog"
        max-width="400"
        persistent
      >
       

        <v-card
          prepend-icon="mdi-map-marker"
          :text="noticeText"
          :title="noticeTitle"
        >
          <template v-slot:actions>
            <v-spacer></v-spacer>
  
            <v-btn @click="closeDialog">
                {{ CapitalizeFirstLetter(t('common.cancel')) }}
            </v-btn>
  
            <v-btn @click="okCallback">
              {{ CapitalizeFirstLetter(t('common.ok')) }}
            </v-btn>
          </template>
        </v-card>
      </v-dialog>
   
  </template>
<script setup lang="ts">
import { useI18n } from "vue-i18n";
const { t } = useI18n({ inheritLocale: true });
import {CapitalizeFirstLetter} from "@/views/utils/function"

const props = defineProps({
    showDialog: {
      type: Boolean,
      required: true
    },
    noticeText:{
        type:String,
        required: true
    },
    noticeTitle:{
        type:String,
        required: false,
        //default:t("common.error")
    }
    
  });
  const emit = defineEmits(['dialogclose','okCallback']);

  const closeDialog = () => {
    console.log("closeDialog"+54)
  // props.dialog = false;
  emit('dialogclose');
};
const okCallback = () => {
  // props.dialog = false;
  emit('okCallback');
};
</script>