<template>
  <TaskResultsViewer :task-id="taskId" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import TaskResultsViewer from './widgets/TaskResultsViewer.vue'

const route = useRoute()
const taskId = computed(() => Number(route.params.id))
</script>
