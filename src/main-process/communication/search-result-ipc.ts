import {
  ANALYZE_WEBSITE,
  ANALYZE_WEBSITE_PROGRESS,
} from "@/config/channellist";
import { WebsiteAnalysisService } from "@/service/WebsiteAnalysisService";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { analyzeWebsiteBatchInputSchema } from "@/schemas/ipc/searchResult";

interface QueueProgress {
  completed: number;
  total: number;
  current?: string;
}

/**
 * Register IPC handlers for search result operations.
 *
 * ANALYZE_WEBSITE now goes through registerValidatedHandler:
 *  - input validated by analyzeWebsiteBatchInputSchema (zod) at boundary
 *  - removes manual "items array non-empty" + "clientBusiness non-empty" guards
 *  - schema guarantees every item has a positive int resultId, so the
 *    original filter step is gone
 *  - handler returns ONLY the data payload; the wrapper wraps it in
 *    {status: true, msg: 'ok', data: <return value>}, matching the
 *    pre-refactor envelope so the frontend is unchanged
 */
export function registerSearchResultIpcHandlers(): void {
  registerValidatedHandler(
    ANALYZE_WEBSITE,
    analyzeWebsiteBatchInputSchema,
    async (input, event) => {
      const resultIds = input.items.map((item) => item.resultId);

      let batchId: string | null = null;
      const progressCallback = (progress: QueueProgress): void => {
        if (batchId) {
          event.sender.send(
            ANALYZE_WEBSITE_PROGRESS,
            JSON.stringify({ batchId, ...progress })
          );
        }
      };

      const batchInfo = await WebsiteAnalysisService.startBatchAnalysis({
        resultIds,
        clientBusiness: input.clientBusiness,
        temperature: input.temperature,
        onProgress: progressCallback,
      });

      batchId = batchInfo.batchId;

      // Wrapper wraps this in the standard {status, msg, data} envelope.
      return {
        batchId: batchInfo.batchId,
        total: batchInfo.total,
      };
    }
  );
}
