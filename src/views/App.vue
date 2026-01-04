<template>
  <v-app :theme="mainStore.theme">
      <router-view />
</v-app>
</template>
<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useMainStore } from '@/views/store/appMain';
import { onMounted, onUnmounted } from 'vue';
import { receiveRedirectevent } from '@/views/api/users';
import { NATIVATECOMMAND } from '@/config/channellist';
import { UserModule } from '@/views/store/modules/user';
import router from '@/views/router';
import type { NativateDatatype } from '@/entityTypes/commonType';

const mainStore = useMainStore();

// Handle logout notification from main process
const handleLogoutNotification = (data: NativateDatatype) => {
  // Check if this is a logout notification (navigating to login page)
  if (data.path === 'login') {
    console.log('Received logout notification - clearing user state');
    
    // Clear all user state in Vuex store (token, roles, name, email, etc.)
    UserModule.ResetToken();
    
    // Navigate to login page if not already there
    if (router.currentRoute.value.path !== '/login') {
      router.push('/login').catch((err) => {
        console.warn('Navigation to login page failed:', err);
      });
    }
  } else {
    // Handle other navigation commands (existing functionality)
    if (data.path) {
      router.push({
        name: data.path
      }).catch((err) => {
        console.warn('Navigation failed:', err);
      });
    }
  }
};

onMounted(() => {
  
  // Listen for navigation commands from main process (including logout)
  receiveRedirectevent(NATIVATECOMMAND, handleLogoutNotification);
});

onUnmounted(() => {
  // Cleanup if needed (receiveRedirectevent might handle this internally)
});
</script>
<style scoped lang="scss">

</style>
