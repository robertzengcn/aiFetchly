import { BaseModule } from "@/modules/baseModule";
import {
  EmailReplyDetectionService,
  type ReplyDetectionResult,
} from "@/service/emailReceive/EmailReplyDetectionService";
import type { CheckEmailRepliedResult } from "@/service/emailReceive/EmailReplyDetectionTypes";

/**
 * Thin BaseModule facade over {@link EmailReplyDetectionService} (FR-031).
 *
 * IPC handlers and AI tools call this — never the service or model directly.
 * The service is constructed lazily through a memoized getter (never at
 * module-eval time) so that `vi.mock` of `BaseDb`/`Token` in tests does not
 * hit the BaseModule TDZ at import time. Production callers get the real
 * default ports; tests inject a custom-built service through the constructor
 * seam.
 */
export class EmailReplyDetectionModule extends BaseModule {
  private cachedService: EmailReplyDetectionService | null = null;

  constructor(options?: {
    service?: EmailReplyDetectionService;
  }) {
    super();
    // The auto-commit rule + lazy-getter landmine (CLAUDE.md) forbids
    // `new SomeModule()` at module top level. Constructing the service here
    // in the constructor (runtime) is safe; tests pass an explicit service.
    if (options?.service) {
      this.cachedService = options.service;
    }
  }

  /** Lazily resolve the detection service (production default ports). */
  private getService(): EmailReplyDetectionService {
    if (!this.cachedService) {
      this.cachedService = new EmailReplyDetectionService();
    }
    return this.cachedService;
  }

  /**
   * Run the full §7.1 detection algorithm. Returns the typed three-state
   * {@link ReplyDetectionResult}; never writes refusal audit rows.
   */
  async detect(input: {
    messageId: number;
    forceRefresh?: boolean;
  }): Promise<ReplyDetectionResult> {
    try {
      await this.ensureConnection();
      return await this.getService().detect(input);
    } catch (error) {
      console.error("Error detecting reply state:", error);
      throw error;
    }
  }

  /**
   * Tool/IPC-facing wrapper (FR-032): runs detection and maps the result to
   * the snake_case {@link CheckEmailRepliedResult} DTO. Ordinary cache
   * behavior (no forceRefresh) per §7.3.
   */
  async checkReply(input: {
    messageId: number;
    forceRefresh?: boolean;
  }): Promise<{
    success: boolean;
    error?: string;
    result?: CheckEmailRepliedResult;
  }> {
    try {
      await this.ensureConnection();
      return await this.getService().checkReply(input);
    } catch (error) {
      console.error("Error checking email replied:", error);
      throw error;
    }
  }
}
