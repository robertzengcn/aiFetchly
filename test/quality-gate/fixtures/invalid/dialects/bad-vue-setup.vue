<script setup lang="ts">
const pick = (v: boolean): string => {
  if (v) { return 'same'; } else { return 'same'; }
};
</script>
<template><div>{{ pick(true) }}</div></template>
