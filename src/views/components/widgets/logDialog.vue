<template>
    <v-dialog :modelValue="dialogModel" max-width="600px">
        <v-card>
          <v-card-title>{{ CapitalizeFirstLetter(t('common.log_content')) }}</v-card-title>
          <v-card-text>
            <pre>{{ logContent }}</pre>
          </v-card-text>
          <v-card-actions>
            <v-btn color="primary" @click="closeDialog">Close</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>  
</template>
<script setup lang="ts">
import { useI18n } from "vue-i18n";
const { t } = useI18n({ inheritLocale: true });
import {CapitalizeFirstLetter} from "@/views/utils/function"
const emit = defineEmits(['dialogclose']);
const props = defineProps({
    dialogModel: {
      type: Boolean,
      required: true
    },
    logContent:{
        type:String,
        required: true
    },
})
const closeDialog = () => {
    //console.log("closeDialog"+54)
  // props.dialog = false;
  emit('dialogclose');
};
</script>