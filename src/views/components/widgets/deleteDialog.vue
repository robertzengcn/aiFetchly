<template>
<v-dialog :modelValue="dialog" width="auto">
    <v-card>
      <v-card-title class="headline">{{ CapitalizeFirstLetter(t('common.comfirm_delete')) }}</v-card-title>
      <v-card-text>
        {{ t('common.delete_confirm_tip') }} ?
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="green darken-1"  @click="confirmDelete">Yes</v-btn>
        <v-btn color="red darken-1" @click="closeDialog">No</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>    
</template>
<script setup lang="ts">

import { useI18n } from "vue-i18n";
const { t } = useI18n({ inheritLocale: true });
import {CapitalizeFirstLetter} from "@/views/utils/function"

// Define props
const props = defineProps({
  dialog: {
    type: Boolean,
    required: true
  }
  
});
const emit = defineEmits(['confirm-close', 'confirm-delete']);

// Methods
const closeDialog = () => {
  // props.dialog = false;
  emit('confirm-close');
};

const confirmDelete = () => {
  emit('confirm-delete');
};
</script>