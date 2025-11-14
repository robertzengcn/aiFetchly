import "reflect-metadata";
import { DataSource } from "typeorm";
import { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity";
import {SystemSettingEntity} from "@/entity/SystemSetting.entity"
import {SystemSettingOptionEntity} from "@/entity/SystemSettingOption.entity"
import {AccountCookiesEntity} from "@/entity/AccountCookies.entity"
import {BuckemailTaskEntity} from "@/entity/BuckemailTask.entity"
import {EmailTemplateEntity} from "@/entity/EmailTemplate.entity"
import {EmailFilterEntity} from "@/entity/EmailFilter.entity"
import {EmailFilterDetailEntity} from "@/entity/EmailFilterDetail.entity"
import {EmailTemplateTaskRelationEntity} from "@/entity/EmailTemplateTaskRelation.entity"
import {EmailFilterTaskRelationEntity} from "@/entity/EmailFilterTaskRelation.entity"
import {EmailServiceEntity} from "@/entity/EmailService.entity"
import {EmailServiceTaskRelationEntity} from "@/entity/EmailServiceTaskRelation.entity"
// import {VideoDownloadTagEntity} from "@/entity/VideoDownloadTag.entity"
import {EmailMarketingSendLogEntity} from "@/entity/EmailMarketingSendLog.entity"
import {EmailMarketingTaskEntity} from "@/entity/EmailMarketingTask.entity"
import {EmailMarketingTaskDetailEntity} from "@/entity/EmailMarketingTaskDetail.entity"
import {EmailSearchResultEntity} from "@/entity/EmailSearchResult.entity"
import {EmailSearchResultDetailEntity} from "@/entity/EmailSearchResultDetail.entity"
import {EmailSearchTaskEntity} from "@/entity/EmailSearchTask.entity"
import {EmailSearchTaskUrlEntity} from "@/entity/EmailSearchTaskUrl.entity"
import {EmailSearchTaskProxyEntity} from "@/entity/EmailSearchTaskProxy.entity"
//import {EmailSearchUrlEntity} from "@/entity/EmailSearchTaskUrl.entity"
import {ExtraModuleEntity} from "@/entity/ExtraModule.entity"
import {ProxyCheckEntity} from "@/entity/ProxyCheck.entity"
import {ProxyEntity} from "@/entity/Proxy.entity"
import {SearchKeywordEntity} from "@/entity/SearchKeyword.entity"
import {SearchResultEntity} from "@/entity/SearchResult.entity"
import {TaskRunEntity} from "@/entity/TaskRun.entity"
// import {VideoDownloadTaskKeywordEntity} from "@/entity/VideoDownloadTaskKeyword.entity"
import { SearchTaskEntity } from "@/entity/SearchTask.entity";
import { SearchTaskProxyEntity } from "@/entity/SearchTaskProxy.entity";
import {SearchAccountEntity} from "@/entity/SearchAccount.entity"
//import {VideoPublishRecordEntity} from "@/entity/VideoPublishRecord.entity"
import { ScheduleTaskEntity } from "@/entity/ScheduleTask.entity";
import { ScheduleExecutionLogEntity } from "@/entity/ScheduleExecutionLog.entity";
import { ScheduleDependencyEntity } from "@/entity/ScheduleDependency.entity";
import { SchedulerStatusEntity } from "@/entity/SchedulerStatus.entity";
import { SocialAccountEntity } from "@/entity/SocialAccount.entity";
import { YellowPagesTaskEntity } from "@/entity/YellowPagesTask.entity";
import { YellowPagesResultEntity } from "@/entity/YellowPagesResult.entity";
import { YellowPagesPlatformEntity } from "@/entity/YellowPagesPlatform.entity";
import { SessionRecordingEntity } from "@/entity/SessionRecording.entity";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import { RAGChunkEntity } from "@/entity/RAGChunk.entity";
// import { RAGModelEntity } from "@/entity/RAGModel.entity";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { VectorEntity, VectorMetadataEntity } from "@/entity/Vector.entity";
// import sqlite3 from "sqlite3";
import Database from "better-sqlite3";
import { app } from 'electron';
import * as fs from 'fs';

import path from "node:path";

/**
 * Get the path to the sqlite-vec native extension for Electron
 * This function handles path resolution for both development and packaged Electron apps
 * Manually constructs the path because sqlite-vec's getLoadablePath() uses import.meta.url
 * which doesn't work correctly in Electron bundled apps
 */
function getSqliteVecExtensionPath(): string | null {
    try {
        const platform = process.platform;
        const arch = process.arch;
        
        // Map Node.js arch to sqlite-vec package arch
        const archMap: Record<string, string> = {
            'x64': 'x64',
            'arm64': 'aarch64',
            'ia32': 'x86'
        };
        
        const sqliteVecArch = archMap[arch] || arch;
        const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';
        const packageName = `sqlite-vec-${os}-${sqliteVecArch}`;
        const extensionName = platform === 'win32' ? 'vec0.dll' : platform === 'darwin' ? 'vec0.dylib' : 'vec0.so';
        
        // Method 1: Try to find extension in build directory (copied by Vite plugin)
        // This is the most reliable method for both development and production
        const buildExtensionPaths: string[] = [];
        
        // 1a. Try app.getAppPath() (works in both dev and packaged)
        try {
            if (typeof process !== 'undefined' && process.type === 'browser' && app && typeof app.getAppPath === 'function') {
                const appPath = app.getAppPath();
                // In development, extension is in .vite/build
                // In production, extension is in app.asar or app.asar.unpacked
                if (app.isPackaged) {
                    // Try app.asar.unpacked first (where native modules are unpacked)
                    const unpackedPath = appPath.replace(/app\.asar$/, 'app.asar.unpacked');
                    buildExtensionPaths.push(path.join(unpackedPath, extensionName));
                    // Also try directly in app path
                    buildExtensionPaths.push(path.join(appPath, extensionName));
                } else {
                    // Development: try .vite/build
                    buildExtensionPaths.push(path.join(appPath, '.vite', 'build', extensionName));
                    // Also try relative to app path
                    buildExtensionPaths.push(path.join(appPath, extensionName));
                }
            }
        } catch (error) {
            // app might not be available yet (before app.whenReady())
        }
        
        // 1b. Try __dirname (development - extension is in .vite/build)
        if (typeof __dirname !== 'undefined') {
            // In development, __dirname might be .vite/build, extension is in same directory
            buildExtensionPaths.push(path.join(__dirname, extensionName));
            // Also try .vite/build if we're not already there
            const buildDir = path.join(__dirname, '.vite', 'build');
            buildExtensionPaths.push(path.join(buildDir, extensionName));
            // Try going up from build directory
            let currentDir = __dirname;
            for (let i = 0; i < 3; i++) {
                const buildPath = path.join(currentDir, '.vite', 'build', extensionName);
                buildExtensionPaths.push(buildPath);
                const parentDir = path.dirname(currentDir);
                if (parentDir === currentDir) break;
                currentDir = parentDir;
            }
        }
        
        // 1c. Try process.resourcesPath (packaged apps)
        if (process.resourcesPath) {
            buildExtensionPaths.push(path.join(process.resourcesPath, 'app.asar.unpacked', extensionName));
            buildExtensionPaths.push(path.join(process.resourcesPath, extensionName));
        }
        
        // Check build extension paths first (most reliable)
        for (const buildPath of buildExtensionPaths) {
            try {
                if (fs.existsSync(buildPath)) {
                    console.log(`Found sqlite-vec extension in build directory: ${buildPath}`);
                    return buildPath;
                }
            } catch (error) {
                // Path might be invalid, continue
            }
        }
        
        // Method 2: Try using require.resolve to find sqlite-vec package, then find sibling platform package
        // This is a fallback for development when extension hasn't been copied yet
        try {
            const sqliteVecMainPath = require.resolve('sqlite-vec');
            const sqliteVecDir = path.dirname(sqliteVecMainPath);
            // sqlite-vec package is in node_modules/sqlite-vec
            // Platform-specific package is in node_modules/sqlite-vec-{os}-{arch} (sibling)
            const nodeModulesDir = path.dirname(sqliteVecDir);
            const platformPackagePath = path.join(nodeModulesDir, packageName, extensionName);
            
            if (fs.existsSync(platformPackagePath)) {
                console.log(`Found sqlite-vec extension at (via require.resolve): ${platformPackagePath}`);
                return platformPackagePath;
            }
        } catch (error) {
            // require.resolve might fail in bundled apps, continue with other methods
            console.warn('Could not resolve sqlite-vec via require.resolve, trying alternative methods');
        }
        
        // Method 3: Try different base paths for Electron apps (fallback)
        const possibleBasePaths: string[] = [];
        
        // 3a. Try app.getAppPath() (works in both dev and packaged, but only after app is ready)
        try {
            if (typeof process !== 'undefined' && process.type === 'browser' && app && typeof app.getAppPath === 'function') {
                const appPath = app.getAppPath();
                possibleBasePaths.push(appPath);
                
                // In packaged apps, node_modules might be unpacked from ASAR
                if (app.isPackaged) {
                    // Try app.asar.unpacked (where unpacked native modules go)
                    const unpackedPath = appPath.replace(/app\.asar$/, 'app.asar.unpacked');
                    if (unpackedPath !== appPath) {
                        possibleBasePaths.push(unpackedPath);
                    }
                    // Also try resourcesPath
                    if (process.resourcesPath) {
                        possibleBasePaths.push(process.resourcesPath);
                        possibleBasePaths.push(path.join(process.resourcesPath, 'app.asar.unpacked'));
                    }
                }
            }
        } catch (error) {
            // app might not be available yet (before app.whenReady())
        }
        
        // 3b. Try process.resourcesPath (packaged apps)
        if (process.resourcesPath) {
            possibleBasePaths.push(process.resourcesPath);
            // In packaged apps, node_modules might be in app.asar.unpacked
            possibleBasePaths.push(path.join(process.resourcesPath, 'app.asar.unpacked'));
        }
        
        // 3c. Try __dirname (development - goes up from build directory to project root)
        if (typeof __dirname !== 'undefined') {
            // In development, __dirname might be .vite/build, go up to project root
            let currentDir = __dirname;
            // Go up until we find node_modules or reach reasonable depth
            for (let i = 0; i < 5; i++) {
                possibleBasePaths.push(currentDir);
                const parentDir = path.dirname(currentDir);
                if (parentDir === currentDir) break; // Reached root
                currentDir = parentDir;
            }
        }
        
        // 3d. Try process.cwd() as fallback
        possibleBasePaths.push(process.cwd());
        
        // Remove duplicates and filter out invalid paths
        const uniqueBasePaths = Array.from(new Set(possibleBasePaths.filter(p => p && p && p.length > 0)));
        
        // Try to find the extension file using base paths
        for (const basePath of uniqueBasePaths) {
            try {
                // Try direct node_modules path
                const directPath = path.join(basePath, 'node_modules', packageName, extensionName);
                if (fs.existsSync(directPath)) {
                    console.log(`Found sqlite-vec extension at: ${directPath}`);
                    return directPath;
                }
            } catch (error) {
                // Path might be invalid, continue
            }
        }
        
        console.warn(`Could not find sqlite-vec extension file: ${packageName}/${extensionName}`);
        console.warn('Tried build paths:', buildExtensionPaths);
        console.warn('Tried base paths:', uniqueBasePaths);
        return null;
    } catch (error) {
        console.error('Error resolving sqlite-vec extension path:', error);
        return null;
    }
}

export class SqliteDb {
    public connection: DataSource;
    private static instance: SqliteDb;
    private constructor(filepath:string) {
        if(filepath.length>0){
        this.connection =new DataSource({
            type: "better-sqlite3",
            database:path.join(filepath,'scraper.db'),
            entities: [AccountCookiesEntity,
                SearchTaskEntity,
                BuckemailTaskEntity,
                EmailMarketingSendLogEntity,
                EmailMarketingTaskDetailEntity,
                EmailSearchResultEntity,
                EmailSearchResultDetailEntity,
                EmailSearchTaskEntity,
                EmailSearchTaskUrlEntity,
                EmailSearchTaskProxyEntity,
                //EmailSearchUrlEntity,
                ExtraModuleEntity,
                ProxyCheckEntity,
                ProxyEntity,
                SearchKeywordEntity,
                SearchResultEntity,
                TaskRunEntity,
                EmailMarketingTaskEntity,
                SystemSettingGroupEntity,
                SystemSettingEntity,
                SystemSettingOptionEntity,
                // VideoCaptionEntity,
                // VideoDescriptionEntity,
                // VideoDownloadEntity,
                // VideoDownloadTaskEntity,
                // VideoDownloadTaskAccountsEntity,
                // VideoDownloadTaskDetailEntity,
                // VideoDownloadTaskProxyEntity,
                // VideoDownloadTaskUrlsEntity,
                // VideoDownloadTagEntity,
                // VideoDownloadTaskKeywordEntity,
                SearchTaskProxyEntity,
                SearchAccountEntity,
               // VideoPublishRecordEntity,
                ScheduleTaskEntity,
                ScheduleExecutionLogEntity,
                ScheduleDependencyEntity,
                SchedulerStatusEntity,
                EmailTemplateEntity,
                EmailFilterEntity,
                EmailFilterDetailEntity,
                EmailTemplateTaskRelationEntity,
                EmailFilterTaskRelationEntity,
                EmailServiceEntity,
                EmailServiceTaskRelationEntity,
                SocialAccountEntity,
                YellowPagesTaskEntity,
                YellowPagesResultEntity,
                YellowPagesPlatformEntity,
                SessionRecordingEntity,
                RAGDocumentEntity,
                RAGChunkEntity,
                // RAGModelEntity,
                AIChatMessageEntity,
                VectorEntity,
                VectorMetadataEntity,
            ],
            synchronize: true, 
            migrations: [],
            subscribers: [],
            //logging:  process.env.NODE_ENV !== 'production', /// use this for debugging
            logging:  false, 
            prepareDatabase: (db: Database.Database) => {
                // Load the sqlite-vec extension into the connection
                // Manually resolve path for Electron bundled apps
                // Do NOT use sqliteVec.load() as it internally calls getLoadablePath() which fails in bundled apps
                try {
                    const extensionPath = getSqliteVecExtensionPath();
                    if (extensionPath) {
                        db.loadExtension(extensionPath);
                        console.log("sqlite-vec extension loaded successfully from:", extensionPath);
                    } else {
                        console.warn('sqlite-vec extension not found. Vector operations will not work.');
                        console.warn('This is non-fatal - the database will initialize, but vector search will fail.');
                        // Don't throw - allow database to initialize even if extension fails
                        // Vector operations will fail, but other database operations will work
                    }
                } catch (error) {
                    console.error('Failed to load sqlite-vec extension:', error);
                    // Don't throw - allow database to initialize even if extension fails
                    // This allows the app to start, but vector operations will fail
                    // The error will be logged for debugging
                }
            },
            // driver: {
            //     sqlite3: sqlite3
            // }
        })
        // try{
        // const driver = this.connection.driver as any; 
        // const db = driver.database;
        // sqliteVec.load(db);
        // console.log("sqlite-vec extension loaded.");
        // }catch(error){
        //     console.error('Failed to load sqlite-vec extension:', error);
        //     throw new Error('Failed to load sqlite-vec extension');
        // }
    }

    }
    public static getInstance(filepath:string): SqliteDb {

        if (!SqliteDb.instance) {
            SqliteDb.instance = new SqliteDb(filepath);
            // await SqliteDb.instance.checkConnection();
        }
        return SqliteDb.instance;
    }

    protected async checkConnection() {
        try {
            if (!this.connection.isInitialized) {
                await this.connection.initialize();
            }
        } catch (error) {
            console.error('Database connection failed:', error);
            throw new Error('Failed to initialize database connection');
        }
    }

    


}
