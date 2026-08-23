import { getIpcTransport } from "./ipcTransport";
import type { Iresponse } from "@/views/api/types";

// NOTE: `data` is intentionally typed `any` at this boundary to preserve the
// historical contract — hundreds of call sites assign windowInvoke's return
// directly to concrete types. Tightening to `unknown` is a cross-cutting
// refactor outside the dev-browser-bridge scope. The transport layer itself
// (ipcTransport.ts) is fully typed and avoids `any`.
/* eslint-disable @typescript-eslint/no-explicit-any */

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
    throw new Error(result.msg);
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
    throw new Error(result.msg);
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
