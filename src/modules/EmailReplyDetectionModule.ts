import { BaseModule } from "@/modules/baseModule";
import {
  EmailReplyDetectionService,
  getSharedEmailReplyDetectionService,
  type ReplyDetectionResult,
} from "@/service/emailReceive/EmailReplyDetectionService";
import type { CheckEmailRepliedResult } from "@/service/emailReceive/EmailReplyDetectionTypes";

/**
 * Thin BaseModule facade over {@link EmailReplyDetectionService} (FR-031).
 *
 * IPC handlers and AI tools call this — never the service or model directly.
 * The service is resolved lazily (never at module-eval time) so that
 * `vi.mock` of `BaseDb`/`Token` in tests does not hit the BaseModule TDZ at
 * import time. Production callers route through the process-wide shared
 * singleton (D6) so the in-memory cache/single-flight/mailbox-lock state
 * survives across per-request Module instances; tests inject a custom-built
 * service through the constructor seam, which takes precedence.
 */
export class EmailReplyDetectionModule extends BaseModule {
  /**
   * Constructor-injected service (test seam). When set, it wins over the
   * shared singleton. Not cached beyond the constructor: the shared getter is
   * the production path, and caching a fallback here would re-introduce the
   * per-Module-instance bug D6 fixes (the Module is constructed per IPC call).
   */
  private readonly injectedService: EmailReplyDetectionService | null = null;

  constructor(options?: {
    service?: EmailReplyDetectionService;
  }) {
    super();
    // The auto-commit rule + lazy-getter landmine (CLAUDE.md) forbids
    // `new SomeModule()` at module top level. Storing the injected service
    // here (runtime) is safe; tests pass an explicit service.
    if (options?.service) {
      this.injectedService = options.service;
    }
  }

  /**
   * Resolve the detection service. Constructor-injected seam wins (tests);
   * production falls back to the process-wide shared singleton (D6) so the
   * cache/single-flight/mailbox-lock state is shared across Module instances.
   */
  private getService(): EmailReplyDetectionService {
    return this.injectedService ?? getSharedEmailReplyDetectionService();
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
