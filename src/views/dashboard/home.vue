<template>
  <div class="ai-chat-home">
    <AiChatBox />
  </div>
</template>

<script setup lang="ts">
import AiChatBox from '@/views/components/aiChat/AiChatBox.vue';
</script>

<style scoped lang="scss">
.ai-chat-home {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
}
</style>
