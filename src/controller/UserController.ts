import { RemoteSource, jwtUser } from '@/modules/remotesource'
// import Store,{ Schema } from 'electron-store';
import { getUserpath, checkAndCreatePath, getApplogspath } from "@/modules/lib/function"
import { log } from "@/modules/Logger"
//import { Scraperdb } from "@/model/scraperdb";
// import {SequelizeConfig} from "@/config/SequelizeConfig"
// import * as fs from 'fs';
// import * as path from 'path';
import { USERSDBPATH, USERLOGPATH, USEREMAIL, USERNAME, USERPLANS, USER_AI_ENABLED } from '@/config/usersetting';
import { UserPlan } from '@/modules/remotesource';
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
    
    /**
     * Check if a plan is a Pro plan (enables AI features)
     * Pro plans include: professional, pro, premium, enterprise
     */
    private isProPlan(plan: UserPlan): boolean {
        if (!plan || !plan.planName) return false
        const planNameLower = plan.planName.toLowerCase()
        // Check for pro plan keywords
        return planNameLower.includes('pro') || 
               planNameLower.includes('professional') || 
               planNameLower.includes('premium') || 
               planNameLower.includes('enterprise')
    }

    /**
     * Check if user has any active Pro plan
     */
    private hasActivePro(plans: Array<UserPlan>): boolean {
        if (!plans || plans.length === 0) return false
        return plans.some(plan => 
            plan.status === 'active' && this.isProPlan(plan)
        )
    }

    /**
     * Check if AI features are enabled for the current user
     */
    public isAIEnabled(): boolean {
        const tokenService = new Token()
        const aiEnabled = tokenService.getValue(USER_AI_ENABLED)
        return aiEnabled === 'true'
    }

    //defined login function which will call remote source with request
    //and return the result
    // public async login(data: userlogin): Promise<jwtUser> {

    //     const remoteSourmodel = new RemoteSource;
    //    // console.log(data)
    //     const jwtuser = await remoteSourmodel.Login(data.user, data.pass).then(async function (res) {
    //         //console.log(res);
    //         res as jwtUser
    //         if (res.email.length > 0) {

    //             //check db exist, create one if not exist

    //             const userdataPath = getUserpath(res.email)
    //             //console.log(userdataPath)
                
    //             //     // type: 'object',                 
    //             const logPath = getApplogspath(res.email)

    //             await checkAndCreatePath(userdataPath)
    //             await checkAndCreatePath(logPath)
    //             const tokenService = new Token()
    //             console.log(res)
    //             //tokenService.setValue('useremail',res.email)
    //             tokenService.setValue(USEREMAIL, res.email)
    //             tokenService.setValue(USERNAME, res.name)
    //             tokenService.setValue(USERSDBPATH, userdataPath)
    //             tokenService.setValue(USERLOGPATH, logPath)
    //             //tokenService.setValue(USERROLES, JSON.stringify(res.roles))
    //             //const scraperModel = Scraperdb.getInstance(userdataPath);
    //             //const dbdatapath=scraperModel.getdbpath(userdataPath)
    //             // console.log(dbdatapath)
    //             try {
    //             //scraperModel.init()
    //             const appDataSource = SqliteDb.getInstance(userdataPath)
    //             if(!appDataSource.connection.isInitialized){
    //             await appDataSource.connection.initialize()
    //             }
    //             } catch (error) {
    //                 console.error('Failed to initialize database connection:', error)

    //                 // Log detailed error information
    //                 if (error instanceof Error) {
    //                     console.error(`Error name: ${error.name}`)
    //                     console.error(`Error message: ${error.message}`)
    //                     console.error(`Error stack: ${error.stack}`)


    //                     // Handle specific error types
    //                     if (error.message === 'SQLITE_CANTOPEN') {
    //                         console.error('Could not open SQLite database file. Check path and permissions.')
    //                     } else if (error.name === 'SQLITE_CORRUPT') {
    //                         console.error('SQLite database file is corrupted.')
    //                     } else if (error.name === 'CannotConnectAlreadyConnectedError') {
    //                         console.log('SQLite database file is already connected.')
    //                     }else if(error.name==='CannotConnectAlreadyConnectedError2'){
    //                         console.log('SQLite database file is already connected.')

    //                     } else {
    //                         // Throw a more descriptive error or return a specific error response
    //                        throw new Error(`Database initialization failed: ${error.message}`)
    //                     }


    //                 }
    //             }
    //             console.log('initialize')
    //             // const sequelize=SequelizeConfig.getInstance(userdataPath);
    //             // await sequelize.sync({ force: true,alter: true });
    //             // Insert some sample data after the sync completes
    //             //  runAfterTableCreate()

    //            // await runafterbootup()
    //         }
    //         return res;
    //     }).catch(function (error) {
    //         console.log(error.stack)
    //         //debug(error);
    //         throw new Error(error.message);
    //     });
    //     return jwtuser;
    // }
    public getLoginPageUrl(): string {
        // Use environment variable in Node.js, import.meta.env in Vite
        const loginUrl = process.env.VITE_LOGIN_URL ||
                        (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_LOGIN_URL) ||
                        'http://localhost:3000';
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
            log.error("Failed to open browser:", error);
            throw new Error(`Failed to open browser: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    //get user email
    public getUserInfo(): UserInfoType {
        const tokenService = new Token()
        const email = tokenService.getValue(USEREMAIL)
        const name = tokenService.getValue(USERNAME)
        const plansStr = tokenService.getValue(USERPLANS)
        const aiEnabled = this.isAIEnabled()
        // const listroles = tokenService.getValue(USERROLES)
        // console.log(listroles)
        // const roles = JSON.parse(tokenService.getValue(USERROLES)) || []
        
        // Parse plans from stored JSON string
        let plans = undefined
        if (plansStr) {
            try {
                plans = JSON.parse(plansStr)
            } catch (error) {
                log.error('Failed to parse user plans:', error)
            }
        }
        
        const data: UserInfoType = {
            name: name,
            email: email,
            plans: plans,
            aiEnabled: aiEnabled,
            //roles:roles
        }
        return data;
    }
    //check user login status
    public async checklogin(): Promise<jwtUser | null> {
        const remoteSourmodel = new RemoteSource();
        const userInfo = await remoteSourmodel.GetUserInfo().then(function (res) {
            log.debug('User info retrieved:', res);
            return res;
        }).catch(function (error) {
            log.error('Failed to get user info:', error)
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
                            log.debug('User data path:', userdataPath)

                            //     // type: 'object',
                            const logPath = getApplogspath(res.email)

                            await checkAndCreatePath(userdataPath)
                            await checkAndCreatePath(logPath)
                            const tokenService = new Token()
                            log.debug('User info from remote:', res)
                            //tokenService.setValue('useremail',res.email)
                            tokenService.setValue(USEREMAIL, res.email)
                            tokenService.setValue(USERNAME, res.name)
                            // tokenService.setValue(USERID, res.id.toString())
                            tokenService.setValue(USERSDBPATH, userdataPath)
                            tokenService.setValue(USERLOGPATH, logPath)
                            // Save user's subscription plans
                            if (res.plans && res.plans.length > 0) {
                                tokenService.setValue(USERPLANS, JSON.stringify(res.plans))
                                log.info('Saved user plans:', res.plans)

                                // Check if user has Pro plan and enable AI features
                                const userController = new UserController()
                                const hasProPlan = userController.hasActivePro(res.plans)
                                tokenService.setValue(USER_AI_ENABLED, hasProPlan ? 'true' : 'false')
                                log.info('AI features enabled:', hasProPlan)
                            } else {
                                // Set default Community plan if no plans returned
                                const defaultPlans = [{ planName: 'Community', status: 'active' }]
                                tokenService.setValue(USERPLANS, JSON.stringify(defaultPlans))
                                // Community plan does not have AI features
                                tokenService.setValue(USER_AI_ENABLED, 'false')
                                log.info('Saved default Community plan, AI features disabled')
                            }
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
                                log.error('Failed to initialize database connection:', error)

                                // Log detailed error information
                                if (error instanceof Error) {
                                    log.error(`Error name: ${error.name}`)
                                    log.error(`Error message: ${error.message}`)
                                    log.error(`Error stack: ${error.stack}`)


                                    // Handle specific error types
                                    if (error.message === 'SQLITE_CANTOPEN') {
                                        log.error('Could not open SQLite database file. Check path and permissions.')
                                    } else if (error.name === 'SQLITE_CORRUPT') {
                                        log.error('SQLite database file is corrupted.')
                                    } else if (error.name === 'CannotConnectAlreadyConnectedError') {
                                        log.info('SQLite database file is already connected.')
                                    }else if(error.name==='CannotConnectAlreadyConnectedError2'){
                                        log.info('SQLite database file is already connected.')

                                    } else {
                                        // Throw a more descriptive error or return a specific error response
                                       throw new Error(`Database initialization failed: ${error.message}`)
                                    }
            
            
                                }
                            }
                   
                }else{
                    throw new Error("User email is empty in remote source");
                }
            }else{
                throw new Error("User info not found in remote source");
            }
                return res;
            })
            .catch(function (error) {
                log.error('Failed to get user info:', error);
                //debug(error);
                throw new Error(error.message);
                // return null;
            });
        return userInfo;
    }

}