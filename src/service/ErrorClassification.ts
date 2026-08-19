/**
 * Error classification utilities for better error recovery and handling
 */

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  NETWORK = "network",
  VALIDATION = "validation",
  EXECUTION = "execution",
  TIMEOUT = "timeout",
  RESOURCE = "resource",
  PERMISSION = "permission",
  UNKNOWN = "unknown",
}

/**
 * Recovery strategy for different error types
 */
export enum RecoveryStrategy {
  RETRY = "retry",
  SKIP = "skip",
  ABORT = "abort",
  FALLBACK = "fallback",
  CONTINUE = "continue",
}

/**
 * Classified error information
 */
export interface ClassifiedError {
  originalError: Error;
  category: ErrorCategory;
  severity: ErrorSeverity;
  recoveryStrategy: RecoveryStrategy;
  isRecoverable: boolean;
  context?: string;
}

/**
 * Error classification utility
 */
export class ErrorClassifier {
  /**
   * Classify an error for appropriate handling
   */
  static classify(error: Error, context?: string): ClassifiedError {
    const errorMessage = error.message.toLowerCase();
    const errorStack = error.stack?.toLowerCase() || "";

    // Network errors
    if (this.isNetworkError(errorMessage, errorStack)) {
      return {
        originalError: error,
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.MEDIUM,
        recoveryStrategy: RecoveryStrategy.RETRY,
        isRecoverable: true,
        context,
      };
    }

    // Timeout errors
    if (this.isTimeoutError(errorMessage, errorStack)) {
      return {
        originalError: error,
        category: ErrorCategory.TIMEOUT,
        severity: ErrorSeverity.MEDIUM,
        recoveryStrategy: RecoveryStrategy.RETRY,
        isRecoverable: true,
        context,
      };
    }

    // Validation errors
    if (this.isValidationError(errorMessage, errorStack)) {
      return {
        originalError: error,
        category: ErrorCategory.VALIDATION,
        severity: ErrorSeverity.LOW,
        recoveryStrategy: RecoveryStrategy.ABORT,
        isRecoverable: false,
        context,
      };
    }

    // Permission errors
    if (this.isPermissionError(errorMessage, errorStack)) {
      return {
        originalError: error,
        category: ErrorCategory.PERMISSION,
        severity: ErrorSeverity.HIGH,
        recoveryStrategy: RecoveryStrategy.ABORT,
        isRecoverable: false,
        context,
      };
    }

    // Resource errors
    if (this.isResourceError(errorMessage, errorStack)) {
      return {
        originalError: error,
        category: ErrorCategory.RESOURCE,
        severity: ErrorSeverity.HIGH,
        recoveryStrategy: RecoveryStrategy.ABORT,
        isRecoverable: false,
        context,
      };
    }

    // Execution errors
    if (this.isExecutionError(errorMessage, errorStack)) {
      return {
        originalError: error,
        category: ErrorCategory.EXECUTION,
        severity: ErrorSeverity.MEDIUM,
        recoveryStrategy: RecoveryStrategy.SKIP,
        isRecoverable: true,
        context,
      };
    }

    // Unknown errors - treat as potentially recoverable with caution
    return {
      originalError: error,
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      recoveryStrategy: RecoveryStrategy.CONTINUE,
      isRecoverable: false,
      context,
    };
  }

  /**
   * Check if error is network-related
   */
  private static isNetworkError(message: string, stack: string): boolean {
    // Message-level network signals. 'request' and 'timeout' are intentionally
    // excluded: 'timeout' has its own category, and both are too generic — they
    // caused most errors to be misclassified as network.
    const networkMessageKeywords = [
      "network",
      "connection",
      "fetch",
      "socket",
      "econnrefused",
      "enotfound",
      "econnreset",
      "etimedout",
    ];
    // Only unambiguous errno codes are matched against the stack. Matching
    // generic words against the stack catches Node/vitest internals
    // (node:internal/process, 'fetch', 'connection') and misclassifies.
    const networkStackCodes = [
      "econnrefused",
      "enotfound",
      "econnreset",
      "etimedout",
    ];

    return (
      networkMessageKeywords.some((keyword) => message.includes(keyword)) ||
      networkStackCodes.some((code) => stack.includes(code))
    );
  }

