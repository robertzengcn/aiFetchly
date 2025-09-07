import { ipcMain } from 'electron';
import {QUERY_USER_INFO,OPENLOGINPAGE,GET_LOGIN_URL,USER_SIGNOUT} from '@/config/channellist'
import { UserController } from '@/controller/UserController'
import { User } from '@/modules/user'
import {UserInfoType} from "@/entityTypes/userType"
import { CommonMessage } from "@/entityTypes/commonType"
export function registerUserIpcHandlers() {
        
    ipcMain.handle(QUERY_USER_INFO, async (event, data) => {
        const userControll = new UserController()
        const res=userControll.getUserInfo()
        const result: CommonMessage<UserInfoType> = {
                        status: true,
                        msg: "",
                        data: res
                    }
                    return result;
    })
    
    ipcMain.handle(GET_LOGIN_URL, async (event, data) => {
        try {
            const userControll = new UserController()
            const loginUrl = userControll.getLoginPageUrl()
            const result: CommonMessage<string> = {
                status: true,
                msg: "Login URL retrieved successfully",
                data: loginUrl
            }
            return result;
        } catch (error) {
            console.error("Error getting login URL:", error)
            const result: CommonMessage<string> = {
                status: false,
                msg: error instanceof Error ? error.message : "Failed to get login URL",
                data: ""
            }
            return result;
        }
    })
    
    ipcMain.on(OPENLOGINPAGE, async (event, data) => {

        // open login page from browser
        try {
            const userControll = new UserController()
            await userControll.openLoginPage()
            return {
            status: true,
            msg: "Login page opened successfully",
            data: null
            } as CommonMessage<null>
        } catch (error) {
            console.error("Error opening login page:", error)
            return {
            status: false,
            msg: error instanceof Error ? error.message : "Failed to open login page",
            data: null
            } as CommonMessage<null>
        }
    })

    ipcMain.handle(USER_SIGNOUT, async (event, data) => {
        const userModel = new User()

        const res = await userModel.Signout().then(function () {
            return {
                status: true,
                msg: "login out success",
            };
        }).catch(function (err) {
            console.log(err);
            if (err instanceof Error) {
                return {
                    status: false,
                    msg: err.message,
                };
            } else {
                return {
                    status: false,
                    msg: "unknow error",
                };
            }
        })
        return res;
    })
}