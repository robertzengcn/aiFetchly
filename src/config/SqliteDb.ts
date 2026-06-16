import "reflect-metadata";
import { DataSource } from "typeorm";
import { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity";
import { SystemSettingEntity } from "@/entity/SystemSetting.entity";
import { SystemSettingOptionEntity } from "@/entity/SystemSettingOption.entity";
import { AccountCookiesEntity } from "@/entity/AccountCookies.entity";
import { BuckemailTaskEntity } from "@/entity/BuckemailTask.entity";
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity";
import { EmailFilterEntity } from "@/entity/EmailFilter.entity";
import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity";
import { EmailTemplateTaskRelationEntity } from "@/entity/EmailTemplateTaskRelation.entity";
import { EmailFilterTaskRelationEntity } from "@/entity/EmailFilterTaskRelation.entity";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailServiceTaskRelationEntity } from "@/entity/EmailServiceTaskRelation.entity";
// import {VideoDownloadTagEntity} from "@/entity/VideoDownloadTag.entity"
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity";
import { EmailMarketingTaskEntity } from "@/entity/EmailMarketingTask.entity";
import { EmailMarketingTaskDetailEntity } from "@/entity/EmailMarketingTaskDetail.entity";
import { EmailSearchResultEntity } from "@/entity/EmailSearchResult.entity";
import { EmailSearchResultDetailEntity } from "@/entity/EmailSearchResultDetail.entity";
import { EmailSearchTaskEntity } from "@/entity/EmailSearchTask.entity";
import { EmailSearchTaskUrlEntity } from "@/entity/EmailSearchTaskUrl.entity";
import { EmailSearchTaskProxyEntity } from "@/entity/EmailSearchTaskProxy.entity";
//import {EmailSearchUrlEntity} from "@/entity/EmailSearchTaskUrl.entity"
import { ExtraModuleEntity } from "@/entity/ExtraModule.entity";
import { ProxyCheckEntity } from "@/entity/ProxyCheck.entity";
import { ProxyEntity } from "@/entity/Proxy.entity";
import { SearchKeywordEntity } from "@/entity/SearchKeyword.entity";
import { SearchResultEntity } from "@/entity/SearchResult.entity";
import { TaskRunEntity } from "@/entity/TaskRun.entity";
// import {VideoDownloadTaskKeywordEntity} from "@/entity/VideoDownloadTaskKeyword.entity"
import { SearchTaskEntity } from "@/entity/SearchTask.entity";
import { SearchTaskProxyEntity } from "@/entity/SearchTaskProxy.entity";
import { SearchAccountEntity } from "@/entity/SearchAccount.entity";
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
import { AgentDefinitionEntity } from "@/entity/AgentDefinition.entity";
import { AgentTaskEntity } from "@/entity/AgentTask.entity";
import { AgentTaskMessageEntity } from "@/entity/AgentTaskMessage.entity";
import { AgentToolCallEntity } from "@/entity/AgentToolCall.entity";
import { AIChatPlanEntity } from "@/entity/AIChatPlan.entity";
import { AIChatPlanVersionEntity } from "@/entity/AIChatPlanVersion.entity";
import { AIChatPlanQuestionEntity } from "@/entity/AIChatPlanQuestion.entity";
import { AIChatPlanApprovalEntity } from "@/entity/AIChatPlanApproval.entity";
import { AIChatSessionMemoryEntity } from "@/entity/AIChatSessionMemory.entity";
import { AIChatCompactSummaryEntity } from "@/entity/AIChatCompactSummary.entity";
import { AIChatAttachmentEntity } from "@/entity/AIChatAttachment.entity";
import { VectorEntity, VectorMetadataEntity } from "@/entity/Vector.entity";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { TaskEntity } from "@/entity/Task.entity";
import { ContactInfoEntity } from "@/entity/ContactInfo.entity";
import { InstalledSkillEntity } from "@/entity/InstalledSkill.entity";
import { InstalledPluginEntity } from "@/entity/InstalledPlugin.entity";
import { DependencyInstallAuditEntity } from "@/entity/DependencyInstallAudit";
import { ShellAuditEntity } from "@/entity/ShellAudit.entity";
import { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
// import sqlite3 from "sqlite3";
import Database from "better-sqlite3";
import { app } from "electron";
import * as fs from "fs";

import path from "node:path";

/**
 * True if `absolutePath` lives under an `app.asar` segment (Electron archive).
 * `app.asar.unpacked` is NOT inside the archive — OS loaders can read those files.
 */
function isPathInsideAppAsarArchive(absolutePath: string): boolean {
  const parts = absolutePath.split(/[/\\]/);
  return parts.includes("app.asar");
}

/**
 * Map .../app.asar/... to .../app.asar.unpacked/... (first segment only).
 * Native extensions must load from the unpacked mirror, not from inside the asar.
 */
function mirroredAppAsarUnpackedPath(absolutePath: string): string {
  return absolutePath.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

/**
 * If the file exists only under app.asar, return the real-disk unpacked path when present.
 * Never returns a path inside app.asar — LoadLibrary/dlopen cannot use archive paths.
 */
function resolveNativeExtensionPathForLoad(
  candidatePath: string
): string | null {
  if (!fs.existsSync(candidatePath)) {
    return null;
  }
  if (!isPathInsideAppAsarArchive(candidatePath)) {
    return candidatePath;
  }
  const unpacked = mirroredAppAsarUnpackedPath(candidatePath);
  if (fs.existsSync(unpacked)) {
    return unpacked;
  }
  return null;
}

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
    // Note: For macOS (darwin), use 'arm64' directly, not 'aarch64'
    // For Linux, arm64 maps to aarch64
    const archMap: Record<string, string> = {
      x64: "x64",
      arm64: platform === "darwin" ? "arm64" : "aarch64", // macOS uses arm64, Linux uses aarch64
      ia32: "x86",
    };

    const sqliteVecArch = archMap[arch] || arch;
    // Use 'darwin' for macOS package name, not 'macos'
    const os =
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

    // Try both mapped architecture and original architecture for compatibility
    const packageNames = [
      `sqlite-vec-${os}-${sqliteVecArch}`, // Try mapped architecture first
      ...(sqliteVecArch !== arch ? [`sqlite-vec-${os}-${arch}`] : []), // Fallback to original arch if different
    ];

    // Method 1: Try to find extension in build directory (copied by Vite plugin)
    // This is the most reliable method for both development and production
    const buildExtensionPaths: string[] = [];

    // 1a. Try app.getAppPath() (works in both dev and packaged)
    try {
      if (
        typeof process !== "undefined" &&
        (process as NodeJS.Process & { type: string }).type === "browser" &&
        app &&
        typeof (app as unknown as { getAppPath: () => string }).getAppPath ===
          "function"
      ) {
        const appPath = (
          app as unknown as { getAppPath: () => string }
        ).getAppPath();
        // In development, extension is in .vite/build
        // In production, extension is in app.asar or app.asar.unpacked
        if ((app as unknown as { isPackaged: boolean }).isPackaged) {
          // Try app.asar.unpacked first (where native modules are unpacked)
          const unpackedPath = appPath.replace(
            /app\.asar$/,
            "app.asar.unpacked"
          );
          // vec0.* is copied to .vite/build by Vite; must load from unpacked mirror (not inside app.asar)
          buildExtensionPaths.push(
            path.join(unpackedPath, ".vite", "build", extensionName)
          );
          buildExtensionPaths.push(path.join(unpackedPath, extensionName));
          // Also try directly in app path
          buildExtensionPaths.push(path.join(appPath, extensionName));
        } else {
          // Development: try .vite/build
          buildExtensionPaths.push(
            path.join(appPath, ".vite", "build", extensionName)
          );
          // Also try relative to app path
          buildExtensionPaths.push(path.join(appPath, extensionName));
        }
      }
    } catch (error) {
      // app might not be available yet (before app.whenReady())
    }

    // 1b. Try __dirname (development - extension is in .vite/build)
    if (typeof __dirname !== "undefined") {
      // In development, __dirname might be .vite/build, extension is in same directory
      buildExtensionPaths.push(path.join(__dirname, extensionName));
      // Also try .vite/build if we're not already there
      const buildDir = path.join(__dirname, ".vite", "build");
      buildExtensionPaths.push(path.join(buildDir, extensionName));
      // Try going up from build directory
      let currentDir = __dirname;
      for (let i = 0; i < 3; i++) {
        const buildPath = path.join(
          currentDir,
          ".vite",
          "build",
          extensionName
        );
        buildExtensionPaths.push(buildPath);
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
      }
    }

    // 1c. Try process.resourcesPath (packaged apps)
    const resourcesPath = (
      process as NodeJS.Process & { resourcesPath?: string }
    ).resourcesPath;
    if (resourcesPath) {
      buildExtensionPaths.push(
        path.join(
          resourcesPath,
          "app.asar.unpacked",
          ".vite",
          "build",
          extensionName
        )
      );
      buildExtensionPaths.push(
        path.join(resourcesPath, "app.asar.unpacked", extensionName)
      );
      buildExtensionPaths.push(path.join(resourcesPath, extensionName));
    }

    // Check build extension paths first (most reliable)
    for (const buildPath of buildExtensionPaths) {
      try {
        const resolved = resolveNativeExtensionPathForLoad(buildPath);
        if (resolved) {
          console.log(
            `Found sqlite-vec extension in build directory: ${resolved}`
          );
          return resolved;
        }
      } catch (error) {
        // Path might be invalid, continue
      }
    }

    // Method 2: Try using require.resolve to find sqlite-vec package, then find sibling platform package
    // This is a fallback for development when extension hasn't been copied yet
    try {
      const sqliteVecMainPath = require.resolve("sqlite-vec");
      const sqliteVecDir = path.dirname(sqliteVecMainPath);
      // sqlite-vec package is in node_modules/sqlite-vec
      // Platform-specific package is in node_modules/sqlite-vec-{os}-{arch} (sibling)
      const nodeModulesDir = path.dirname(sqliteVecDir);

      // Try both mapped and original architecture
      for (const pkgName of packageNames) {
        const platformPackagePath = path.join(
          nodeModulesDir,
          pkgName,
          extensionName
        );
        const resolvedPkg =
          resolveNativeExtensionPathForLoad(platformPackagePath);
        if (resolvedPkg) {
          console.log(
            `Found sqlite-vec extension at (via require.resolve): ${resolvedPkg}`
          );
          return resolvedPkg;
        }
      }
    } catch (error) {
      // require.resolve might fail in bundled apps, continue with other methods
      console.warn(
        "Could not resolve sqlite-vec via require.resolve, trying alternative methods"
      );
    }

    // Method 3: Try different base paths for Electron apps (fallback)
    const possibleBasePaths: string[] = [];

    // 3a. Try app.getAppPath() (works in both dev and packaged, but only after app is ready)
    try {
      if (
        typeof process !== "undefined" &&
        (process as NodeJS.Process & { type: string }).type === "browser" &&
        app &&
        typeof (app as unknown as { getAppPath: () => string }).getAppPath ===
          "function"
      ) {
        const appPath = (
          app as unknown as { getAppPath: () => string }
        ).getAppPath();
        possibleBasePaths.push(appPath);

        // In packaged apps, node_modules might be unpacked from ASAR
        if ((app as unknown as { isPackaged: boolean }).isPackaged) {
          // Try app.asar.unpacked (where unpacked native modules go)
          const unpackedPath = appPath.replace(
            /app\.asar$/,
            "app.asar.unpacked"
          );
          if (unpackedPath !== appPath) {
            possibleBasePaths.push(unpackedPath);
          }
          // Also try resourcesPath
          const resourcesPath = (
            process as NodeJS.Process & { resourcesPath?: string }
          ).resourcesPath;
          if (resourcesPath) {
            possibleBasePaths.push(resourcesPath);
            possibleBasePaths.push(
              path.join(resourcesPath, "app.asar.unpacked")
            );
          }
        }
      }
    } catch (error) {
      // app might not be available yet (before app.whenReady())
    }

    // 3b. Try process.resourcesPath (packaged apps)
    const resourcesPath2 = (
      process as NodeJS.Process & { resourcesPath?: string }
    ).resourcesPath;
    if (resourcesPath2) {
      possibleBasePaths.push(resourcesPath2);
      // In packaged apps, node_modules might be in app.asar.unpacked
      possibleBasePaths.push(path.join(resourcesPath2, "app.asar.unpacked"));
    }

    // 3c. Try __dirname (development - goes up from build directory to project root)
    if (typeof __dirname !== "undefined") {
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
    const uniqueBasePaths = Array.from(
      new Set(possibleBasePaths.filter((p) => p && p && p.length > 0))
    );

    // Try to find the extension file using base paths
    for (const basePath of uniqueBasePaths) {
      try {
        // Try both mapped and original architecture
        for (const pkgName of packageNames) {
          const directPath = path.join(
            basePath,
            "node_modules",
            pkgName,
            extensionName
          );
          const resolvedDirect = resolveNativeExtensionPathForLoad(directPath);
          if (resolvedDirect) {
            console.log(`Found sqlite-vec extension at: ${resolvedDirect}`);
            return resolvedDirect;
          }
        }
      } catch (error) {
        // Path might be invalid, continue
      }
    }

    console.warn(
      `Could not find sqlite-vec extension file. Tried packages: ${packageNames.join(
        ", "
      )}`
    );
    console.warn("Tried build paths:", buildExtensionPaths);
    console.warn("Tried base paths:", uniqueBasePaths);
    return null;
  } catch (error) {
    console.error("Error resolving sqlite-vec extension path:", error);
    return null;
  }
}

export class SqliteDb {
  public connection: DataSource;
  private static instance: SqliteDb | null = null;
  private static currentDbPath: string | null = null;
  /** Guards against concurrent initialize() calls on the same DataSource */
  private static initPromise: Promise<void> | null = null;

  private constructor(filepath: string) {
    if (filepath.length > 0) {
      this.connection = new DataSource({
        type: "better-sqlite3",
        database: path.join(filepath, "scraper.db"),
        entities: [
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
          AIChatAttachmentEntity,
          VectorEntity,
          VectorMetadataEntity,
          MCPToolEntity,
          TaskEntity,
          ContactInfoEntity,
          InstalledSkillEntity,
          InstalledPluginEntity,
          DependencyInstallAuditEntity,
          ShellAuditEntity,
          GoogleMapsSearchRecordEntity,
          YandexMapsSearchRecordEntity,
          AiMessageTaskEntity,
          AiMessageTaskRunEntity,
          AIChatPlanEntity,
          AIChatPlanVersionEntity,
          AIChatPlanQuestionEntity,
          AIChatPlanApprovalEntity,
          AIChatSessionMemoryEntity,
          AIChatCompactSummaryEntity,
          AgentDefinitionEntity,
          AgentTaskEntity,
          AgentTaskMessageEntity,
          AgentToolCallEntity,
        ],
        synchronize: true,
        migrations: [],
        subscribers: [],
        //logging:  process.env.NODE_ENV !== 'production', /// use this for debugging
        logging: false,
        prepareDatabase: (db: Database.Database) => {
          // Load the sqlite-vec extension into the connection
          // Manually resolve path for Electron bundled apps
          // Do NOT use sqliteVec.load() as it internally calls getLoadablePath() which fails in bundled apps
          const extensionPath = getSqliteVecExtensionPath();
          try {
            if (extensionPath) {
              db.loadExtension(extensionPath);
              console.log(
                "sqlite-vec extension loaded successfully from:",
                extensionPath
              );
            } else {
              console.warn(
                "sqlite-vec extension not found. Vector operations will not work."
              );
              console.warn(
                "This is non-fatal - the database will initialize, but vector search will fail."
              );
              // Don't throw - allow database to initialize even if extension fails
              // Vector operations will fail, but other database operations will work
            }
          } catch (error) {
            console.error("Failed to load sqlite-vec extension:", error);
            // Don't throw - allow database to initialize even if extension fails
            // This allows the app to start, but vector operations will fail
            // The error will be logged for debugging
          }
        },
        // driver: {
        //     sqlite3: sqlite3
        // }
      });
      // try{
      // const driver = this.connection.driver as any;
      // const db = driver.database;
      // sqliteVec.load(db);
      // console.log("sqlite-vec extension loaded.");
      // }catch(error){
      //     console.error('Failed to load sqlite-vec extension:', error);
      //     throw new Error('Failed to load sqlite-vec extension');
      // }
    } else {
      // Connection not initialized when filepath is empty
      // This will cause errors if instance is used
    }
  }
  public static getInstance(filepath: string): SqliteDb {
    // Validate filepath - don't create/reset with invalid paths
    if (!filepath || filepath.length === 0) {
      // If we have a valid instance, return it instead of creating invalid one
      if (SqliteDb.instance && SqliteDb.instance.connection) {
        return SqliteDb.instance;
      }
      throw new Error("Cannot create SqliteDb instance with empty filepath");
    }

    // Check if path has changed - if so, reset the instance
    if (SqliteDb.instance && SqliteDb.currentDbPath !== filepath) {
      console.log(
        `SqliteDb path changed from ${SqliteDb.currentDbPath} to ${filepath}, resetting instance...`
      );
      // Destroy old connection asynchronously (fire and forget)
      // The old instance will be replaced immediately with a new one
      const oldInstance = SqliteDb.instance;
      if (oldInstance.connection?.isInitialized) {
        oldInstance.connection.destroy().catch((error) => {
          console.error(
            "Failed to destroy old SqliteDb connection during path change:",
            error
          );
        });
      }
      // Create new instance immediately with new path
      SqliteDb.instance = new SqliteDb(filepath);
      SqliteDb.currentDbPath = filepath;
    } else if (!SqliteDb.instance) {
      SqliteDb.instance = new SqliteDb(filepath);
      SqliteDb.currentDbPath = filepath;
      // await SqliteDb.instance.checkConnection();
    }

    return SqliteDb.instance;
  }

  /**
   * Ensure the singleton DataSource is initialized.
   * Safe to call concurrently — only the first call runs initialize();
   * subsequent callers await the same promise.
   */
  public static async ensureInitialized(): Promise<void> {
    if (!SqliteDb.instance) {
      throw new Error("SqliteDb not created yet — call getInstance first");
    }
    if (SqliteDb.instance.connection.isInitialized) {
      return;
    }
    if (!SqliteDb.initPromise) {
      SqliteDb.initPromise = SqliteDb.instance.connection
        .initialize()
        .catch((err: unknown) => {
          SqliteDb.initPromise = null;
          throw err;
        })
        .then(() => {
          SqliteDb.initPromise = null;
        });
    }
    await SqliteDb.initPromise;
  }

  /**
   * Reset the singleton when the database path changes.
   * Ensures new connections use the latest USERSDBPATH.
   */
  public static async resetInstance(filepath: string): Promise<SqliteDb> {
    // Validate filepath
    if (!filepath || filepath.length === 0) {
      throw new Error("Cannot reset SqliteDb instance with empty filepath");
    }

    // Check if we're actually changing paths
    const newDbFile = path.join(filepath, "scraper.db");
    const oldDbFile =
      SqliteDb.instance && SqliteDb.currentDbPath
        ? path.join(SqliteDb.currentDbPath, "scraper.db")
        : null;

    // If connecting to the same database file, we need to ensure old connection is fully closed
    const isSameDatabaseFile = oldDbFile && newDbFile === oldDbFile;

    if (SqliteDb.instance && SqliteDb.instance.connection?.isInitialized) {
      try {
        await SqliteDb.instance.connection.destroy();

        // If connecting to the same database file, add a small delay to ensure file locks are released
        if (isSameDatabaseFile) {
          // Wait a bit for SQLite to release file locks
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error("Failed to destroy existing SqliteDb connection:", error);
      }
    }

    SqliteDb.instance = new SqliteDb(filepath);
    SqliteDb.currentDbPath = filepath;

    return SqliteDb.instance;
  }

  protected async checkConnection() {
    try {
      if (!this.connection.isInitialized) {
        await this.connection.initialize();
      }
    } catch (error) {
      console.error("Database connection failed:", error);
      throw new Error("Failed to initialize database connection");
    }
  }
}

/**
 * Get the DataSource instance for direct database access
 * This helper function provides access to the TypeORM DataSource for use in
 * IPC handlers, models, and other modules that need direct repository access.
 *
 * @param filepath - Path to the database directory
 * @returns The TypeORM DataSource instance
 */
export function getDataSource(filepath: string): DataSource {
  const sqliteDb = SqliteDb.getInstance(filepath);
  return sqliteDb.connection;
}
