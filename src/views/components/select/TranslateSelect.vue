<template>
<div class="translate-select">
    <label for="translate-tool">Translation Tool:</label>
    <select id="translate-tool" v-model="selectedTool" class="form-select">
        <option v-for="(value, key) in TranslateToolEnum" :key="key" :value="value">
            {{ value }}
        </option>
    </select>
</div>
</template>
<script setup lang="ts">
import { ref,watch } from 'vue';
import { TranslateToolEnum } from "@/config/generate";
const emit = defineEmits(['update:selectedTool']);
const selectedTool = ref<string>("");
watch(selectedTool, (newValue:string, oldValue:string) => {
  console.log(`selectedTool changed from ${oldValue} to ${newValue}`);
  emit('update:selectedTool', newValue);
});
</script>

<style scoped>
.translate-select {
    margin-bottom: 16px;
}
.form-select {
    width: 100%;
    padding: 8px;
    border-radius: 4px;
    border: 1px solid #ccc;
}
</style>

