# Router Translation System

This directory contains the router translation system that allows dynamic translation of route titles and metadata using Vue i18n.

## Files

- `index.ts` - Main router configuration with static routes
- `translatedRoutes.ts` - Function that creates routes with computed translations
- `README.md` - This documentation file

## Usage

### Method 1: Using RouterTranslator Component (Recommended)

Include the `RouterTranslator` component in your main layout or app component:

```vue
<template>
  <div>
    <RouterTranslator />
    <!-- Your app content -->
  </div>
</template>

<script setup>
import RouterTranslator from '@/views/components/RouterTranslator.vue';
</script>
```

### Method 2: Manual Integration

Call `createTranslatedRoutes()` from within a Vue component:

```vue
<script setup>
import { onMounted } from 'vue';
import { createTranslatedRoutes } from '@/views/router/translatedRoutes';
import router from '@/views/router';

onMounted(() => {
  const translatedRoutes = createTranslatedRoutes();
  translatedRoutes.forEach(route => {
    router.addRoute(route);
  });
});
</script>
```

## Translation Keys

All router translations are defined in the language files:

- `src/views/lang/en.ts` - English translations
- `src/views/lang/zh.ts` - Chinese translations

The translation keys follow the pattern: `router.{route_name}`

## Features

- **Computed Properties**: All route titles use `computed()` for reactive translations
- **Automatic Updates**: Route titles update automatically when language changes
- **Type Safety**: Full TypeScript support with proper typing
- **Duplicate Prevention**: Routes are checked for duplicates before adding

## Example Translation Keys

```typescript
router: {
  dashboard: "Dashboard",
  home: "Home",
  campaign: "Campaign",
  campaign_list: "Campaign List",
  // ... more translations
}
```

## Notes

- The `createTranslatedRoutes()` function must be called within a Vue component context
- Routes are added dynamically to avoid conflicts with static routes
- All route metadata (titles, icons) are properly translated and reactive



