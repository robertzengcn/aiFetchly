import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'

export interface CloudflareNotificationData {
  id: string
  taskId: number
  message: string
  url?: string
  timestamp: Date
  type: 'cloudflare' | 'captcha' | 'rate-limited'
}

export interface NotificationManagerState {
  cloudflareNotifications: CloudflareNotificationData[]
  showCloudflareNotification: boolean
  currentCloudflareNotification: CloudflareNotificationData | null
}

class NotificationManager {
  private state = reactive<NotificationManagerState>({
    cloudflareNotifications: [],
    showCloudflareNotification: false,
    currentCloudflareNotification: null
  })

  private router: any = null

  constructor() {
    // Initialize router when component is mounted
    this.initRouter()
  }

  private initRouter() {
    // This will be called when the component is mounted
    try {
      // We'll set this when the service is used in a component
    } catch (error) {
      console.warn('Router not available yet, will be set later')
    }
  }

  public setRouter(router: any) {
    this.router = router
  }

  /**
   * Add a new Cloudflare notification
   */
  public addCloudflareNotification(data: Omit<CloudflareNotificationData, 'id' | 'timestamp'>): void {
    const notification: CloudflareNotificationData = {
      ...data,
      id: this.generateId(),
      timestamp: new Date()
    }

    this.state.cloudflareNotifications.push(notification)
    
    // Show the notification if none is currently displayed
    if (!this.state.showCloudflareNotification) {
      this.showNextCloudflareNotification()
    }
  }

  /**
   * Show the next Cloudflare notification in the queue
   */
  private showNextCloudflareNotification(): void {
    if (this.state.cloudflareNotifications.length > 0) {
      this.state.currentCloudflareNotification = this.state.cloudflareNotifications[0]
      this.state.showCloudflareNotification = true
    }
  }

  /**
   * Dismiss the current Cloudflare notification
   */
  public dismissCloudflareNotification(): void {
    this.state.showCloudflareNotification = false
    
    // Remove the current notification from the queue
    if (this.state.currentCloudflareNotification) {
      const index = this.state.cloudflareNotifications.findIndex(
        n => n.id === this.state.currentCloudflareNotification!.id
      )
      if (index > -1) {
        this.state.cloudflareNotifications.splice(index, 1)
      }
      this.state.currentCloudflareNotification = null
    }

    // Show the next notification if available
    setTimeout(() => {
      this.showNextCloudflareNotification()
    }, 300) // Small delay for smooth transition
  }

  /**
   * View task details for the current notification
   */
  public viewTaskDetails(taskId: number): void {
    if (this.router) {
      this.router.push(`/yellowpages/details/${taskId}`)
    } else {
      console.warn('Router not available, cannot navigate to task details')
    }
    
    // Dismiss the notification after navigation
    this.dismissCloudflareNotification()
  }

  /**
   * Get the current state for reactive components
   */
  public getState() {
    return this.state
  }

  /**
   * Clear all notifications
   */
  public clearAllNotifications(): void {
    this.state.cloudflareNotifications = []
    this.state.showCloudflareNotification = false
    this.state.currentCloudflareNotification = null
  }

  /**
   * Get notification count
   */
  public getNotificationCount(): number {
    return this.state.cloudflareNotifications.length
  }

  /**
   * Check if there are pending notifications
   */
  public hasPendingNotifications(): boolean {
    return this.state.cloudflareNotifications.length > 0
  }

  /**
   * Generate unique ID for notifications
   */
  private generateId(): string {
    return `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Handle Cloudflare detection message from background process
   */
  public handleCloudflareDetection(message: any): void {
    if (message.type === 'SCRAPING_CLOUDFLARE_DETECTED') {
      const notificationData = {
        taskId: message.taskId,
        message: `Cloudflare protection detected at ${message.details?.url || 'unknown URL'}`,
        url: message.details?.url,
        type: 'cloudflare' as const
      }
      
      this.addCloudflareNotification(notificationData)
    } else if (message.type === 'SCRAPING_PAUSED_CLOUDFLARE') {
      const notificationData = {
        taskId: message.taskId,
        message: 'Scraping paused due to Cloudflare protection. Manual intervention required.',
        url: message.details?.url,
        type: 'cloudflare' as const
      }
      
      this.addCloudflareNotification(notificationData)
    }
  }
}

// Create a singleton instance
const notificationManager = new NotificationManager()

export default notificationManager

