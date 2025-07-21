<template>
    <v-dialog
    :modelValue="loadDialogshow"
    max-width="320"
    persistent
  >
    <v-list
      class="py-2"
      color="primary"
      elevation="12"
      rounded="lg"
    >
      <v-list-item
        prepend-icon="mdi-pending"
        :title="loadingtitle"
      >
        <template v-slot:prepend>
          <div class="pe-4">
            <v-icon color="primary" size="x-large"></v-icon>
          </div>
        </template>

        <template v-slot:append>
          <v-progress-circular
            color="primary"
            indeterminate="disable-shrink"
            size="16"
            width="2"
          ></v-progress-circular>
        </template>
      </v-list-item>
    </v-list>
  </v-dialog>    

</template>
<script setup lang="ts">


const props = defineProps({
    loadDialogshow: {
      type: Boolean,
      required: true
    },
    loadingtitle:{
        type:String,
        required: false,
        default:"Loading..."
    }    
  });
</script>