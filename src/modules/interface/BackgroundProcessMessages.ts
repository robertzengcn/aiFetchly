/**
 * Message types for communication between main process and background processes
 * @since 1.0.0
 * @author Yellow Pages Scraper Team
 */

import { ScrapingProgress } from "./IPCMessage";

/**
 * Base interface for all background process messages
 */
export interface BaseBackgroundMessage {
  type: string;
  taskId: number;
  content?: string; // Optional descriptive content about the event
}

/**
 * Message sent from main process to start a task
 */
export interface StartTaskMessage extends BaseBackgroundMessage {
  type: "START";
  taskData: {
    taskId: number;
    platform: string;
    keywords: string[];
    location?: string;
    max_pages: number;
    delay_between_requests: number;
    account_id?: number;
    cookies?: any[];
    headless?: boolean;
    aiSupportEnabled?: boolean;
    userDataPath?: string;
    adapterClass?: {
      className: string;
      modulePath: string;
    };
  };
  platformInfo: {
    id: number;
    name: string;
    display_name: string;
    base_url: string;
    settings: {
      searchUrlPattern?: string;
    };
    selectors: {
      businessList: string;
      businessItem?: string;
      businessName: string;
      detailPageLink?: string;
      phone?: string;
      email?: string;
      website?: string;
      address?: string;
      address_city?: string;
      address_state?: string;
      address_zip?: string;
      address_country?: string;
      socialMedia?: string;
      categories?: string;
      businessHours?: string;
      description?: string;
      rating?: string;
      reviewCount?: string;
      faxNumber?: string;
      contactPerson?: string;
      yearEstablished?: string;
      numberOfEmployees?: string;
      paymentMethods?: string;
      specialties?: string;
      logo?: string;
      photos?: string;
      businessImage?: string;
      businessUrl?: string;
      map?: string;
      status?: string;
      priceRange?: string;
      certifications?: string;
      licenses?: string;
      insurance?: string;
      associations?: string;
      awards?: string;
      hours?: {
        container?: string;
        day?: string;
        time?: string;
        status?: string;
      };
      services?: string;
      products?: string;
      team?: string;
      testimonials?: string;
      reviews?: {
        container?: string;
        text?: string;
        author?: string;
        date?: string;
        rating?: string;
      };
      events?: string;
      news?: string;
      blog?: string;
      gallery?: string;
      videos?: string;
      contactForm?: string;
      appointmentBooking?: string;
      onlineOrdering?: string;
      paymentOptions?: string;
      accessibility?: string;
      parking?: string;
      wifi?: string;
      petPolicy?: string;
      smokingPolicy?: string;
      dressCode?: string;
      ageRestrictions?: string;
      searchForm?: {
        keywordInput?: string;
        locationInput?: string;
        searchButton?: string;
        formContainer?: string;
        categoryDropdown?: string;
        radiusDropdown?: string;
      };
      pagination?: {
        nextButton?: string;
        currentPage?: string;
        maxPages?: string;
        previousButton?: string;
        pageNumbers?: string;
        container?: string;
      };
      navigation?: {
        detailLink?: string;
        alternatives?: string[];
        required?: boolean;
        delayAfterNavigation?: number;
        detailPage?: {
          businessName?: string;
          fullAddress?: string;
          businessHours?: string;
          description?: string;
          contactInfo?: string;
          services?: string;
          photos?: string;
          map?: string;
          additionalPhone?: string;
          additionalEmail?: string;
          socialMedia?: string;
          categories?: string;
          yearEstablished?: string;
          numberOfEmployees?: string;
          paymentMethods?: string;
          specialties?: string;
          website?: string;
        };
      };
    };
    adapterClass?: {
      className: string;
      modulePath: string;
    };
  };
}

/**
 * Message sent from background process to report progress
 */
export interface ProgressMessage extends BaseBackgroundMessage {
  type: "PROGRESS";
  progress: ScrapingProgress;
}

/**
 * Message sent from background process when task is completed
 */
export interface CompletedMessage extends BaseBackgroundMessage {
  type: "COMPLETED";
  results: any[]; // Array of scraped business data
}

/**
 * Message sent from background process when an error occurs
 */
export interface ErrorMessage extends BaseBackgroundMessage {
  type: "ERROR";
  error: string;
}

/**
 * Message sent from background process when scraping starts
 */
export interface ScrapingStartedMessage extends BaseBackgroundMessage {
  type: "SCRAPING_STARTED";
}

/**
 * Message sent from background process when a page is completed
 */
