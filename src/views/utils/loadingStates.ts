import { ref, computed } from 'vue'

export interface LoadingState {
  isLoading: boolean
  message?: string
  progress?: number
  type: 'skeleton' | 'spinner' | 'progress' | 'overlay'
}

export interface LoadingConfig {
  showSkeleton?: boolean
  showSpinner?: boolean
  showProgress?: boolean
  showOverlay?: boolean
  message?: string
  duration?: number
}

export const useLoadingStates = () => {
  const loadingStates = ref<Map<string, LoadingState>>(new Map())
  const globalLoading = ref(false)
  const globalMessage = ref('')

  // Create a loading state
  const createLoadingState = (key: string, config: LoadingConfig = {}): LoadingState => {
    const state: LoadingState = {
      isLoading: true,
      message: config.message || 'Loading...',
      progress: 0,
      type: config.showSkeleton ? 'skeleton' : 
            config.showProgress ? 'progress' : 
            config.showOverlay ? 'overlay' : 'spinner'
    }
    
    loadingStates.value.set(key, state)
    return state
  }

  // Start loading
  const startLoading = (key: string, config: LoadingConfig = {}) => {
    const state = createLoadingState(key, config)
    
    if (config.duration) {
      setTimeout(() => {
        stopLoading(key)
      }, config.duration)
    }
    
    return state
  }

  // Stop loading
  const stopLoading = (key: string) => {
    loadingStates.value.delete(key)
  }

  // Update loading progress
  const updateProgress = (key: string, progress: number) => {
    const state = loadingStates.value.get(key)
    if (state) {
      state.progress = Math.min(100, Math.max(0, progress))
    }
  }

  // Update loading message
  const updateMessage = (key: string, message: string) => {
    const state = loadingStates.value.get(key)
    if (state) {
      state.message = message
    }
  }

  // Check if specific loading state is active
  const isLoading = (key: string): boolean => {
    return loadingStates.value.has(key)
  }

  // Get loading state
  const getLoadingState = (key: string): LoadingState | undefined => {
    return loadingStates.value.get(key)
  }

  // Global loading controls
  const startGlobalLoading = (message?: string) => {
    globalLoading.value = true
    globalMessage.value = message || 'Loading...'
  }

  const stopGlobalLoading = () => {
    globalLoading.value = false
    globalMessage.value = ''
  }

  // Computed properties
  const hasAnyLoading = computed(() => {
    return globalLoading.value || loadingStates.value.size > 0
  })

  const activeLoadingStates = computed(() => {
    return Array.from(loadingStates.value.entries())
  })

  return {
    // State
    globalLoading: computed(() => globalLoading.value),
    globalMessage: computed(() => globalMessage.value),
    hasAnyLoading,
    activeLoadingStates,

    // Actions
    startLoading,
    stopLoading,
    updateProgress,
    updateMessage,
    isLoading,
    getLoadingState,
    startGlobalLoading,
    stopGlobalLoading
  }
}

// Predefined loading configurations
export const loadingConfigs = {
  // Form loading
  form: {
    showSpinner: true,
    message: 'Saving...',
    duration: 3000
  },

  // Data loading
  data: {
    showSkeleton: true,
    message: 'Loading data...'
  },

  // API call loading
  api: {
    showSpinner: true,
    message: 'Processing...'
  },

  // File upload loading
  upload: {
    showProgress: true,
    message: 'Uploading...'
  },

  // Task operation loading
  task: {
    showSpinner: true,
    message: 'Processing task...'
  }
}

// Loading state keys
export const LOADING_KEYS = {
  FORM_SUBMIT: 'form_submit',
  DATA_LOAD: 'data_load',
  TASK_EDIT: 'task_edit',
  TASK_DELETE: 'task_delete',
  TASK_LOAD: 'task_load',
  API_CALL: 'api_call'
} as const

// Global loading instance
export const loadingManager = useLoadingStates()