/**
 * Frontend Optimization Utilities for Email Extraction
 * Provides component lazy loading, form debouncing, and virtual scrolling
 */

import { ref, watch, nextTick } from 'vue'

/**
 * Component lazy loading utilities
 */
export class ComponentLazyLoader {
  private loadedComponents = new Set<string>()
  private loadingPromises = new Map<string, Promise<any>>()

  /**
   * Lazy load a component
   * @param componentName - Name of the component to load
   * @param loaderFn - Function that returns the component
   * @returns Promise that resolves to the component
   */
  async loadComponent<T>(
    componentName: string,
    loaderFn: () => Promise<T>
  ): Promise<T> {
    // Check if already loaded
    if (this.loadedComponents.has(componentName)) {
      return this.loadingPromises.get(componentName) as Promise<T>
    }

    // Check if already loading
    const existingPromise = this.loadingPromises.get(componentName)
    if (existingPromise) {
      return existingPromise as Promise<T>
    }

    // Start loading
    const loadingPromise = loaderFn().then(component => {
      this.loadedComponents.add(componentName)
      this.loadingPromises.delete(componentName)
      return component
    }).catch(error => {
      this.loadingPromises.delete(componentName)
      throw error
    })

    this.loadingPromises.set(componentName, loadingPromise)
    return loadingPromise
  }

  /**
   * Preload components for better performance
   * @param components - Array of component names and loaders
   */
  async preloadComponents<T>(
    components: Array<{
      name: string
      loader: () => Promise<T>
    }>
  ): Promise<void> {
    const promises = components.map(({ name, loader }) =>
      this.loadComponent(name, loader)
    )
    await Promise.all(promises)
  }

  /**
   * Check if component is loaded
   * @param componentName - Name of the component
   * @returns True if component is loaded
   */
  isLoaded(componentName: string): boolean {
    return this.loadedComponents.has(componentName)
  }

  /**
   * Clear loaded components cache
   */
  clear(): void {
    this.loadedComponents.clear()
    this.loadingPromises.clear()
  }
}

/**
 * Form field debouncing utilities
 */
export class FormDebouncer {
  private debounceTimers = new Map<string, NodeJS.Timeout>()

  /**
   * Debounce a function call
   * @param key - Unique key for the debounce
   * @param fn - Function to debounce
   * @param delay - Delay in milliseconds
   */
  debounce<T extends (...args: any[]) => any>(
    key: string,
    fn: T,
    delay: number = 300
  ): (...args: Parameters<T>) => void {
    return (...args: Parameters<T>) => {
      // Clear existing timer
      const existingTimer = this.debounceTimers.get(key)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // Set new timer
      const timer = setTimeout(() => {
        fn(...args)
        this.debounceTimers.delete(key)
      }, delay)

      this.debounceTimers.set(key, timer)
    }
  }

  /**
   * Cancel a debounced function
   * @param key - Key of the debounced function
   */
  cancel(key: string): void {
    const timer = this.debounceTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.debounceTimers.delete(key)
    }
  }

  /**
   * Cancel all debounced functions
   */
  cancelAll(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
  }
}

/**
 * Virtual scrolling utilities for large lists
 */
export class VirtualScroller {
  private containerHeight = 0
  private itemHeight = 0
  private totalItems = 0
  private scrollTop = 0

  /**
   * Calculate visible items for virtual scrolling
   * @param containerHeight - Height of the container
   * @param itemHeight - Height of each item
   * @param totalItems - Total number of items
   * @param scrollTop - Current scroll position
   * @returns Object with visible items info
   */
  calculateVisibleItems(
    containerHeight: number,
    itemHeight: number,
    totalItems: number,
    scrollTop: number
  ) {
    this.containerHeight = containerHeight
    this.itemHeight = itemHeight
    this.totalItems = totalItems
    this.scrollTop = scrollTop

    const startIndex = Math.floor(scrollTop / itemHeight)
    const endIndex = Math.min(
      startIndex + Math.ceil(containerHeight / itemHeight) + 1,
      totalItems
    )

    const visibleCount = endIndex - startIndex
    const offsetY = startIndex * itemHeight

    return {
      startIndex,
      endIndex,
      visibleCount,
      offsetY,
      totalHeight: totalItems * itemHeight
    }
  }

  /**
   * Get items for virtual scrolling
   * @param items - Full array of items
   * @param visibleInfo - Visible items information
   * @returns Array of visible items
   */
  getVisibleItems<T>(
    items: T[],
    visibleInfo: ReturnType<typeof this.calculateVisibleItems>
  ): T[] {
    return items.slice(visibleInfo.startIndex, visibleInfo.endIndex)
  }
}

/**
 * Image optimization utilities
 */
export class ImageOptimizer {
  /**
   * Optimize image loading
   * @param src - Image source URL
   * @param options - Optimization options
   * @returns Optimized image element
   */
  static optimizeImage(
    src: string,
    options: {
      width?: number
      height?: number
      quality?: number
      format?: 'webp' | 'jpeg' | 'png'
    } = {}
  ): HTMLImageElement {
    const img = new Image()
    
    // Add loading optimization
    img.loading = 'lazy'
    
    // Add error handling
    img.onerror = () => {
      console.warn(`Failed to load image: ${src}`)
    }

    // Set source
    img.src = src

    return img
  }

