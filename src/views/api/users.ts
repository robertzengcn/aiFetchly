"use strict";
export {};
import { Iresponse } from "@/views/api/types";
import {
  windowInvoke,
  windowSend,
  windowReceive,
} from "@/views/utils/apirequest";
import { getIpcTransport, type InvokeResult } from "@/views/utils/ipcTransport";
import {
  QUERY_USER_INFO,
  GET_LOGIN_URL,
  USER_SIGNOUT,
  USER_LOGIN,
} from "@/config/channellist";
import { UserInfoType } from "@/entityTypes/userType";
import { OPENLOGINPAGE } from "@/config/channellist";
import { NativateDatatype } from "@/entityTypes/commonType";

// export const getUsers = (params: any) =>
//   request({
//     url: '/users',
//     method: 'get',
//     params
//   })

function requireIpcResponse(
  channel: string,
  result: InvokeResult | undefined
): Iresponse {
  if (!result) {
    throw new Error(`${channel} returned no response`);
  }
  return result as Iresponse;
}

export const getUserInfo = async (): Promise<Iresponse> => {
  const result = await getIpcTransport().invoke(QUERY_USER_INFO);
  return requireIpcResponse(QUERY_USER_INFO, result);
};

export const login = async (data: {
  username: string;
  password: string;
}): Promise<Iresponse> => {
  const result = requireIpcResponse(
    USER_LOGIN,
    await getIpcTransport().invoke(USER_LOGIN, data)
  );
  console.log(result);
  return result;
};
// request({
//   url: '/user/login',
//   method: 'post',
//   data
// })

export const Signout = async () => await windowInvoke(USER_SIGNOUT);

export async function GetloginUserInfo(): Promise<UserInfoType> {
  const res = await windowInvoke(QUERY_USER_INFO);
  return res;
}

//create a function send message to backend to open page from brow
export const openPage = async () => {
  await windowSend(OPENLOGINPAGE);
};

export function receiveRedirectevent(
  channel: string,
  cb: (data: NativateDatatype) => void
) {
  console.log("receive redirect event");
  windowReceive(channel, cb);
}

// Function to get login URL from backend controller
export async function getLoginUrl(): Promise<string> {
  const response = await windowInvoke(GET_LOGIN_URL);
  //if (response.status && response.data) {
  console.log(response);
  return response;
  // } else {
  //   throw new Error(response.msg || 'Failed to get login URL')
  // }
}
