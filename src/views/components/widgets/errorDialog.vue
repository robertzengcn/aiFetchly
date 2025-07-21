<template>
  <!-- <v-dialog :model-value="showDialog" max-width="500px">
    <v-card>
      <v-card-title class="headline">
        Error
        <v-spacer></v-spacer>
        <v-btn icon @click="closeDialog">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-card-text>
       
          {{ alertext }}
      
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" @click="closeDialog">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog> -->
  <v-dialog
  persistent
      :model-value="showDialog"
      width="auto"
    >
      <v-card
        max-width="400"
        prepend-icon="mdi-update"
        :text="alertext"
        :title="alertitle"
      >
        <template v-slot:actions>
          <v-btn
            class="ms-auto"
            text="Ok"
            @click="closeDialog"
          ></v-btn>
        </template>
      </v-card>
    </v-dialog>
</template>
<script setup lang="ts">
//import { useI18n } from "vue-i18n";
//const { t } = useI18n({ inheritLocale: true });
//import {CapitalizeFirstLetter} from "@/views/utils/function"
const props = defineProps({
    showDialog: {
      type: Boolean,
      required: true
    },
    alertext:{
        type:String,
        required: true
    },
    alertitle:{
        type:String,
        required: false,
        //default:t("common.error")
    }
    
  });
  const emit = defineEmits(['dialogclose']);

  const closeDialog = () => {
  // props.dialog = false;
  emit('dialogclose');
};
</script>  