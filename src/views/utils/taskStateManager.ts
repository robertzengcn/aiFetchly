import { ref, computed } from 'vue'
import { EmailSearchTaskDetail } from '@/entityTypes/emailextraction-type'

export interface TaskState {
  loading: boolean
  editing: boolean
  error: string | null
  success: string | null
  dirty: boolean
}

export const useTaskStateManager = () => {
  const state = ref<TaskState>({
    loading: false,
    editing: false,
    error: null,
    success: null,
    dirty: false
  })

  const taskData = ref<EmailSearchTaskDetail | null>(null)
  const originalTaskData = ref<EmailSearchTaskDetail | null>(null)

  // Computed properties
  const isLoading = computed(() => state.value.loading)
  const isEditing = computed(() => state.value.editing)
  const hasError = computed(() => !!state.value.error)
  const hasSuccess = computed(() => !!state.value.success)
  const isDirty = computed(() => state.value.dirty)

  // State setters
  const setLoading = (loading: boolean) => {
    state.value.loading = loading
  }

  const setEditing = (editing: boolean) => {
    state.value.editing = editing
  }

  const setError = (error: string | null) => {
    state.value.error = error
    if (error) {
      // Clear success message when error occurs
      state.value.success = null
    }
  }

  const setSuccess = (success: string | null) => {
    state.value.success = success
    if (success) {
      // Clear error message when success occurs
      state.value.error = null
    }
  }

  const setDirty = (dirty: boolean) => {
    state.value.dirty = dirty
  }

  // Task data management
  const setTaskData = (data: EmailSearchTaskDetail | null) => {
    taskData.value = data
    if (data) {
      originalTaskData.value = JSON.parse(JSON.stringify(data))
      setDirty(false)
    }
  }

  const updateTaskData = (updates: Partial<EmailSearchTaskDetail>) => {
    if (taskData.value) {
      taskData.value = { ...taskData.value, ...updates }
      checkDirty()
    }
  }

  const checkDirty = () => {
    if (!taskData.value || !originalTaskData.value) {
      setDirty(false)
      return
    }
    
    const current = JSON.stringify(taskData.value)
    const original = JSON.stringify(originalTaskData.value)
    setDirty(current !== original)
  }

  const resetTaskData = () => {
    if (originalTaskData.value) {
      taskData.value = JSON.parse(JSON.stringify(originalTaskData.value))
      setDirty(false)
    }
  }

  // Action handlers
  const startLoading = () => {
    setLoading(true)
    setError(null)
  }

  const stopLoading = () => {
    setLoading(false)
  }

  const handleError = (error: string) => {
    setError(error)
    stopLoading()
  }

  const handleSuccess = (message: string) => {
    setSuccess(message)
    stopLoading()
    setDirty(false)
  }

  const startEditing = () => {
    setEditing(true)
    setError(null)
    setSuccess(null)
  }

  const stopEditing = () => {
    setEditing(false)
    setError(null)
    setSuccess(null)
  }

  // Reset all state
  const resetState = () => {
    state.value = {
      loading: false,
      editing: false,
      error: null,
      success: null,
      dirty: false
    }
    taskData.value = null
    originalTaskData.value = null
  }

  return {
    // State
    state: computed(() => state.value),
    taskData: computed(() => taskData.value),
    isLoading,
    isEditing,
    hasError,
    hasSuccess,
    isDirty,

    // Actions
    setLoading,
    setEditing,
    setError,
    setSuccess,
    setDirty,
    setTaskData,
    updateTaskData,
    checkDirty,
    resetTaskData,
    startLoading,
    stopLoading,
    handleError,
    handleSuccess,
    startEditing,
    stopEditing,
    resetState
  }
}