  /**
   * Preload images for better performance
   * @param urls - Array of image URLs to preload
   * @returns Promise that resolves when all images are loaded
   */
  static preloadImages(urls: string[]): Promise<void> {
    const promises = urls.map(url => {
      return new Promise<void>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve()
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
        img.src = url
      })
    })

    return Promise.all(promises).then(() => {})
  }
}

/**
 * Performance monitoring utilities
 */
export class PerformanceMonitor {
  private metrics = new Map<string, number[]>()

  /**
   * Start performance measurement
   * @param name - Name of the measurement
   * @returns Function to end the measurement
   */
  startMeasure(name: string): () => void {
    const startTime = performance.now()
    
    return () => {
      const endTime = performance.now()
      const duration = endTime - startTime
      
      if (!this.metrics.has(name)) {
        this.metrics.set(name, [])
      }
      
      this.metrics.get(name)!.push(duration)
    }
  }

  /**
   * Get performance statistics
   * @param name - Name of the measurement
   * @returns Performance statistics
   */
  getStats(name: string) {
    const measurements = this.metrics.get(name) || []
    
    if (measurements.length === 0) {
      return null
    }

    const sorted = measurements.sort((a, b) => a - b)
    const sum = sorted.reduce((a, b) => a + b, 0)
    const avg = sum / sorted.length
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const median = sorted[Math.floor(sorted.length / 2)]

    return {
      count: measurements.length,
      average: avg,
      min,
      max,
      median,
      total: sum
    }
  }

  /**
   * Clear performance metrics
   * @param name - Name of the measurement to clear (optional)
   */
  clear(name?: string): void {
    if (name) {
      this.metrics.delete(name)
    } else {
      this.metrics.clear()
    }
  }
}

/**
 * Memory management utilities
 */
export class MemoryManager {
  private weakRefs = new Set<WeakRef<any>>()

  /**
   * Track object for memory management
   * @param obj - Object to track
   */
  track<T extends object>(obj: T): T {
    this.weakRefs.add(new WeakRef(obj))
    return obj
  }

  /**
   * Clean up unreferenced objects
   */
  cleanup(): void {
    const toRemove: WeakRef<any>[] = []
    
    for (const ref of this.weakRefs) {
      if (ref.deref() === undefined) {
        toRemove.push(ref)
      }
    }

    for (const ref of toRemove) {
      this.weakRefs.delete(ref)
    }
  }

  /**
   * Get memory usage statistics
   */
  getStats() {
    let activeRefs = 0
    let inactiveRefs = 0

    for (const ref of this.weakRefs) {
      if (ref.deref() === undefined) {
        inactiveRefs++
      } else {
        activeRefs++
      }
    }

    return {
      totalRefs: this.weakRefs.size,
      activeRefs,
      inactiveRefs
    }
  }
}

// Global instances
export const componentLoader = new ComponentLazyLoader()
export const formDebouncer = new FormDebouncer()
export const virtualScroller = new VirtualScroller()
export const performanceMonitor = new PerformanceMonitor()
export const memoryManager = new MemoryManager()

/**
 * Vue composition utilities for optimization
 */
export function useOptimization() {
  const isVisible = ref(false)
  const isLoaded = ref(false)

  /**
   * Intersection Observer for lazy loading
   */
  const observeVisibility = (element: HTMLElement | null) => {
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            isVisible.value = true
            observer.disconnect()
          }
        })
      },
      { threshold: 0.1 }
    )

    observer.observe(element)
  }

  /**
   * Debounced watcher for form fields
   */
  const createDebouncedWatcher = <T>(
    source: () => T,
    callback: (value: T) => void,
    delay: number = 300
  ) => {
    let timeout: NodeJS.Timeout | null = null

    watch(source, (newValue) => {
      if (timeout) {
        clearTimeout(timeout)
      }

      timeout = setTimeout(() => {
        callback(newValue)
      }, delay)
    })
  }

  /**
   * Virtual scrolling for large lists
   */
  const useVirtualScrolling = (
    items: any[],
    itemHeight: number,
    containerHeight: number
  ) => {
    const scrollTop = ref(0)
    const visibleItems = ref<any[]>([])

    const updateVisibleItems = () => {
      const visibleInfo = virtualScroller.calculateVisibleItems(
        containerHeight,
        itemHeight,
        items.length,
        scrollTop.value
      )

      visibleItems.value = virtualScroller.getVisibleItems(items, visibleInfo)
    }

    const handleScroll = (event: Event) => {
      const target = event.target as HTMLElement
      scrollTop.value = target.scrollTop
      updateVisibleItems()
    }

    // Initial calculation
    nextTick(() => {
      updateVisibleItems()
    })

    return {
      scrollTop,
      visibleItems,
      handleScroll,
      updateVisibleItems
    }
  }

  return {
    isVisible,
    isLoaded,
    observeVisibility,
    createDebouncedWatcher,
    useVirtualScrolling
  }
} 