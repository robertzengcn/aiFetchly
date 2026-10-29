import { getIpcTransport } from "./ipcTransport";
import type { Iresponse } from "@/views/api/types";

// NOTE: `data` is intentionally typed `any` at this boundary to preserve the
// historical contract — hundreds of call sites assign windowInvoke's return
// directly to concrete types. Tightening to `unknown` is a cross-cutting
// refactor outside the dev-browser-bridge scope. The transport layer itself
// (ipcTransport.ts) is fully typed and avoids `any`.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * B12: typed IPC failure error. Thrown by windowInvoke / windowInvokeBinary
 * when the IPC envelope reports `status:false`. Carries the structured
 * failure fields (code / existing_draft_id / next_action / requestCorrelationId)
 * the validated-IPC catch copied off a typed service error, so the renderer
 * can branch on `code` instead of parsing the leading `[code]` bracket out of
 * `message`.
 *
 * Extends Error so the hundreds of existing catch sites that read `e.message`
 * continue to work unchanged. The structured fields are pure additions.
 */
export class IpcRequestError extends Error {
  readonly code?: string;
  readonly existing_draft_id?: number;
  readonly next_action?: string;
  readonly requestCorrelationId?: string;

  constructor(
    message: string,
    fields: {
      readonly code?: string;
      readonly existing_draft_id?: number;
      readonly next_action?: string;
      readonly requestCorrelationId?: string;
    } = {}
  ) {
    super(message);
    this.name = "IpcRequestError";
    this.code = fields.code;
    this.existing_draft_id = fields.existing_draft_id;
    this.next_action = fields.next_action;
    this.requestCorrelationId = fields.requestCorrelationId;
  }
}

function toIpcRequestError(result: Iresponse): IpcRequestError {
  return new IpcRequestError(result.msg, {
    code: result.code,
    existing_draft_id: result.existing_draft_id,
    next_action: result.next_action,
    requestCorrelationId: result.requestCorrelationId,
  });
}

export const windowInvoke = async (channel: string, data?: object) => {
  // console.log(data)
  // campaign:list
  const result = (await getIpcTransport().invoke(channel, data)) as
    | Iresponse
    | undefined;
  if (!result) {
    throw new Error("unknow error");
  }
  // console.log(result)
  if (!result.status) {
    // B12: throw a typed IpcRequestError so callers can read structured
    // fields (code / existing_draft_id / next_action / requestCorrelationId)
    // instead of parsing the leading [code] bracket out of msg.
    throw toIpcRequestError(result);
  }
  return result.data;
};

// Special method for binary data that doesn't use JSON.stringify
export const windowInvokeBinary = async (channel: string, data?: any) => {
  const result = (await getIpcTransport().invokeBinary(channel, data)) as
    | Iresponse
    | undefined;
  if (!result) {
    throw new Error("unknow error");
  }
  if (!result.status) {
    // B12: same typed-error path as windowInvoke.
    throw toIpcRequestError(result);
  }
  return result.data;
};
//send async message
export const windowSend = async (channel: string, data?: object) => {
  getIpcTransport().send(channel, data);
};

//send binary data async message (without JSON.stringify)
export const windowSendBinary = async (channel: string, data?: any) => {
  getIpcTransport().sendBinary(channel, data);
};

//receive async message
export const windowReceive = <T = unknown>(
  channel: string,
  cb: (value: T) => void
): ((value: T) => void) => {
  const listener = (evnet: T): void => {
    // console.log(evnet)
    //console.log(evnet.data)
    cb(evnet);
  };
  getIpcTransport().receive(channel, listener as (value: unknown) => void);
  return listener;
};

export const windowRemoveListener = (
  channel: string,
  cb: (value: unknown) => void
) => {
  getIpcTransport().removeListener(channel, cb);
};

export const windowRemoveAllListeners = (channel: string) => {
  getIpcTransport().removeAllListeners(channel);
};
