<template>
  <div>
    <!-- This component demonstrates how to use translated routes -->
    <!-- The translated routes are automatically applied when this component is mounted -->
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { createTranslatedRoutes } from '@/views/router/translatedRoutes';
import router from '@/views/router';

// Apply translated routes when component mounts
onMounted(() => {
  try {
    const translatedRoutes = createTranslatedRoutes();
    
    // Add translated routes to the router
    translatedRoutes.forEach(route => {
      // Check if route already exists to avoid duplicates
      const existingRoute = router.getRoutes().find(r => r.name === route.name);
      if (!existingRoute) {
        router.addRoute(route);
      }
    });
    
    console.log('Translated routes applied successfully');
  } catch (error) {
    console.error('Error applying translated routes:', error);
  }
});
</script>


