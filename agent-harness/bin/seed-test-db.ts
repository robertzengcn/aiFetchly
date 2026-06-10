#!/usr/bin/env ts-node
/**
 * Seed script for E2E test databases.
 * Uses TypeORM synchronize to create all tables, then inserts seed data.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P tsconfig.cli.json bin/seed-test-db.ts <db-dir>
 */
import "reflect-metadata";
import { DataSource } from "typeorm";
import * as path from "path";
import * as fs from "fs";

// Import ALL entities from cli-database
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

async function seed(dbDir: string): Promise<void> {
  const dbPath = path.join(dbDir, "scraper.db");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const ds = new DataSource({
    type: "better-sqlite3",
    database: dbPath,
    entities: ALL_ENTITIES,
    synchronize: true, // Create all tables from entity definitions
    migrations: [],
    subscribers: [],
    logging: false,
  });

  await ds.initialize();

  // Seed data using raw queries to avoid entity validation issues
  const qr = ds.createQueryRunner();

  // Tasks
  await qr.query(
    `INSERT INTO tasks (name, platform, status, description, keywords) VALUES (?, ?, ?, ?, ?)`,
    ["Test Task 1", "google", "completed", "First test task", "seo,marketing"]
  );
  await qr.query(
    `INSERT INTO tasks (name, platform, status, description, keywords) VALUES (?, ?, ?, ?, ?)`,
    ["Test Task 2", "linkedin", "pending", "Second test task", "outreach"]
  );
  await qr.query(
    `INSERT INTO tasks (name, platform, status, description, keywords) VALUES (?, ?, ?, ?, ?)`,
    ["Test Task 3", "google", "running", "Third test task", "automation"]
  );

  // Search tasks
  await qr.query(
    `INSERT INTO search_task (enginer_id, status) VALUES (?, ?)`,
    [1, 2]
  );
  await qr.query(
    `INSERT INTO search_task (enginer_id, status) VALUES (?, ?)`,
    [2, 1]
  );

  // Search results
  await qr.query(
    `INSERT INTO search_result (task_id, link, title, snippet) VALUES (?, ?, ?, ?)`,
    [1, "https://example.com/1", "Result 1", "Snippet 1"]
  );
  await qr.query(
    `INSERT INTO search_result (task_id, link, title, snippet) VALUES (?, ?, ?, ?)`,
    [1, "https://example.com/2", "Result 2", "Snippet 2"]
  );
  await qr.query(
    `INSERT INTO search_result (task_id, link, title, snippet) VALUES (?, ?, ?, ?)`,
    [2, "https://example.com/3", "Result 3", "Snippet 3"]
  );

  // Contact info
  await qr.query(
    `INSERT INTO contact_info (result_id, email, phone, address, extraction_status) VALUES (?, ?, ?, ?, ?)`,
    [1, "john@example.com", "+1234567890", "123 Main St", "completed"]
  );
  await qr.query(
    `INSERT INTO contact_info (result_id, email, phone, address, extraction_status) VALUES (?, ?, ?, ?, ?)`,
    [2, "jane@example.com", "+0987654321", "456 Oak Ave", "completed"]
  );
  await qr.query(
    `INSERT INTO contact_info (result_id, email, phone, address, extraction_status) VALUES (?, ?, ?, ?, ?)`,
    [3, "bob@example.com", "+1122334455", "789 Pine Rd", "pending"]
  );

  // Proxies
  await qr.query(`INSERT INTO proxy (host, port, protocol) VALUES (?, ?, ?)`, [
    "proxy1.example.com",
    "8080",
    "http",
  ]);
  await qr.query(`INSERT INTO proxy (host, port, protocol) VALUES (?, ?, ?)`, [
    "proxy2.example.com",
    "3128",
    "socks5",
  ]);

  // Schedule tasks
  await qr.query(
    `INSERT INTO schedule_task (name, task_type, task_id, cron_expression, is_active, status) VALUES (?, ?, ?, ?, ?, ?)`,
    ["Daily Scrape", "search", 1, "0 9 * * *", 1, "active"]
  );
  await qr.query(
    `INSERT INTO schedule_task (name, task_type, task_id, cron_expression, is_active, status) VALUES (?, ?, ?, ?, ?, ?)`,
    ["Weekly Report", "email_extract", 2, "0 0 * * 1", 0, "inactive"]
  );

  // Social accounts
  await qr.query(
    `INSERT INTO social_accounts (social_type_id, user, name, status) VALUES (?, ?, ?, ?)`,
    [1, "user1", "Account 1", 1]
  );
  await qr.query(
    `INSERT INTO social_accounts (social_type_id, user, name, status) VALUES (?, ?, ?, ?)`,
    [2, "user2", "Account 2", 1]
  );

  // Yellow pages task
  await qr.query(
    `INSERT INTO yellow_pages_task (name, platform, keywords, location, status) VALUES (?, ?, ?, ?, ?)`,
    ["NY Restaurants", "yelp", "restaurants", "New York", 2]
  );

  // Yellow pages result
  await qr.query(
    `INSERT INTO yellow_pages_result (task_id, business_name, email, phone, website, platform, scraped_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      1,
      "Test Restaurant",
      "info@test.com",
      "+111222333",
      "https://test.com",
      "yelp",
    ]
  );

  // RAG documents
  await qr.query(
    `INSERT INTO rag_documents (name, filePath, fileType, fileSize, status, processingStatus) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      "marketing-guide.pdf",
      "/docs/marketing-guide.pdf",
      "pdf",
      1024,
      "active",
      "completed",
    ]
  );
  await qr.query(
    `INSERT INTO rag_documents (name, filePath, fileType, fileSize, status, processingStatus) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      "sales-playbook.docx",
      "/docs/sales-playbook.docx",
      "docx",
      2048,
      "active",
      "completed",
    ]
  );

  // RAG chunks
  await qr.query(
    `INSERT INTO rag_chunks (documentId, chunkIndex, content, contentHash, tokenCount) VALUES (?, ?, ?, ?, ?)`,
    [1, 0, "Marketing automation best practices...", "hash1abc", 50]
  );
  await qr.query(
    `INSERT INTO rag_chunks (documentId, chunkIndex, content, contentHash, tokenCount) VALUES (?, ?, ?, ?, ?)`,
    [1, 1, "Email campaign strategies...", "hash2abc", 60]
  );
  await qr.query(
    `INSERT INTO rag_chunks (documentId, chunkIndex, content, contentHash, tokenCount) VALUES (?, ?, ?, ?, ?)`,
    [2, 0, "Sales playbook chapter 1...", "hash3abc", 70]
  );

  // Google maps search records
  await qr.query(
    `INSERT INTO google_maps_search_records (query, location, results) VALUES (?, ?, ?)`,
    ["restaurants", "New York", "[]"]
  );

  // Task runs
  await qr.query(
    `INSERT INTO task_run (task_id, status) VALUES (?, ?)`,
    [1, 1]
  );

  // System settings
  await qr.query(
    `INSERT INTO system_setting_group (name, description) VALUES (?, ?)`,
    ["General", "General settings"]
  );
  await qr.query(
    `INSERT INTO system_setting (key, value, description, type, groupId) VALUES (?, ?, ?, ?, ?)`,
    ["language", "en", "UI language", "string", 1]
  );

  await ds.destroy();
}

const dbDir = process.argv[2];
if (!dbDir) {
  console.error("Usage: seed-test-db.ts <db-dir>");
  process.exit(1);
}
seed(dbDir)
  .then(() => {
    console.log("Seed completed successfully");
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
