<script lang="ts">
export default {
  name: 'GoodScript',
  methods: {
    pick(flag: boolean): string {
      return flag ? 'yes' : 'no';
    },
  },
};
</script>
<template><div>{{ pick(true) }}</div></template>
