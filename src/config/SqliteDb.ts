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
import {VideoCaptionEntity} from "@/entity/VideoCaption.entity"
import {VideoDescriptionEntity} from "@/entity/VideoDescription.entity"
import {VideoDownloadEntity} from "@/entity/VideoDownload.entity"
import {VideoDownloadTaskEntity} from "@/entity/VideoDownloadTask.entity"
import {VideoDownloadTaskAccountsEntity} from "@/entity/VideoDownloadTaskAccounts.entity"
import {VideoDownloadTaskDetailEntity} from "@/entity/VideoDownloadTaskDetail.entity"
import {VideoDownloadTaskProxyEntity} from "@/entity/VideoDownloadTaskProxy.entity"
import {VideoDownloadTaskUrlsEntity} from "@/entity/VideoDownloadTaskUrls.entity"
import {VideoDownloadTagEntity} from "@/entity/VideoDownloadTag.entity"
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
import {VideoDownloadTaskKeywordEntity} from "@/entity/VideoDownloadTaskKeyword.entity"
import { SearchTaskEntity } from "@/entity/SearchTask.entity";
import { SearchTaskProxyEntity } from "@/entity/SearchTaskProxy.entity";
import {SearchAccountEntity} from "@/entity/SearchAccount.entity"
import {VideoPublishRecordEntity} from "@/entity/VideoPublishRecord.entity"
import { ScheduleTaskEntity } from "@/entity/ScheduleTask.entity";
import { ScheduleExecutionLogEntity } from "@/entity/ScheduleExecutionLog.entity";
import { ScheduleDependencyEntity } from "@/entity/ScheduleDependency.entity";
import { SchedulerStatusEntity } from "@/entity/SchedulerStatus.entity";
// import sqlite3 from "sqlite3"; 


import path from "node:path";
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
                VideoCaptionEntity,
                VideoDescriptionEntity,
                VideoDownloadEntity,
                VideoDownloadTaskEntity,
                VideoDownloadTaskAccountsEntity,
                VideoDownloadTaskDetailEntity,
                VideoDownloadTaskProxyEntity,
                VideoDownloadTaskUrlsEntity,
                VideoDownloadTagEntity,
                VideoDownloadTaskKeywordEntity,
                SearchTaskProxyEntity,
                SearchAccountEntity,
                VideoPublishRecordEntity,
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
            ],
            synchronize: true, 
            migrations: [],
            subscribers: [],
            //logging:  process.env.NODE_ENV !== 'production', /// use this for debugging
            logging:  false, 
            // driver: {
            //     sqlite3: sqlite3
            // }
        })
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
