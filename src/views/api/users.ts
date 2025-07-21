'use strict';
export {};
//const {ipcRenderer: ipc} = require('electron-better-ipc');
// import request from '@/views/utils/request'
// import {ipcRenderer as ipc} from 'electron-better-ipc'
import {Iresponse} from '@/views/api/types'
import {windowInvoke,windowSend,windowReceive} from '@/views/utils/apirequest'
import {QUERY_USER_INFO, GET_LOGIN_URL} from "@/config/channellist";
import {UserInfoType} from "@/entityTypes/userType"
import {OPENLOGINPAGE} from "@/config/channellist";
import {NativateDatatype} from "@/entityTypes/commonType"

// export const getUsers = (params: any) =>
//   request({
//     url: '/users',
//     method: 'get',
//     params
//   })

export const getUserInfo = () =>
(async () => {
  const result:Iresponse =await window.api.invoke("user:checklogin")
  // console.log(result);
  return result as Iresponse;
})();
  
export const login = (data: any) =>
(async () => {
  const result =await window.api.invoke("user:Login", data)
  console.log(result);
  return result;
})();
  // request({
  //   url: '/user/login',
  //   method: 'post',
  //   data
  // })

export const Signout = async() =>
await windowInvoke("user:Signout")

export async function GetloginUserInfo():Promise<UserInfoType>{
    const res=await windowInvoke(QUERY_USER_INFO)
    return res
}

//create a function send message to backend to open page from brow
export const openPage = async() => {
  await windowSend(OPENLOGINPAGE)
}

export function receiveRedirectevent(channel:string,cb:(data:NativateDatatype)=>void){
   
  windowReceive(channel,cb)
}

// Function to get login URL from backend controller
export async function getLoginUrl(): Promise<string> {
  const response = await windowInvoke(GET_LOGIN_URL)
  //if (response.status && response.data) {
  console.log(response)  
  return response
  // } else {
  //   throw new Error(response.msg || 'Failed to get login URL')
  // }
}
