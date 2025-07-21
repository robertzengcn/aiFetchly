// import { extramodules } from "@/config/WinExtraModuleConfig"
import { WinExtraModuleConfig } from "@/config/WinExtraModuleConfig"
import { MacExtraModuleConfig } from "@/config/MacExtraModuleConfig"
import { LinuxExtraModuleConfig } from "@/config/LinuxExtraModuleConfig"
import { ExtraModule } from "@/entityTypes/extramoduleType"
import { checkFolderAndGetFiles, downloadFile, getUserPlatform, getRecorddatetime } from "@/modules/lib/function"
import { ListData } from "@/entityTypes/commonType"
import { execSync, exec } from 'child_process';
import { CustomError } from '@/modules/customError'
import { uninstallPipPackage, removeFile, compareVersions } from "@/modules/lib/function"
//import log from 'electron-log/node';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ExtraModulesModule } from "@/modules/ExtraModulesModule"
import { ExtraModuleEntity } from "@/entity/ExtraModule.entity"
import log from 'electron-log/main';
// import { s } from "vitest/dist/reporters-1evA5lom"
export class ExtraModuleController {
    private extraModulePth: string;
    private extramodules: ExtraModule[]
    private extraModulesModule: ExtraModulesModule
    constructor() {
        this.extraModulePth = path.join(app.getPath('userData'), 'extramodule');
        this.extramodules = this.getExtraModulesConfig()
        this.extraModulesModule = new ExtraModulesModule()
    }

    public getModulePath(): string {
        return this.extraModulePth
    }
    public async getExtraModuleList(offerset: number, length: number): Promise<ListData<ExtraModule>> {
        const extraModuelfold = await this.getExtramoduleinfolder()
        //    const extramodules=this.getExtraModulesConfig()
        console.log(this.extramodules)
        //loop extra modules check if modules installed
        //
        // this.extramodules.forEach(async (module) => {
        for (const module of this.extramodules) {
            module.installed = extraModuelfold.includes(module.packagename)
            if (module.ispip) {//check pip package installed
                const mores = await this.isPipModuleInstalled(module.packagename)
                console.log("result:")
                console.log(mores)
                if (mores) {
                    console.log(module.name + " is been set to installed")
                    module.installed = true
                }
            }
            if (module.installed) {//check installed version
                const instRes = await this.extraModulesModule.getExtraModuleByName(module.name)
                if (instRes) {
                    module.installVersion = instRes.version
                    if (module.version !== instRes.version) {
                        //convert version to number to compare whether it can be upgrade
                        //const currentVersion = parseFloat(module.version.replace(/[^\d.]/g, ''));
                        //const installedVersion = parseFloat(instRes.version.replace(/[^\d.]/g, ''));
                        const comparisonResult = compareVersions(module.version, instRes.version);
                        if (comparisonResult > 0) {
                            module.upgradeAvailable = true;
                        } else {
                            module.upgradeAvailable = false;
                        }

                    }
                }
            }
        }

        console.log(this.extramodules)
        return {
            records: this.extramodules.slice(offerset, length)
            , num: this.extramodules.length
        }
    }
    public getExtraModulesConfig(): ExtraModule[] {
        const platform = getUserPlatform()
        switch (platform) {
            case 'win32':
                return WinExtraModuleConfig
            case 'darwin':
                return MacExtraModuleConfig
            case 'linux':
                return LinuxExtraModuleConfig
            default:
                throw new Error("platform not support")
        }
    }
    //get platform packagename by name

    //install extra module
    public async installExtraModule(packagename: string, success?: () => void, strerr?: (message: Error) => void) {
        //valid package name
        const valid = this.extramodules.find((module) => module.packagename === packagename)
        if (!valid) {
            //throw new Error("package name not valid:" + packagename)
            if (strerr) {
                strerr(new Error("package name not valid:" + packagename))
            }
            return
        }
        if (valid.ispip) {//install pip package
            await this.installPipPackage(valid.packagename, valid.version).then(() => {
                const module = new ExtraModuleEntity();
                module.name = valid.name;
                module.version = valid.version;
                module.record_time = getRecorddatetime();
                this.extraModulesModule.create(module)
                if (success) {
                    success()
                }
            }).catch((error) => {
                if (strerr) {
                    strerr(error)
                }
            })

        } else {

            await this.downloadInstallPackage(valid.packagename, valid.link, () => {
                const module = new ExtraModuleEntity();
                module.name = valid.name;
                module.version = valid.version;
                module.record_time = getRecorddatetime();
                this.extraModulesModule.create(module)
                if (success) {
                    success()
                }
            }, strerr)
        }



    }

