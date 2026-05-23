import { windowInvoke } from "@/views/utils/apirequest";
import {
  EMAILMARKETINGTEMPLIST,
  EMAILMARKETINGTEMPDETAIL,
  EMAILMARKETINGTEMPREMOVE,
  EMAILMARKETINGTEMPPREVIEW,
  EMAILMARKETINGTEMPUPDATE,
} from "@/config/channellist";
import { SearchResult } from "@/views/api/types";
import {
  EmailTemplateRespdata,
  EmailTemplatePreviewdata,
  AIEmailTemplateRequest,
  AIEmailTemplateResponse,
} from "@/entityTypes/emailmarketingType";
import {
  ItemSearchparam,
  CommonIdrequest,
  ListData,
} from "@/entityTypes/commonType";
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity";
import {
  AI_EMAIL_TEMPLATE_GENERATE_STREAM,
  AI_EMAIL_TEMPLATE_GENERATE_CHUNK,
  AI_EMAIL_TEMPLATE_GENERATE_COMPLETE,
  AI_EMAIL_TEMPLATE_ERROR,
  AI_EMAIL_TEMPLATE_STOP,
} from "@/config/channellist";

/** Callbacks for AI email template streaming (all optional). Only these are used for IPC; no window.api in views. */
export interface AIEmailTemplateStreamCallbacks {
  onChunk?: (chunkData: {
    type: string;
    content: string;
    fullContent: string;
  }) => void;
  onComplete?: (response: {
    type: string;
    status: boolean;
    data: AIEmailTemplateResponse;
  }) => void;
  onError?: (error: { type: string; status: boolean; msg: string }) => void;
}

export async function getEmailtemplatelist(
  data: ItemSearchparam
): Promise<SearchResult<EmailTemplateRespdata>> {
  const resp = (await windowInvoke(
    EMAILMARKETINGTEMPLIST,
    data
  )) as ListData<EmailTemplateRespdata>;

  if (!resp) {
    throw new Error("unknow error");
  }

  const resdata: SearchResult<EmailTemplateRespdata> = {
    data: resp.records,
    total: resp.num,
  };
  return resdata;
}
//get email template by id
export async function getEmailtemplatebyid(
  id: string
): Promise<EmailTemplateRespdata> {
  const resp = (await windowInvoke(EMAILMARKETINGTEMPDETAIL, {
    id: id,
  })) as EmailTemplateRespdata;
  if (!resp) {
    throw new Error("unknow error");
  }
  return resp;
}
//update template
export async function updateEmailtemplate(
  data: EmailTemplateRespdata
): Promise<CommonIdrequest<number>> {
  const resp = await windowInvoke(EMAILMARKETINGTEMPUPDATE, data);
  if (!resp) {
    throw new Error("unknow error");
  }
  return resp;
}
//remove email marketing
export async function removeEmailtemplate(
  id: number
): Promise<CommonIdrequest<number>> {
  const resp = await windowInvoke(EMAILMARKETINGTEMPREMOVE, { id: id });
  if (!resp) {
    throw new Error("unknow error");
  }
  return resp;
}
//submit email preview data
export async function submitEmailPreview(
  data: EmailTemplatePreviewdata
): Promise<number> {
  const resp = await windowInvoke(EMAILMARKETINGTEMPPREVIEW, data);
  if (!resp) {
    throw new Error("unknow error");
  }
  return resp;
}

/**
 * Generate an email template using AI.
 * All IPC (send/receive/removeListener) is contained here; views must not use window.api for this feature.
 *
 * @param data - AI email template generation request
 * @param callbacksOrOnChunk - Callbacks object (onChunk, onComplete, onError) or legacy onChunk function
 * @returns Promise<AIEmailTemplateResponse> - Resolves with generated template on success
 */
export async function generateAIEmailTemplate(
  data: AIEmailTemplateRequest,
  callbacksOrOnChunk?:
    | AIEmailTemplateStreamCallbacks
    | ((chunkData: {
        type: string;
        content: string;
        fullContent: string;
      }) => void)
): Promise<AIEmailTemplateResponse> {
  const callbacks: AIEmailTemplateStreamCallbacks =
    typeof callbacksOrOnChunk === "function"
      ? { onChunk: callbacksOrOnChunk }
      : callbacksOrOnChunk ?? {};

  const { onChunk, onComplete, onError } = callbacks;

  return new Promise((resolve, reject) => {
    // Preload passes only the payload (one arg), not (event, payload)
    const handleChunk = (chunkData: {
      type: string;
      content: string;
      fullContent: string;
    }): void => {
      onChunk?.(chunkData);
    };

    const handleComplete = (response: {
      type: string;
      status: boolean;
      data: AIEmailTemplateResponse;
    }): void => {
      onComplete?.(response);
      if (response.status && response.data) {
        resolve(response.data);
      } else {
        reject(new Error("Generation failed"));
      }
      cleanup();
    };

    const handleError = (error: {
      type: string;
      status: boolean;
      msg: string;
    }): void => {
      onError?.(error);
      reject(new Error(error.msg || "Generation failed"));
      cleanup();
    };

    const cleanup = (): void => {
      if (window.api) {
        window.api.removeListener(
          AI_EMAIL_TEMPLATE_GENERATE_CHUNK,
          handleChunk
        );
        window.api.removeListener(
          AI_EMAIL_TEMPLATE_GENERATE_COMPLETE,
          handleComplete
        );
        window.api.removeListener(AI_EMAIL_TEMPLATE_ERROR, handleError);
      }
    };

    if (window.api) {
      window.api.receive(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, handleChunk);
      window.api.receive(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, handleComplete);
      window.api.receive(AI_EMAIL_TEMPLATE_ERROR, handleError);
    }

    try {
      window.api?.send(AI_EMAIL_TEMPLATE_GENERATE_STREAM, data);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/**
 * Stop ongoing AI email template generation.
 * All IPC (send) is in this API module; views must not use window.api for this feature.
 */
export function stopAIEmailTemplateGeneration(): void {
  if (window.api) {
    window.api.send(AI_EMAIL_TEMPLATE_STOP, {});
  }
}
