<template>
    <v-snackbar
      v-model="show"
      :color="getColor"
      :timeout="timeout"
      location="bottom right"
    >
      <div class="d-flex align-center">
        <v-icon :icon="getIcon" class="me-2" />
        {{ message }}
        <v-btn
          variant="text"
          icon="mdi-close"
          @click="closeSnackbar"
        ></v-btn>
      </div>
    </v-snackbar>
  </template>
  
  <script setup lang="ts">
  import { computed } from 'vue';
  
  interface Props {
    modelValue: boolean;
    message: string;
    type?: 'success' | 'error' | 'warning' | 'info';
    timeout?: number;
  }
  
  const props = withDefaults(defineProps<Props>(), {
    type: 'info',
    timeout: 3000
  });
  
  const emit = defineEmits(['update:modelValue']);
  
  const show = computed({
    get: () => props.modelValue,
    set: (value) => emit('update:modelValue', value)
  });
  
  const getIcon = computed(() => ({
    success: 'mdi-check-circle',
    error: 'mdi-alert-circle',
    warning: 'mdi-alert',
    info: 'mdi-information'
  })[props.type]);
  
  const getColor = computed(() => ({
    success: 'success',
    error: 'error',
    warning: 'warning',
    info: 'info'
  })[props.type]);
  
  const closeSnackbar = () => {
    show.value = false;
  };
  </script>