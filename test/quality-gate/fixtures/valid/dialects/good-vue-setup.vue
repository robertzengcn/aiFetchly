<script setup lang="ts">
const pick = (v: boolean): string => (v ? 'yes' : 'no');
</script>
<template><div>{{ pick(true) }}</div></template>
