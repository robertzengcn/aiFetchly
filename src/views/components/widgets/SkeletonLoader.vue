<template>
  <div class="skeleton-loader">
    <div v-if="type === 'form'" class="skeleton-form">
      <div class="skeleton-field" v-for="i in fields" :key="i">
        <div class="skeleton-label"></div>
        <div class="skeleton-input"></div>
      </div>
      <div class="skeleton-buttons">
        <div class="skeleton-button"></div>
        <div class="skeleton-button"></div>
      </div>
    </div>

    <div v-else-if="type === 'table'" class="skeleton-table">
      <div class="skeleton-header">
        <div class="skeleton-cell" v-for="i in columns" :key="i"></div>
      </div>
      <div class="skeleton-row" v-for="i in rows" :key="i">
        <div class="skeleton-cell" v-for="j in columns" :key="j"></div>
      </div>
    </div>

    <div v-else-if="type === 'card'" class="skeleton-card">
      <div class="skeleton-title"></div>
      <div class="skeleton-content">
        <div class="skeleton-line" v-for="i in lines" :key="i"></div>
      </div>
    </div>

    <div v-else class="skeleton-default">
      <div class="skeleton-line" v-for="i in lines" :key="i"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  type?: 'form' | 'table' | 'card' | 'default'
  fields?: number
  columns?: number
  rows?: number
  lines?: number
}

const props = withDefaults(defineProps<Props>(), {
  type: 'default',
  fields: 5,
  columns: 4,
  rows: 5,
  lines: 3
})
</script>

<style scoped>
.skeleton-loader {
  width: 100%;
}

.skeleton-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skeleton-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-label {
  height: 16px;
  width: 120px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

.skeleton-input {
  height: 40px;
  width: 100%;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

.skeleton-buttons {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.skeleton-button {
  height: 40px;
  width: 100px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

.skeleton-table {
  width: 100%;
}

.skeleton-header {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.skeleton-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.skeleton-cell {
  height: 20px;
  flex: 1;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

.skeleton-card {
  padding: 16px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.skeleton-title {
  height: 24px;
  width: 60%;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
  margin-bottom: 16px;
}

.skeleton-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-line {
  height: 16px;
  width: 100%;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

.skeleton-line:nth-child(2) {
  width: 80%;
}

.skeleton-line:nth-child(3) {
  width: 60%;
}

.skeleton-default {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}
</style>