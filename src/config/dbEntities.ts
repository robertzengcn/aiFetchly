/**
 * Central TypeORM entity registry (WS-3).
 *
 * Single source of truth for the entities used by the app DataSource
 * (src/config/SqliteDb.ts) AND the CLI migration DataSource
 * (src/config/data-source.ts). Extracted so the migration CLI does not have to
 * import the electron-coupled SqliteDb module.
 *
 * Keep this list in sync with `@/entity/*` — every active entity is registered
 * here in the same order SqliteDb historically used (registration order can
 * matter for FK constraint creation).
 */
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
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity";
import { EmailMarketingTaskEntity } from "@/entity/EmailMarketingTask.entity";
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
import { SearchTaskEntity } from "@/entity/SearchTask.entity";
import { SearchTaskProxyEntity } from "@/entity/SearchTaskProxy.entity";
import { SearchAccountEntity } from "@/entity/SearchAccount.entity";
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
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { AgentDefinitionEntity } from "@/entity/AgentDefinition.entity";
import { AgentTaskEntity } from "@/entity/AgentTask.entity";
import { AgentTaskMessageEntity } from "@/entity/AgentTaskMessage.entity";
import { AgentToolCallEntity } from "@/entity/AgentToolCall.entity";
import { AIUserMemoryEntity } from "@/entity/AIUserMemory.entity";
import { AIMemoryConsolidationRunEntity } from "@/entity/AIMemoryConsolidationRun.entity";
import { AIWorkspaceMemoryEntity } from "@/entity/AIWorkspaceMemory.entity";
import { AIWorkspaceMemoryConsolidationRunEntity } from "@/entity/AIWorkspaceMemoryConsolidationRun.entity";
import { WorkspaceEntity } from "@/entity/Workspace.entity";
import { AIFetchlyWorkspaceTrustEntity } from "@/entity/AIFetchlyWorkspaceTrust.entity";
import { HookConfigEntity } from "@/entity/HookConfig.entity";
import { HookAuditEntryEntity } from "@/entity/HookAuditEntry.entity";
import { AIChatPlanEntity } from "@/entity/AIChatPlan.entity";
import { AIChatPlanVersionEntity } from "@/entity/AIChatPlanVersion.entity";
import { AIChatPlanQuestionEntity } from "@/entity/AIChatPlanQuestion.entity";
import { AIChatGoalEntity } from "@/entity/AIChatGoal.entity";
import { AIChatGoalRunEntity } from "@/entity/AIChatGoalRun.entity";
import { AIChatGoalEvidenceEntity } from "@/entity/AIChatGoalEvidence.entity";
import { AIChatPlanApprovalEntity } from "@/entity/AIChatPlanApproval.entity";
import { AIChatSessionMemoryEntity } from "@/entity/AIChatSessionMemory.entity";
import { AIChatCompactSummaryEntity } from "@/entity/AIChatCompactSummary.entity";
import { AIChatAttachmentEntity } from "@/entity/AIChatAttachment.entity";
import { AIArtifactEntity } from "@/entity/AIArtifact.entity";
import { VectorEntity, VectorMetadataEntity } from "@/entity/Vector.entity";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { TaskEntity } from "@/entity/Task.entity";
import { ContactInfoEntity } from "@/entity/ContactInfo.entity";
import { InstalledSkillEntity } from "@/entity/InstalledSkill.entity";
import { InstalledPluginEntity } from "@/entity/InstalledPlugin.entity";
import { PluginMarketplaceEntity } from "@/entity/PluginMarketplace.entity";
import { DependencyInstallAuditEntity } from "@/entity/DependencyInstallAudit";
import { ShellAuditEntity } from "@/entity/ShellAudit.entity";
import { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import { ConversationToolStateEntity } from "@/entity/ConversationToolState.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyIdentityProfileEntity } from "@/entity/EmailReplyIdentityProfile.entity";
import { EmailAutoReplyRuleEntity } from "@/entity/EmailAutoReplyRule.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailAutoReplyAuditLogEntity } from "@/entity/EmailAutoReplyAuditLog.entity";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailConversationEntity } from "@/entity/EmailConversation.entity";
import { EmailReplyKnowledgeScopeEntity } from "@/entity/EmailReplyKnowledgeScope.entity";

export const DB_ENTITIES = [
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
  AIArtifactEntity,
  VectorEntity,
  VectorMetadataEntity,
  MCPToolEntity,
  TaskEntity,
  ContactInfoEntity,
  InstalledSkillEntity,
  InstalledPluginEntity,
  PluginMarketplaceEntity,
  DependencyInstallAuditEntity,
  ShellAuditEntity,
  GoogleMapsSearchRecordEntity,
  YandexMapsSearchRecordEntity,
  AiMessageTaskEntity,
  AiMessageTaskRunEntity,
  ConversationToolStateEntity,
  EmailReceivedMessageEntity,
  EmailReplyDraftEntity,
  EmailReplyIdentityProfileEntity,
  EmailAutoReplyRuleEntity,
  EmailReplyAuditLogEntity,
  EmailAutoReplyAuditLogEntity,
  EmailReplyDraftRevisionEntity,
  EmailReplyApprovalEntity,
  EmailReplySendAttemptEntity,
  EmailConversationEntity,
  EmailReplyKnowledgeScopeEntity,
  AIChatPlanEntity,
  AIChatPlanVersionEntity,
  AIChatPlanQuestionEntity,
  AIChatGoalEntity,
  AIChatGoalRunEntity,
  AIChatGoalEvidenceEntity,
  AIChatPlanApprovalEntity,
  AIChatSessionMemoryEntity,
  AIChatCompactSummaryEntity,
  AgentDefinitionEntity,
  AgentTaskEntity,
  AgentTaskMessageEntity,
  AgentToolCallEntity,
  AIUserMemoryEntity,
  AIMemoryConsolidationRunEntity,
  AIWorkspaceMemoryEntity,
  AIWorkspaceMemoryConsolidationRunEntity,
  WorkspaceEntity,
  AIFetchlyWorkspaceTrustEntity,
  HookConfigEntity,
  HookAuditEntryEntity,
];