    // Add this check before attempting to create or use the directory
    private ensureExtraModuleDirectory(): Promise<void> {
        return new Promise((resolve, reject) => {
            fs.stat(this.extraModulePth, (err, stats) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        // Path doesn't exist, create directory
                        fs.promises.mkdir(this.extraModulePth, { recursive: true })
                            .then(() => resolve())
                            .catch(reject);
                    } else {
                        reject(err);
                    }
                } else if (!stats.isDirectory()) {
                    // Path exists but is not a directory
                    // Remove the file and create directory instead
                    fs.unlink(this.extraModulePth, (unlinkErr) => {
                        if (unlinkErr) {
                            reject(unlinkErr);
                            return;
                        }
                        fs.promises.mkdir(this.extraModulePth, { recursive: true })
                            .then(() => resolve())
                            .catch(reject);
                    });
                } else {
                    // Directory already exists
                    resolve();
                }
            });
        });
    }

    public async downloadInstallPackage(packagename: string, installLink: string, success?: () => void, strerr?: (message: Error) => void) {

        await this.ensureExtraModuleDirectory().catch((error) => {
            log.error(error)
            if (strerr) {
                strerr(error)
            }
        })
       
        await this.ensureExtraModuleDirectory().catch((error) => {
            log.error(error)
            if (strerr) {
                strerr(error)
            }
        })
        const saveName = path.join(this.extraModulePth, packagename)
        //console.log(this.extraModulePth)
        //create folder if not exist
        fs.access(this.extraModulePth, fs.constants.W_OK, (e) => {
            if (e) {
                // console.log(e)
                fs.promises.mkdir(this.extraModulePth, { recursive: true },).then(async () => {
                    // console.log(valid.link)
                    await downloadFile(installLink, saveName, () => {
                        fs.chmodSync(saveName, '755');

                        if (success) {
                            success()
                        }
                    }, strerr)


                    //add exec permission to file if file download success

                    // fs.promises.chmod(saveName,0o755).then(()=>{
                    //    this.downloadSavefile(valid.link,success,strerr)
                }).catch((error) => {
                    log.error(error)
                    if (strerr) {
                        strerr(error)
                    }
                })
            } else {
                //error not exist,access good
                downloadFile(installLink, saveName, () => {
                    fs.chmodSync(saveName, '755');

                    if (success) {
                        success()
                    }
                }, strerr)
                // fs.chmodSync(saveName, '755');
                // if(success){
                //     success()
                // }
            }
        })
    }
    public downloadSavefile(filename: string, success: () => void, strerr: (message: Error) => void) {
        const saveName = path.join(this.extraModulePth, filename)
        downloadFile(filename, saveName, success, strerr)

    }
    //remove modules
    public removeExtraModule(packagename: string, success?: () => void, strerr?: (message: string) => void, strout?: (message: string) => void) {

        //valid package name
        const valid = this.extramodules.find((module) => module.packagename === packagename)
        if (!valid) {
            throw new Error("package name not valid:" + packagename)
        }
        this.extraModulesModule.deletePackage(valid.name)
        if (valid.ispip) {//uninstall pip package
            //uninstall package
            uninstallPipPackage(valid.packagename, (error) => {

                throw new Error(error.message)
            },
                (message) => {
                    const formattedMessage = `${new Date().toISOString()}: ${message}\n`;


                    if (strout) {
                        strout(message)
                    }
                },
                (message) => {
                    const formattedMessage = `${new Date().toISOString()}: ${message}\n`;
                    // log.error(formattedMessage)
                    if (strerr) {
                        strerr(message)
                    }
                },
            )
        } else {
            const modulePath = path.join(this.extraModulePth, valid.packagename);
            removeFile(modulePath, () => {
                if (success) {
                    success()
                }
            }, (message) => {
                if (strerr) {
                    strerr(message)
                }
            })
        }
    }


    //check extramodule exist
    private async getExtramoduleinfolder() {

        const moduleList = await checkFolderAndGetFiles(this.extraModulePth)
        return moduleList

    }
    //check module exist in folder
    public async checkModule(packageName: string): Promise<boolean> {
        const valid = this.extramodules.find((module) => module.packagename === packageName)
        if (!valid) {
            throw new Error("package name not valid:" + packageName)
        }
        if (valid.ispip) {
            return await this.isPipModuleInstalled(valid.packagename)
        } else {
            const modulePath = path.join(this.extraModulePth, packageName);
            return fs.existsSync(modulePath);
        }
    }
    //get packagename by name
    public getPackageByName(name: string): ExtraModule | undefined {

        return this.extramodules.find((module) => module.name === name)
    }

    //check whether python installed
    public checkPython(): boolean {
        try {
            // Try to execute the 'python --version' command
            const output = execSync('python --version', { stdio: 'pipe' }).toString();
            console.log(`Python version: ${output.trim()}`);
            return true;
        } catch (error) {
            if (error instanceof Error) {
                console.error('Python is not installed:', error.message);
            }
            return false;
        }
    }
    //check whether pip modules installed
    public async isPipModuleInstalled(moduleName: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            exec(`pip show ${moduleName}`, (error, stdout, stderr) => {
                if (stderr) {
                    if (stderr.includes("not found:")) {
                        resolve(false);
                    }
                }
                if (error) {
                    // Module is not installed
                    resolve(false);
                } else {
                    // Module is installed
                    resolve(true);
                }
            });
        });
    }
    public async installPipPackage(packageName: string, version?: string): Promise<void> {
        return new Promise((resolve, reject) => {
            let installCommand = `pip install --force-reinstall -v ${packageName}`;
            if (version) {
                installCommand += `==${version}`;
            }
            exec(`pip install ${packageName}`, (error, stdout, stderr) => {

                if (error) {
                    reject(new Error(`Error installing package: ${stderr}`));
                } else {
                    resolve();
                }
            });
        });
    }
    public async upgradePackage(packageName: string, successcall?: () => void, errorCall?: (error: string) => void): Promise<void> {

        const valid = this.extramodules.find((module) => module.packagename === packageName)
        if (!valid) {
            //throw new Error("package name not valid:" + packageName)
            if (errorCall) {
                errorCall("package name not valid:" + packageName)
            }
            return
        }
        if (valid.ispip) {
            await this.installPipPackage(valid.packagename, valid.version)
            const module = new ExtraModuleEntity();
            module.name = valid.name;
            module.version = valid.version;
            module.record_time = getRecorddatetime();
            this.extraModulesModule.create(module)
            if (successcall) {
                successcall()
            }
        } else {
            const modulePath = path.join(this.extraModulePth, valid.packagename);
            removeFile(modulePath, () => {
                this.downloadInstallPackage(valid.packagename, valid.link, () => {
                    const module = new ExtraModuleEntity();
                    module.name = valid.name;
                    module.version = valid.version;
                    module.record_time = getRecorddatetime();
                    this.extraModulesModule.create(module)
                    if (successcall) {
                        successcall()
                    }
                })
            }, (message) => {
                //throw new Error(message)
                if (errorCall) {
                    errorCall(message)
                }
            })
        }


    }
    //check if the tool is available
    public async checkRequirement(toolName = "openai-whisper"): Promise<boolean> {

        const dPackage = this.getPackageByName(toolName)
        if (!dPackage) {
            throw new CustomError(toolName + " package not installed", 20250120152922)
        }
        if (dPackage.requirePy) {
            //check python installed or not
            const res = this.checkPython()
            if (!res) {
                throw new CustomError("the caption tool must install python first", 20250120152928)
            }
        }
        // const extraModule=new ExtraModuleController()
        const res = await this.checkModule(dPackage.packagename)
        if (!res) {
            throw new CustomError("generate capation must install " + toolName, 2024120511189)
        }
        return true
    }

    checkFfmpeg(): boolean {
        try {
            // Try to execute the 'ffmpeg -version' command
            const output = execSync('ffmpeg -version', { stdio: 'pipe' }).toString();
            console.log(`ffmpeg version: ${output.trim()}`);
            return true;
        } catch (error) {
            if (error instanceof Error) {
                console.error('ffmpeg is not installed:', error.message);
            }
            return false;
        }
    }



}