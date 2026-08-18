<template>
    <div class="test"></div>
</template>
<script lang="ts" setup>

const emits = defineEmits<{
    change: [id: number];
}>();
emits('change', 1);
</script>