  /**
   * Check if error is timeout-related
   */
  private static isTimeoutError(message: string, stack: string): boolean {
    const timeoutKeywords = [
      "timeout",
      "timed out",
      "time out",
      "deadline",
      "exceeded",
    ];

    return timeoutKeywords.some((keyword) => message.includes(keyword));
  }

  /**
   * Check if error is validation-related
   */
  private static isValidationError(message: string, stack: string): boolean {
    const validationKeywords = [
      "validation",
      "invalid",
      "required",
      "missing",
      "malformed",
      "schema",
      "type",
    ];

    return validationKeywords.some((keyword) => message.includes(keyword));
  }

  /**
   * Check if error is permission-related
   */
  private static isPermissionError(message: string, stack: string): boolean {
    const permissionKeywords = [
      "permission",
      "unauthorized",
      "forbidden",
      "access denied",
      "eacces",
      "eperm",
    ];

    return permissionKeywords.some(
      (keyword) => message.includes(keyword) || stack.includes(keyword)
    );
  }

  /**
   * Check if error is resource-related
   */
  private static isResourceError(message: string, stack: string): boolean {
    const resourceKeywords = [
      "memory",
      "disk space",
      "out of memory",
      "oom",
      "resource",
      "quota",
      "limit",
    ];

    return resourceKeywords.some((keyword) => message.includes(keyword));
  }

  /**
   * Check if error is execution-related
   */
  private static isExecutionError(message: string, stack: string): boolean {
    // Bare 'process' is excluded: it appears in every Node stack
    // (node:internal/process/...), so matching it against the stack classified
    // nearly every error as execution. 'child process' is specific enough.
    const executionKeywords = [
      "execution",
      "failed to execute",
      "child process",
      "spawn",
      "fork",
    ];

    return executionKeywords.some(
      (keyword) => message.includes(keyword) || stack.includes(keyword)
    );
  }

  /**
   * Get human-readable error description
   */
  static getErrorDescription(classifiedError: ClassifiedError): string {
    const { category, severity, recoveryStrategy } = classifiedError;

    const categoryDesc = this.getCategoryDescription(category);
    const severityDesc = this.getSeverityDescription(severity);
    const recoveryDesc = this.getRecoveryDescription(recoveryStrategy);

    return `${severityDesc} ${categoryDesc}. ${recoveryDesc}`;
  }

  /**
   * Get category description
   */
  private static getCategoryDescription(category: ErrorCategory): string {
    switch (category) {
      case ErrorCategory.NETWORK:
        return "Network error";
      case ErrorCategory.TIMEOUT:
        return "Timeout error";
      case ErrorCategory.VALIDATION:
        return "Validation error";
      case ErrorCategory.PERMISSION:
        return "Permission error";
      case ErrorCategory.RESOURCE:
        return "Resource error";
      case ErrorCategory.EXECUTION:
        return "Execution error";
      default:
        return "Unknown error";
    }
  }

  /**
   * Get severity description
   */
  private static getSeverityDescription(severity: ErrorSeverity): string {
    switch (severity) {
      case ErrorSeverity.LOW:
        return "Minor";
      case ErrorSeverity.MEDIUM:
        return "Moderate";
      case ErrorSeverity.HIGH:
        return "Severe";
      case ErrorSeverity.CRITICAL:
        return "Critical";
      default:
        return "Unknown";
    }
  }

  /**
   * Get recovery strategy description
   */
  private static getRecoveryDescription(strategy: RecoveryStrategy): string {
    switch (strategy) {
      case RecoveryStrategy.RETRY:
        return "Will retry the operation";
      case RecoveryStrategy.SKIP:
        return "Will skip this step and continue";
      case RecoveryStrategy.ABORT:
        return "Cannot recover - aborting operation";
      case RecoveryStrategy.FALLBACK:
        return "Will attempt alternative approach";
      case RecoveryStrategy.CONTINUE:
        return "Will continue with caution";
      default:
        return "Recovery strategy unknown";
    }
  }
}