export interface ScrapingPageCompleteMessage extends BaseBackgroundMessage {
  type: "SCRAPING_PAGE_COMPLETE";
  page: number;
  totalPages: number;
}

/**
 * Message sent from background process when a result is found
 */
export interface ScrapingResultFoundMessage extends BaseBackgroundMessage {
  type: "SCRAPING_RESULT_FOUND";
  result: {
    businessName?: string;
    [key: string]: any;
  };
}

/**
 * Message sent from background process when rate limited
 */
export interface ScrapingRateLimitedMessage extends BaseBackgroundMessage {
  type: "SCRAPING_RATE_LIMITED";
}

/**
 * Message sent from background process when CAPTCHA is detected
 */
export interface ScrapingCaptchaDetectedMessage extends BaseBackgroundMessage {
  type: "SCRAPING_CAPTCHA_DETECTED";
}

/**
 * Message sent from background process when Cloudflare protection is detected.
 * Only sent after AI support bypass was attempted (if enabled) and failed; the task will then pause.
 */
export interface ScrapingCloudflareDetectedMessage
  extends BaseBackgroundMessage {
  type: "SCRAPING_CLOUDFLARE_DETECTED";
  details: {
    url: string;
    timestamp: string;
    userAgent?: string;
    ipAddress?: string;
    additionalInfo?: string;
  };
}

/**
 * Message sent from main process to pause a task
 */
export interface PauseTaskMessage extends BaseBackgroundMessage {
  type: "PAUSE";
}

/**
 * Message sent from main process to resume a task
 */
export interface ResumeTaskMessage extends BaseBackgroundMessage {
  type: "RESUME";
}

/**
 * Message sent from background process when task is paused
 */
export interface TaskPausedMessage extends BaseBackgroundMessage {
  type: "TASK_PAUSED";
}

/**
 * Message sent from background process when task is resumed
 */
export interface TaskResumedMessage extends BaseBackgroundMessage {
  type: "TASK_RESUMED";
}

/**
 * Message sent from background process when scraping is paused due to Cloudflare
 */
export interface ScrapingPausedCloudflareMessage extends BaseBackgroundMessage {
  type: "SCRAPING_PAUSED_CLOUDFLARE";
  details: {
    url: string;
    timestamp: string;
    userAgent?: string;
    ipAddress?: string;
    additionalInfo?: string;
  };
}

/**
 * Message sent from background process when robot verification challenge is detected
 */
export interface ScrapingRobotVerificationDetectedMessage
  extends BaseBackgroundMessage {
  type: "SCRAPING_ROBOT_VERIFICATION_DETECTED";
  details: {
    url: string;
    timestamp: string;
    userAgent?: string;
    ipAddress?: string;
    additionalInfo?: string;
  };
}

/**
 * Message sent from main process to request graceful exit
 */
export interface ExitTaskMessage extends BaseBackgroundMessage {
  type: "EXIT";
  reason: string;
}

export type AiSupportRequestType =
  | "step_guidance"
  | "contact_extraction"
  | "observe_execute";

/**
 * Executable action for observe-execute (from AI observe response)
 */
export interface AiExecutableAction {
  action_id: string;
  type: string;
  selector?: string;
  selector_type?: string;
  value?: string;
  key?: string;
  timeout?: number;
  description?: string;
}

/**
 * Observe-execute response data (actions or status)
 */
export interface AiObserveExecuteResponseData {
  session_id: string;
  status: "actions_needed" | "goal_achieved" | "give_up";
  actions: AiExecutableAction[];
  explanation: string;
  confidence: number;
  should_retry: boolean;
  max_iterations_remaining: number;
  model_used?: string;
  processing_time?: number;
}

/**
 * AI-extracted contact data returned from the server
 */
export interface AiExtractedContactData {
  emails: string[];
  phones: string[];
  address?: string;
  socialLinks?: string[];
  confidence?: number;
}

/**
 * AI scraping guidance data returned from the server
 */
export interface AiScrapeGuidanceData {
  suggestedSelectors: Record<string, string>;
  suggestedActions: string[];
  shouldSkip: boolean;
  explanation: string;
}

/** Result of one executed action (for observe_execute previous results) */
export interface AiObserveActionResult {
  action_id: string;
  success: boolean;
  error?: string;
  element_found?: boolean;
  screenshot_after?: string;
  url_before?: string;
  url_after?: string;
  title_before?: string;
  title_after?: string;
  selector_count_after?: number;
}

/**
 * Message sent from child process to request AI support
 */
