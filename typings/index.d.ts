// import { userResponse } from '@/controller/user_controller'
/* eslint-disable no-var */
declare function getVersion(version: string): void;
declare const createObjectURL: any;
declare const frontendVersion: string;
export type userResp={
    status: boolean,
    msg: string,
    data?: jwtUser,
}

declare module 'vue3-drag-resize' {
    const content: {
        isActive: boolean;
        h: number;
        w: number;
    };
    export = content;
}

export interface IElectronAPI {
    userLogin: (data) => Promise<userResp>,
    send: (channel: string, data: any) => void
    receive: (channel: string, func: (event, ...args) => void) => void
    invoke: (channel: string, data?: any) => Promise<any>
  }
  
declare global {
    interface Window {
      electronAPI: IElectronAPI
      api: IElectronAPI
    }
  }
