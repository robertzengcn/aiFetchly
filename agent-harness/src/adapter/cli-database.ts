/**
 * CLI database adapter - standalone SqliteDb that works without Electron.
 *
 * Reuses the SAME TypeORM entities and DataSource configuration as the
 * Electron app's SqliteDb, but replaces Electron-specific path resolution
 * with direct file paths. Uses the test mocks for electron/electron-store
 * to break the dependency chain.
 *
 * Key differences from the Electron SqliteDb:
 * - No Electron app.getPath() dependency
 * - Simplified sqlite-vec extension loading (optional)
 * - synchronize: false (CLI never modifies schema)
 */

import "reflect-metadata";
import { DataSource } from "typeorm";
import type Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

// Import ALL entities (same list as src/config/SqliteDb.ts)
import { AccountCookiesEntity } from "@/entity/AccountCookies.entity";
import { SearchTaskEntity } from "@/entity/SearchTask.entity";
import { BuckemailTaskEntity } from "@/entity/BuckemailTask.entity";
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity";
import { EmailMarketingTaskDetailEntity } from "@/entity/EmailMarketingTaskDetail.entity";
import { EmailSearchResultEntity } from "@/entity/EmailSearchResult.entity";
import { EmailSearchResultDetailEntity } from "@/entity/EmailSearchResultDetail.entity";
import { EmailSearchTaskEntity } from "@/entity/EmailSearchTask.entity";
import { EmailSearchTaskUrlEntity } from "@/entity/EmailSearchTaskUrl.entity";
import { EmailSearchTaskProxyEntity } from "@/entity/EmailSearchTaskProxy.entity";
import { ExtraModuleEntity } from "@/entity/ExtraModule.entity";
import { ProxyCheckEntity } from "@/entity/ProxyCheck.entity";
import { ProxyEntity } from "@/entity/Proxy.entity";
import { SearchKeywordEntity } from "@/entity/SearchKeyword.entity";
import { SearchResultEntity } from "@/entity/SearchResult.entity";
import { TaskRunEntity } from "@/entity/TaskRun.entity";
import { EmailMarketingTaskEntity } from "@/entity/EmailMarketingTask.entity";
import { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity";
import { SystemSettingEntity } from "@/entity/SystemSetting.entity";
import { SystemSettingOptionEntity } from "@/entity/SystemSettingOption.entity";
import { SearchTaskProxyEntity } from "@/entity/SearchTaskProxy.entity";
import { SearchAccountEntity } from "@/entity/SearchAccount.entity";
import { ScheduleTaskEntity } from "@/entity/ScheduleTask.entity";
import { ScheduleExecutionLogEntity } from "@/entity/ScheduleExecutionLog.entity";
import { ScheduleDependencyEntity } from "@/entity/ScheduleDependency.entity";
import { SchedulerStatusEntity } from "@/entity/SchedulerStatus.entity";
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity";
import { EmailFilterEntity } from "@/entity/EmailFilter.entity";
import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity";
import { EmailTemplateTaskRelationEntity } from "@/entity/EmailTemplateTaskRelation.entity";
import { EmailFilterTaskRelationEntity } from "@/entity/EmailFilterTaskRelation.entity";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailServiceTaskRelationEntity } from "@/entity/EmailServiceTaskRelation.entity";
import { SocialAccountEntity } from "@/entity/SocialAccount.entity";
import { YellowPagesTaskEntity } from "@/entity/YellowPagesTask.entity";
import { YellowPagesResultEntity } from "@/entity/YellowPagesResult.entity";
import { YellowPagesPlatformEntity } from "@/entity/YellowPagesPlatform.entity";
import { SessionRecordingEntity } from "@/entity/SessionRecording.entity";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import { RAGChunkEntity } from "@/entity/RAGChunk.entity";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { AIChatAttachmentEntity } from "@/entity/AIChatAttachment.entity";
import { VectorEntity, VectorMetadataEntity } from "@/entity/Vector.entity";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { TaskEntity } from "@/entity/Task.entity";
import { ContactInfoEntity } from "@/entity/ContactInfo.entity";
import { InstalledSkillEntity } from "@/entity/InstalledSkill.entity";
import { DependencyInstallAuditEntity } from "@/entity/DependencyInstallAudit";
import { ShellAuditEntity } from "@/entity/ShellAudit.entity";
import { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";

/** All entities registered in the same order as SqliteDb.ts */
const ALL_ENTITIES = [
  AccountCookiesEntity,
  SearchTaskEntity,
  BuckemailTaskEntity,
  EmailMarketingSendLogEntity,
  EmailMarketingTaskDetailEntity,
  EmailSearchResultEntity,
  EmailSearchResultDetailEntity,
  EmailSearchTaskEntity,
  EmailSearchTaskUrlEntity,
  EmailSearchTaskProxyEntity,
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
  SearchTaskProxyEntity,
  SearchAccountEntity,
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
  AIChatMessageEntity,
  AIChatAttachmentEntity,
  VectorEntity,
  VectorMetadataEntity,
  MCPToolEntity,
  TaskEntity,
  ContactInfoEntity,
  InstalledSkillEntity,
  DependencyInstallAuditEntity,
  ShellAuditEntity,
  GoogleMapsSearchRecordEntity,
  YandexMapsSearchRecordEntity,
  AiMessageTaskEntity,
  AiMessageTaskRunEntity,
];

/**
 * Find the sqlite-vec extension for CLI (non-Electron) use.
 * Simplified version of SqliteDb.ts getSqliteVecExtensionPath().
 */
function findSqliteVecExtension(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  const archMap: Record<string, string> = {
    x64: "x64",
    arm64: platform === "darwin" ? "arm64" : "aarch64",
    ia32: "x86",
  };
  const sqliteVecArch = archMap[arch] || arch;
  const osName =
    platform === "win32"
      ? "windows"
      : platform === "darwin"
      ? "darwin"
      : "linux";
  const extensionName =
    platform === "win32"
      ? "vec0.dll"
      : platform === "darwin"
      ? "vec0.dylib"
      : "vec0.so";

  const packageNames = [
    `sqlite-vec-${osName}-${sqliteVecArch}`,
    ...(sqliteVecArch !== arch ? [`sqlite-vec-${osName}-${arch}`] : []),
  ];

  // Try require.resolve first
  for (const pkgName of packageNames) {
    try {
      const pkgPath = require.resolve(`${pkgName}/package.json`);
      const extPath = path.join(path.dirname(pkgPath), extensionName);
      if (fs.existsSync(extPath)) return extPath;
    } catch {
      /* not found */
    }
  }

  // Try node_modules from project root
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  for (const pkgName of packageNames) {
    const extPath = path.join(
      projectRoot,
      "node_modules",
      pkgName,
      extensionName
    );
    if (fs.existsSync(extPath)) return extPath;
  }

  return null;
}

export class CliDatabase {
  public connection: DataSource;
  private static instance: CliDatabase | null = null;
  private static currentDbPath: string | null = null;
  private static initPromise: Promise<void> | null = null;
  private static readOnlyMode = false;

  /** Set read-only mode (called from CLI init) */
  public static setReadOnly(readOnly: boolean): void {
    CliDatabase.readOnlyMode = readOnly;
  }

  /** Check if read-only mode is enabled */
  public static isReadOnly(): boolean {
    return CliDatabase.readOnlyMode;
  }

  private constructor(dbDir: string) {
    this.connection = new DataSource({
      type: "better-sqlite3",
      database: path.join(dbDir, "scraper.db"),
      entities: ALL_ENTITIES,
      synchronize: false, // CLI NEVER modifies schema
      migrations: [],
      subscribers: [],
      logging: false,
      prepareDatabase: (db: Database.Database) => {
        const extensionPath = findSqliteVecExtension();
        if (extensionPath) {
          try {
            db.loadExtension(extensionPath);
          } catch (error) {
            // Non-fatal: vector operations will fail, but other operations work
          }
        }
      },
    });
  }

  /** Get or create the singleton CliDatabase instance */
  public static getInstance(dbDir: string): CliDatabase {
    if (!dbDir || dbDir.length === 0) {
      throw new Error("Cannot create CliDatabase instance with empty path");
    }

    if (CliDatabase.instance && CliDatabase.currentDbPath !== dbDir) {
      const old = CliDatabase.instance;
      if (old.connection?.isInitialized) {
        old.connection.destroy().catch(() => {
          /* ignore destroy errors during path switch */
        });
      }
      CliDatabase.instance = new CliDatabase(dbDir);
      CliDatabase.currentDbPath = dbDir;
      CliDatabase.initPromise = null;
    } else if (!CliDatabase.instance) {
      CliDatabase.instance = new CliDatabase(dbDir);
      CliDatabase.currentDbPath = dbDir;
    }

    return CliDatabase.instance;
  }

  /** Ensure the DataSource is initialized */
  public static async ensureInitialized(): Promise<void> {
    if (!CliDatabase.instance) {
      throw new Error("CliDatabase not created yet - call getInstance first");
    }
    if (CliDatabase.instance.connection.isInitialized) return;

    if (!CliDatabase.initPromise) {
      CliDatabase.initPromise = CliDatabase.instance.connection
        .initialize()
        .catch((err: unknown) => {
          CliDatabase.initPromise = null;
          throw err;
        })
        .then(() => {
          CliDatabase.initPromise = null;
        });
    }
    await CliDatabase.initPromise;
  }

  /** Get a TypeORM repository for an entity */
  public static getRepository<T>(entityClass: new (...args: unknown[]) => T) {
    if (!CliDatabase.instance?.connection?.isInitialized) {
      throw new Error(
        "Database not initialized. Call ensureInitialized() first."
      );
    }
    return CliDatabase.instance.connection.getRepository(entityClass);
  }

  /** Get the current database directory path */
  public static getCurrentDbPath(): string {
    if (!CliDatabase.currentDbPath) {
      throw new Error("Database not initialized yet");
    }
    return CliDatabase.currentDbPath;
  }

  /** Reset the singleton (for testing) */
  public static async resetInstance(dbDir: string): Promise<CliDatabase> {
    if (CliDatabase.instance?.connection?.isInitialized) {
      await CliDatabase.instance.connection.destroy();
    }
    CliDatabase.instance = new CliDatabase(dbDir);
    CliDatabase.currentDbPath = dbDir;
    CliDatabase.initPromise = null;
    return CliDatabase.instance;
  }
}
