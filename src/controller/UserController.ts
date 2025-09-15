import { RemoteSource, jwtUser } from '@/modules/remotesource'
// import Store,{ Schema } from 'electron-store';
import { getUserpath, checkAndCreatePath, getApplogspath } from "@/modules/lib/function"
//import { Scraperdb } from "@/model/scraperdb";
// import {SequelizeConfig} from "@/config/SequelizeConfig"
// import * as fs from 'fs';
// import * as path from 'path';
import { USERSDBPATH, USERLOGPATH, USEREMAIL,USERNAME, USERROLES } from '@/config/usersetting';
import { Token } from "@/modules/token"
//import {runAfterTableCreate} from "@/modules/lib/databaseinit"
import { SqliteDb } from "@/config/SqliteDb"
// import { runafterbootup } from "@/modules/bootuprun"
import {UserInfoType} from "@/entityTypes/userType"
//import { CommonMessage } from "@/entityTypes/commonType";
import { shell } from "electron";
// const packageJson = require('../../../package.json');
import {app} from 'electron'
// import {Token} from "@/modules/token"
import { 
    MCPRequest, 
    MCPResponse, 
    MCPUserLoginRequest,
    MCPUserInfo,
    MCPUserLoginResponse,
    createMCPSuccessResponse,
    createMCPErrorResponse,
    createMCPError,
    MCPErrorCode
} from '@/mcp-server/types/mcpTypes';

// const debug = require('debug')('user-controller');
export type userlogin = {
    user: string,
    pass: string,
}
export type userResponse = {
    status: boolean,
    msg: string,
    data?: jwtUser,
}
// interface SchemaData {
//     userPath: string;
//   }
export class UserController {

    // private user: string;
    // private pass: string;
    //defined login function which will call remote source with request
    //and return the result
    public async login(data: userlogin): Promise<jwtUser> {

        const remoteSourmodel = new RemoteSource;
       // console.log(data)
        const jwtuser = await remoteSourmodel.Login(data.user, data.pass).then(async function (res) {
            //console.log(res);
            res as jwtUser
            if (res.email.length > 0) {

                //check db exist, create one if not exist

                const userdataPath = getUserpath(res.email)
                console.log(userdataPath)
                
                //     // type: 'object',                 
                const logPath = getApplogspath(res.email)

                await checkAndCreatePath(userdataPath)
                await checkAndCreatePath(logPath)
                const tokenService = new Token()
                console.log(res)
                //tokenService.setValue('useremail',res.email)
                tokenService.setValue(USEREMAIL, res.email)
                tokenService.setValue(USERNAME, res.name)
                tokenService.setValue(USERSDBPATH, userdataPath)
                tokenService.setValue(USERLOGPATH, logPath)
                //tokenService.setValue(USERROLES, JSON.stringify(res.roles))
                //const scraperModel = Scraperdb.getInstance(userdataPath);
                //const dbdatapath=scraperModel.getdbpath(userdataPath)
                // console.log(dbdatapath)
                try {
                //scraperModel.init()
                const appDataSource = SqliteDb.getInstance(userdataPath)
                if(!appDataSource.connection.isInitialized){
                await appDataSource.connection.initialize()
                }
                } catch (error) {
                    console.error('Failed to initialize database connection:', error)

                    // Log detailed error information
                    if (error instanceof Error) {
                        console.error(`Error name: ${error.name}`)
                        console.error(`Error message: ${error.message}`)
                        console.error(`Error stack: ${error.stack}`)


                        // Handle specific error types
                        if (error.message === 'SQLITE_CANTOPEN') {
                            console.error('Could not open SQLite database file. Check path and permissions.')
                        } else if (error.name === 'SQLITE_CORRUPT') {
                            console.error('SQLite database file is corrupted.')
                        } else if (error.name === 'CannotConnectAlreadyConnectedError') {
                            console.log('SQLite database file is already connected.')
                        }else if(error.name==='CannotConnectAlreadyConnectedError2'){
                            console.log('SQLite database file is already connected.')

                        } else {
                            // Throw a more descriptive error or return a specific error response
                           throw new Error(`Database initialization failed: ${error.message}`)
                        }


                    }
                }
                console.log('initialize')
                // const sequelize=SequelizeConfig.getInstance(userdataPath);
                // await sequelize.sync({ force: true,alter: true });
                // Insert some sample data after the sync completes
                //  runAfterTableCreate()

               // await runafterbootup()
            }
            return res;
        }).catch(function (error) {
            console.log(error.stack)
            //debug(error);
            throw new Error(error.message);
        });
        return jwtuser;
    }
    public getLoginPageUrl(): string {
        const loginUrl = import.meta.env.VITE_LOGIN_URL as string;
        const appName = app.getName() || "";
        const finalapp = appName.replace(/-/g, '');
        
        // Build the login URL with app name
        const finalloginUrl = loginUrl.replace(/\/$/, '') + '/login?app=' + finalapp;
        
        if (!finalloginUrl) {
            throw new Error("Login URL is not defined in environment variables");
        }
        
        // Check URL is valid
        const urlPattern = new RegExp(
            '^(https?:\\/\\/)?' + // protocol
            '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
            '((\\d{1,3}\\.){3}\\d{1,3})|' + // OR ip (v4) address
            'localhost|' + // OR localhost
            '127\\.0\\.0\\.1)' + // OR 127.0.0.1
            '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
            '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
            '(\\#[-a-z\\d_]*)?$', // fragment locator
            'i'
        );
        
        if (!urlPattern.test(finalloginUrl)) {
            throw new Error(`Invalid login URL format: ${finalloginUrl}`);
        }
        
        return finalloginUrl;
    }