export interface AiSupportRequestMessage extends BaseBackgroundMessage {
  type: "AI_SUPPORT_REQUEST";
  requestId: string;
  requestType: AiSupportRequestType;
  pageContent: string;
  screenshot?: string;
  pageUrl: string;
  businessName?: string;
  stepContext?: string;
  errorInfo?: string;
  platformName?: string;
  selectorsTried?: Record<string, string>;
  /** observe_execute: goal and loop state */
  goal?: string;
  sessionId?: string | null;
  previousActionResults?: AiObserveActionResult[];
  iteration?: number;
  selectorsAvailable?: Record<string, string>;
  /** override max iterations (e.g. 8 for Cloudflare) */
  maxIterations?: number;
  /** context hint, e.g. "cloudflare" for Cloudflare challenge pages */
  goalContext?: string;
}

/**
 * Message sent from main process back to child with AI results
 */
export interface AiSupportResponseMessage extends BaseBackgroundMessage {
  type: "AI_SUPPORT_RESPONSE";
  requestId: string;
  success: boolean;
  requestType: AiSupportRequestType;
  data?:
    | AiExtractedContactData
    | AiScrapeGuidanceData
    | AiObserveExecuteResponseData;
  errorMessage?: string;
}

/**
 * Union type for all possible background process messages
 */
export type BackgroundProcessMessage =
  | StartTaskMessage
  | ProgressMessage
  | CompletedMessage
  | ErrorMessage
  | ScrapingStartedMessage
  | ScrapingPageCompleteMessage
  | ScrapingResultFoundMessage
  | ScrapingRateLimitedMessage
  | ScrapingCaptchaDetectedMessage
  | ScrapingCloudflareDetectedMessage
  | ScrapingPausedCloudflareMessage
  | ScrapingRobotVerificationDetectedMessage
  | PauseTaskMessage
  | ResumeTaskMessage
  | TaskPausedMessage
  | TaskResumedMessage
  | ExitTaskMessage
  | AiSupportRequestMessage
  | AiSupportResponseMessage;

/**
 * Type guard to check if a message is a StartTaskMessage
 */
export function isStartTaskMessage(message: any): message is StartTaskMessage {
  return (
    message &&
    message.type === "START" &&
    message.taskData &&
    message.platformInfo
  );
}

/**
 * Type guard to check if a message is a ProgressMessage
 */
export function isProgressMessage(message: any): message is ProgressMessage {
  return message && message.type === "PROGRESS" && message.progress;
}

/**
 * Type guard to check if a message is a CompletedMessage
 */
export function isCompletedMessage(message: any): message is CompletedMessage {
  return message && message.type === "COMPLETED" && message.results;
}

/**
 * Type guard to check if a message is an ErrorMessage
 */
export function isErrorMessage(message: any): message is ErrorMessage {
  return message && message.type === "ERROR" && message.error;
}

/**
 * Type guard to check if a message is a ScrapingCloudflareDetectedMessage
 */
export function isScrapingCloudflareDetectedMessage(
  message: any
): message is ScrapingCloudflareDetectedMessage {
  return (
    message &&
    message.type === "SCRAPING_CLOUDFLARE_DETECTED" &&
    message.details
  );
}

/**
 * Type guard to check if a message is a ScrapingPausedCloudflareMessage
 */
export function isScrapingPausedCloudflareMessage(
  message: any
): message is ScrapingPausedCloudflareMessage {
  return (
    message && message.type === "SCRAPING_PAUSED_CLOUDFLARE" && message.details
  );
}

/**
 * Type guard to check if a message is a ScrapingRobotVerificationDetectedMessage
 */
export function isScrapingRobotVerificationDetectedMessage(
  message: any
): message is ScrapingRobotVerificationDetectedMessage {
  return (
    message &&
    message.type === "SCRAPING_ROBOT_VERIFICATION_DETECTED" &&
    message.details
  );
}

/**
 * Type guard to check if a message is an AiSupportRequestMessage
 */
export function isAiSupportRequestMessage(
  message: unknown
): message is AiSupportRequestMessage {
  const msg = message as Record<string, unknown>;
  return (
    msg != null &&
    msg.type === "AI_SUPPORT_REQUEST" &&
    typeof msg.requestId === "string" &&
    typeof msg.requestType === "string"
  );
}

/**
 * Type guard to check if a message is an AiSupportResponseMessage
 */
export function isAiSupportResponseMessage(
  message: unknown
): message is AiSupportResponseMessage {
  const msg = message as Record<string, unknown>;
  return (
    msg != null &&
    msg.type === "AI_SUPPORT_RESPONSE" &&
    typeof msg.requestId === "string"
  );
}