    public openLoginPage() {
        // Open login page with shell
        // const loginUrl = import.meta.env.VITE_LOGIN_URL as string;
        // // Get app name from package.json
        // const appName = app.getName() || "";
        // const finalapp=appName.replace(/-/g, '');
        // // try {
        // //     appName = packageJson.name || "";
        // //     console.log(`Using app name from package.json: ${appName}`);
        // // } catch (error) {
        // //     console.error("Could not read package.json:", error);
        // // }

        // // Build the login URL with app name
        // const finalloginUrl=loginUrl.replace(/\/$/, '') + '/login?app='+finalapp
        // if (!finalloginUrl) {
        //     throw new Error("Login URL is not defined in environment variables");
        // }
        
        // // Check URL is valid
        // const urlPattern = new RegExp(
        //     '^(https?:\\/\\/)?' + // protocol
        //     '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
        //     '((\\d{1,3}\\.){3}\\d{1,3})|' + // OR ip (v4) address
        //     'localhost|' + // OR localhost
        //     '127\\.0\\.0\\.1)' + // OR 127.0.0.1
        //     '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
        //     '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
        //     '(\\#[-a-z\\d_]*)?$', // fragment locator
        //     'i'
        // );
        
        // if (!urlPattern.test(finalloginUrl)) {
        //     throw new Error(`Invalid login URL format: ${finalloginUrl}`);
        // }
        const finalloginUrl=this.getLoginPageUrl()
        
        try {
            // Open the URL in default browser
            shell.openExternal(finalloginUrl);
        } catch (error) {
            console.error("Failed to open browser:", error);
            throw new Error(`Failed to open browser: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    //get user email
    public getUserInfo(): UserInfoType {
        const tokenService = new Token()
        const email = tokenService.getValue(USEREMAIL)
        const name = tokenService.getValue(USERNAME)
        // const listroles = tokenService.getValue(USERROLES)
        // console.log(listroles)
        // const roles = JSON.parse(tokenService.getValue(USERROLES)) || []
        const data:UserInfoType={
            name:name,
            email:email,
            //roles:roles

        }
        return data;
    }
    //check user login status
    public async checklogin(): Promise<jwtUser | null> {
        const remoteSourmodel = new RemoteSource();
        const userInfo = await remoteSourmodel.GetUserInfo().then(function (res) {
            console.log(res);
            return res;
        }).catch(function (error) {
            console.log(error)
            //debug(error);
            //throw new Error(error.message);
            return null
        });
        return userInfo;
    }
    //update user info by token
    public async updateUserInfo(): Promise<jwtUser | null> {
        const remoteSourmodel = new RemoteSource();

        const userInfo = await remoteSourmodel.GetUserInfo()
            .then(async function (res) {
                if(res){
                    if (res.email.length > 0) {
                      
                            //check db exist, create one if not exist
            
                            const userdataPath = getUserpath(res.email)
                            console.log(userdataPath)
                            
                            //     // type: 'object',                 
                            const logPath = getApplogspath(res.email)
            
                            await checkAndCreatePath(userdataPath)
                            await checkAndCreatePath(logPath)
                            const tokenService = new Token()
                            console.log(res)
                            //tokenService.setValue('useremail',res.email)
                            tokenService.setValue(USEREMAIL, res.email)
                            tokenService.setValue(USERNAME, res.name)
                            tokenService.setValue(USERSDBPATH, userdataPath)
                            tokenService.setValue(USERLOGPATH, logPath)
                            //const scraperModel = Scraperdb.getInstance(userdataPath);
                            //const dbdatapath=scraperModel.getdbpath(userdataPath)
                            // console.log(dbdatapath)
                            try {
                            //scraperModel.init()
                            const appDataSource = SqliteDb.getInstance(userdataPath)
                            if(!appDataSource.connection.isInitialized){
                            await appDataSource.connection.initialize()
                            }
                            //await runafterbootup()
                            } catch (error) {
                                console.error('Failed to initialize database connection:', error)
            
                                // Log detailed error information
                                if (error instanceof Error) {
                                    console.error(`Error name: ${error.name}`)
                                    console.error(`Error message: ${error.message}`)
                                    console.error(`Error stack: ${error.stack}`)
            
            
                                    // Handle specific error types
                                    if (error.message === 'SQLITE_CANTOPEN') {
                                        console.error('Could not open SQLite database file. Check path and permissions.')
                                    } else if (error.name === 'SQLITE_CORRUPT') {
                                        console.error('SQLite database file is corrupted.')
                                    } else if (error.name === 'CannotConnectAlreadyConnectedError') {
                                        console.log('SQLite database file is already connected.')
                                    }else if(error.name==='CannotConnectAlreadyConnectedError2'){
                                        console.log('SQLite database file is already connected.')
            
                                    } else {
                                        // Throw a more descriptive error or return a specific error response
                                       throw new Error(`Database initialization failed: ${error.message}`)
                                    }
            
            
                                }
                            }
                   
                }
            }
                return res;
            })
            .catch(function (error) {
                console.log(error);
                //debug(error);
                //throw new Error(error.message);
                return null;
            });
        return userInfo;
    }

    /**
     * Handle MCP requests for user management functionality
     * This method acts as an adapter between MCP requests and the existing user management business logic
     */
    public async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
        try {
            const { tool, parameters } = request;

            switch (tool) {
                // case 'user_login':
                //     return await this.handleUserLoginRequest(parameters as MCPUserLoginRequest);
                
                case 'get_user_info':
                    return await this.handleGetUserInfoRequest();
                
                case 'check_login_status':
                    return await this.handleCheckLoginStatusRequest();
                
                case 'update_user_info':
                    return await this.handleUpdateUserInfoRequest();
                
                case 'get_login_url':
                    return await this.handleGetLoginUrlRequest();
                
                case 'open_login_page':
                    return await this.handleOpenLoginPageRequest();
                
                default:
                    return createMCPErrorResponse(
                        createMCPError(MCPErrorCode.INVALID_PARAMETERS, `Unknown user management tool: ${tool}`),
                        'Invalid user management tool requested'
                    );
            }
        } catch (error) {
            console.error('Error in UserController.handleMCPRequest:', error);
            return createMCPErrorResponse(
                createMCPError(
                    MCPErrorCode.INTERNAL_ERROR,
                    'Internal error occurred while processing user management request',
                    error instanceof Error ? error.message : String(error),
                    error instanceof Error ? error.stack : undefined
                ),
                'Failed to process user management request'
            );
        }
    }

    /**
     * Handle user login requests
     */
    // private async handleUserLoginRequest(params: MCPUserLoginRequest): Promise<MCPResponse<MCPUserLoginResponse>> {
    //     try {
    //         const loginData: userlogin = {
    //             user: params.username,
    //             pass: params.password
    //         };

    //         const jwtUser = await this.login(loginData);

    //         // Convert to MCP format
    //         const mcpUserInfo: MCPUserInfo = {
    //             name: jwtUser.name,
    //             email: jwtUser.email,
    //             roles: jwtUser.roles || [],
    //             isAuthenticated: true
    //         };

    //         const loginResponse: MCPUserLoginResponse = {
    //             user: mcpUserInfo,
    //             token: jwtUser.token,
    //             expiresAt: jwtUser.expiresAt
    //         };

    //         return createMCPSuccessResponse(loginResponse, 'User logged in successfully');
    //     } catch (error) {
    //         throw error;
    //     }
    // }

    /**
     * Handle get user info requests
     */
    private async handleGetUserInfoRequest(): Promise<MCPResponse<MCPUserInfo>> {
        try {
            const userInfo = this.getUserInfo();
            
            const mcpUserInfo: MCPUserInfo = {
                name: userInfo.name,
                email: userInfo.email,
                roles: userInfo.roles || [],
                isAuthenticated: !!(userInfo.email && userInfo.name)
            };

            return createMCPSuccessResponse(mcpUserInfo, 'User information retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle check login status requests
     */
    private async handleCheckLoginStatusRequest(): Promise<MCPResponse<MCPUserInfo>> {
        try {
            const jwtUser = await this.checklogin();
            
            if (!jwtUser) {
                const mcpUserInfo: MCPUserInfo = {
                    name: '',
                    email: '',
                    roles: [],
                    isAuthenticated: false
                };
                return createMCPSuccessResponse(mcpUserInfo, 'User is not logged in');
            }

            const mcpUserInfo: MCPUserInfo = {
                name: jwtUser.name,
                email: jwtUser.email,
                roles: jwtUser.roles || [],
                isAuthenticated: true
            };

            return createMCPSuccessResponse(mcpUserInfo, 'User login status checked successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle update user info requests
     */
    private async handleUpdateUserInfoRequest(): Promise<MCPResponse<MCPUserInfo>> {
        try {
            const jwtUser = await this.updateUserInfo();
            
            if (!jwtUser) {
                return createMCPErrorResponse(
                    createMCPError(MCPErrorCode.AUTHENTICATION_REQUIRED, 'Failed to update user information'),
                    'User information update failed'
                );
            }

            const mcpUserInfo: MCPUserInfo = {
                name: jwtUser.name,
                email: jwtUser.email,
                roles: jwtUser.roles || [],
                isAuthenticated: true
            };

            return createMCPSuccessResponse(mcpUserInfo, 'User information updated successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle get login URL requests
     */
    private async handleGetLoginUrlRequest(): Promise<MCPResponse<{ loginUrl: string }>> {
        try {
            const loginUrl = this.getLoginPageUrl();
            return createMCPSuccessResponse({ loginUrl }, 'Login URL retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle open login page requests
     */
    private async handleOpenLoginPageRequest(): Promise<MCPResponse> {
        try {
            this.openLoginPage();
            return createMCPSuccessResponse(null, 'Login page opened successfully');
        } catch (error) {
            throw error;
        }
    }

}