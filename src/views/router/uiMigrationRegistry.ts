import type {
  InnerPageTemplateKind,
  SupportingTemplateKind,
  UiMigrationState,
} from "@/views/types/uiConvergenceTypes";

/**
 * Inner-page convergence migration registry (design §26.1).
 *
 * One entry = one customer-facing page SURFACE. A surface may be reachable
 * through several route names that share a component or mode (create/edit,
 * parent shells, standalone aliases). Classification is presentation-only:
 * `meta.visible: false` never removes a route from scope (IPR-054).
 */

export interface UiMigrationEntry {
  /** Stable surface id used by coverage checks and telemetry. */
  readonly surfaceId: string;
  /** Feature family for phased rollout. */
  readonly family: string;
  /** Primary template contract. */
  readonly template: InnerPageTemplateKind;
  /** Current convergence state of the surface. */
  readonly state: UiMigrationState;
  /** Every active route name that renders this surface. */
  readonly routeNames: readonly string[];
  /** Supporting templates layered on the primary. */
  readonly supportingTemplates?: readonly SupportingTemplateKind[];
}

/** Routes outside the 50-surface inventory, with an explicit reason. */
export interface UiExcludedRoute {
  readonly routeName: string;
  readonly reason:
    | "parent-prd" // governed by the chat workspace redesign
    | "login" // outside the authenticated shell
    | "not-found" // utility surface
    | "statistics-pending-decision" // IPR-056: retention unconfirmed
    | "inactive-modules" // inactive/legacy module hub
    | "layout-parent"; // pure layout parent with no own surface
}

export const SCHEDULE_FAMILY = "scheduling";

/**
 * The 50 customer-facing inner-page surfaces (PRD §4.1).
 *
 * State values:
 * - `legacy` — renders through LegacyPageFrame inside the new shell.
 * - `shell` — outer shell migrated; content still legacy framed.
 * - `converged` — full template migration complete.
 */
export const uiMigrationRegistry: readonly UiMigrationEntry[] = [
  // --- Insights and discovery (1) ------------------------------------------
  {
    surfaceId: "insights-home",
    family: "insights",
    template: "landing",
    state: "legacy",
    routeNames: ["InsightsHome"],
  },
  // --- Settings and customization (9) --------------------------------------
  {
    surfaceId: "settings-general",
    family: "settings",
    template: "settings",
    state: "legacy",
    routeNames: ["system_setting_index"],
  },
  {
    surfaceId: "settings-mcp",
    family: "settings",
    template: "settings",
    state: "legacy",
    routeNames: ["system_setting_mcp"],
  },
  {
    surfaceId: "settings-ai-provider",
    family: "settings",
    template: "settings",
    state: "legacy",
    routeNames: ["system_setting_ai_provider"],
  },
  {
    surfaceId: "settings-skills",
    family: "settings",
    template: "settings",
    state: "legacy",
    routeNames: ["system_setting_skills", "Skills", "SkillsManagement"],
    supportingTemplates: ["collection", "detail"],
  },
  {
    surfaceId: "settings-hooks",
    family: "settings",
    template: "settings",
    state: "legacy",
    routeNames: ["system_setting_hooks"],
  },
  {
    surfaceId: "settings-plugins",
    family: "settings",
    template: "settings",
    state: "legacy",
    routeNames: ["system_setting_plugins", "Plugins", "PluginsManagement"],
    supportingTemplates: ["collection", "detail"],
  },
  {
    surfaceId: "settings-ai-memory",
    family: "settings",
    template: "settings",
    state: "legacy",
    routeNames: ["system_setting_ai_memory"],
  },
  {
    surfaceId: "settings-subagents",
    family: "settings",
    template: "settings",
    state: "legacy",
    routeNames: ["system_setting_subagents"],
    supportingTemplates: ["collection", "detail"],
  },
  {
    surfaceId: "settings-about",
    family: "settings",
    template: "settings",
    state: "legacy",
    routeNames: ["system_setting_about"],
  },
  // --- Campaign and social-task workflows (6) -------------------------------
  {
    surfaceId: "campaign-list",
    family: "campaign",
    template: "collection",
    state: "legacy",
    routeNames: ["CampaignList"],
  },
  {
    surfaceId: "campaign-editor",
    family: "campaign",
    template: "form",
    state: "legacy",
    routeNames: ["EditCampaign"],
  },
  {
    surfaceId: "socialtask-list",
    family: "socialtask",
    template: "collection",
    state: "legacy",
    routeNames: ["SocialtaskList"],
  },
  {
    surfaceId: "socialtask-editor",
    family: "socialtask",
    template: "form",
    state: "legacy",
    routeNames: ["CreateSocialtask", "EditSocialtask"],
  },
  {
    surfaceId: "socialtask-runs",
    family: "socialtask",
    template: "results",
    state: "legacy",
    routeNames: ["Runtask", "Task-run-list"],
    supportingTemplates: ["detail", "task-state"],
  },
  {
    surfaceId: "socialtask-results",
    family: "socialtask",
    template: "results",
    state: "legacy",
    routeNames: ["Task-result-list"],
  },
  // --- Search and data extraction (10) --------------------------------------
  {
    surfaceId: "search-form",
    family: "search",
    template: "form",
    state: "legacy",
    routeNames: ["Searchform", "EditSearchTask"],
    supportingTemplates: ["collection", "detail", "results"],
  },
  {
    surfaceId: "search-task-list",
    family: "search",
    template: "collection",
    state: "legacy",
    routeNames: ["Searchtasklist"],
  },
  {
    surfaceId: "search-task-detail",
    family: "search",
    template: "detail",
    state: "legacy",
    routeNames: ["Searchtaskdetail"],
  },
  {
    surfaceId: "email-extraction-form",
    family: "email-extraction",
    template: "form",
    state: "legacy",
    routeNames: ["Email_Extraction_Form", "Email_Extraction_Edit"],
    supportingTemplates: ["collection", "detail", "results"],
  },
  {
    surfaceId: "email-extraction-list",
    family: "email-extraction",
    template: "collection",
    state: "legacy",
    routeNames: ["Email_Extraction_list"],
  },
  {
    surfaceId: "email-extraction-detail",
    family: "email-extraction",
    template: "detail",
    state: "legacy",
    routeNames: ["Email_Extraction_Task_Detail"],
  },
  {
    surfaceId: "yellowpages-list",
    family: "yellowpages",
    template: "collection",
    state: "legacy",
    routeNames: ["YellowPagesList"],
  },
  {
    surfaceId: "yellowpages-editor",
    family: "yellowpages",
    template: "form",
    state: "legacy",
    routeNames: ["CreateYellowPagesTask", "EditYellowPagesTask"],
    supportingTemplates: ["results"],
  },
  {
    surfaceId: "yellowpages-results",
    family: "yellowpages",
    template: "results",
    state: "legacy",
    routeNames: ["YellowPagesTaskDetail", "YellowPagesResults"],
    supportingTemplates: ["detail"],
  },
  {
    surfaceId: "map-scraper-form",
    family: "map-scraper",
    template: "form",
    state: "legacy",
    routeNames: ["MapScraper", "GoogleMapsScraper", "YandexMapsScraper"],
    supportingTemplates: ["task-state", "results"],
  },
  // --- Email marketing (14) --------------------------------------------------
  {
    surfaceId: "email-overview",
    family: "email-marketing",
    template: "landing",
    state: "legacy",
    routeNames: ["Email_Marketing_Index"],
  },
  {
    surfaceId: "email-bulk-tasks",
    family: "email-marketing",
    template: "collection",
    state: "legacy",
    routeNames: ["BUCK_Email_TASK_LIST"],
    supportingTemplates: ["form", "task-state"],
  },
  {
    surfaceId: "email-bulk-logs",
    family: "email-marketing",
    template: "collection",
    state: "legacy",
    routeNames: ["BUCK_Email_TASK_LOG_LIST"],
    supportingTemplates: ["detail"],
  },
  {
    surfaceId: "email-send-form",
    family: "email-marketing",
    template: "form",
    state: "legacy",
    routeNames: ["Email_BUCK_SEND"],
  },
  {
    surfaceId: "email-template-list",
    family: "email-marketing",
    template: "collection",
    state: "legacy",
    routeNames: ["Email_Marketing_Template_List"],
  },
  {
    surfaceId: "email-template-editor",
    family: "email-marketing",
    template: "form",
    state: "legacy",
    routeNames: ["Email_Marketing_Template_Create", "Email_Marketing_Template_Detail"],
    supportingTemplates: ["detail"],
  },
  {
    surfaceId: "email-filter-list",
    family: "email-marketing",
    template: "collection",
    state: "legacy",
    routeNames: ["Email_Marketing_Filter_LIST"],
  },
  {
    surfaceId: "email-filter-editor",
    family: "email-marketing",
    template: "form",
    state: "legacy",
    routeNames: ["Email_Marketing_Filter_Create", "Email_Marketing_Filter_Detail"],
    supportingTemplates: ["detail"],
  },
  {
    surfaceId: "email-service-list",
    family: "email-marketing",
    template: "collection",
    state: "legacy",
    routeNames: ["Email_Marketing_Service_LIST"],
  },
  {
    surfaceId: "email-service-editor",
    family: "email-marketing",
    template: "form",
    state: "legacy",
    routeNames: ["Email_Marketing_Service_Create", "Email_Marketing_Service_Detail"],
    supportingTemplates: ["detail"],
  },
  {
    surfaceId: "email-receive-list",
    family: "email-marketing",
    template: "collection",
    state: "legacy",
    routeNames: ["Email_Receive_List"],
    supportingTemplates: ["detail"],
  },
  {
    surfaceId: "email-receive-detail",
    family: "email-marketing",
    template: "detail",
    state: "legacy",
    routeNames: ["Email_Receive_Detail"],
  },
  {
    surfaceId: "reply-audit-list",
    family: "email-marketing",
    template: "collection",
    state: "legacy",
    routeNames: ["AI_Auto_Reply_Audit_List"],
    supportingTemplates: ["detail"],
  },
  {
    surfaceId: "reply-audit-detail",
    family: "email-marketing",
    template: "detail",
    state: "legacy",
    routeNames: ["AI_Auto_Reply_Audit_Detail"],
  },
  // --- Proxy and social accounts (5) ----------------------------------------
  {
    surfaceId: "proxy-list",
    family: "proxy",
    template: "collection",
    state: "legacy",
    routeNames: ["Proxylist"],
  },
  {
    surfaceId: "proxy-editor",
    family: "proxy",
    template: "form",
    state: "legacy",
    routeNames: ["editProxy", "AddProxy"],
  },
  {
    surfaceId: "proxy-import",
    family: "proxy",
    template: "form",
    state: "legacy",
    routeNames: ["BatchUploadProxy"],
  },
  {
    surfaceId: "socialaccount-list",
    family: "socialaccount",
    template: "collection",
    state: "legacy",
    routeNames: ["SocialAccount"],
  },
  {
    surfaceId: "socialaccount-editor",
    family: "socialaccount",
    template: "form",
    state: "legacy",
    routeNames: ["editSocialAccount", "CreateSocialAccount"],
  },
  // --- Knowledge library (1) -------------------------------------------------
  {
    surfaceId: "knowledge-library",
    family: "knowledge",
    template: "settings",
    state: "legacy",
    routeNames: ["KnowledgeLibrary"],
    supportingTemplates: ["detail"],
  },
  // --- Scheduling (4) — first vertical slice (converged in Stage F) -------------
  {
    surfaceId: "schedule-list",
    family: SCHEDULE_FAMILY,
    template: "collection",
    state: "legacy",
    routeNames: ["ScheduleList"],
    supportingTemplates: ["task-state", "detail"],
  },
  {
    surfaceId: "schedule-create",
    family: SCHEDULE_FAMILY,
    template: "form",
    state: "legacy",
    routeNames: ["CreateSchedule"],
  },
  {
    surfaceId: "schedule-edit",
    family: SCHEDULE_FAMILY,
    template: "form",
    state: "legacy",
    routeNames: ["EditSchedule"],
  },
  {
    surfaceId: "schedule-detail",
    family: SCHEDULE_FAMILY,
    template: "detail",
    state: "legacy",
    routeNames: ["ScheduleDetail"],
    supportingTemplates: ["results"],
  },
];

/** Explicitly out-of-scope routes with their PRD treatments (§4.2). */
export const uiExcludedRoutes: readonly UiExcludedRoute[] = [
  { routeName: "AI_Chat_Workspace", reason: "parent-prd" },
  { routeName: "Dashboard", reason: "layout-parent" },
  { routeName: "home", reason: "parent-prd" },
  { routeName: "Insights", reason: "layout-parent" },
  { routeName: "Statistic", reason: "layout-parent" },
  { routeName: "statistic_page", reason: "statistics-pending-decision" },
  { routeName: "system_setting", reason: "layout-parent" },
  { routeName: "campaign", reason: "layout-parent" },
  { routeName: "socialtask", reason: "layout-parent" },
  { routeName: "Modules", reason: "inactive-modules" },
  { routeName: "Moduleslist", reason: "inactive-modules" },
  { routeName: "Search", reason: "layout-parent" },
  { routeName: "Email_Extraction", reason: "layout-parent" },
  { routeName: "Yellow_Pages", reason: "layout-parent" },
  { routeName: "Map_Scraper", reason: "layout-parent" },
  { routeName: "Email_Marketing", reason: "layout-parent" },
  { routeName: "Proxy", reason: "layout-parent" },
  { routeName: "Knowledge_Library", reason: "layout-parent" },
  { routeName: "Socialaccount", reason: "layout-parent" },
  { routeName: "schedule", reason: "layout-parent" },
  { routeName: "login", reason: "login" },
  { routeName: "Match", reason: "login" },
  { routeName: "404", reason: "not-found" },
  { routeName: "d404", reason: "not-found" },
];

/** Total in-scope surface count (PRD acceptance criterion 3). */
export const IN_SCOPE_SURFACE_COUNT = 50;

/** Look up the registry entry owning a route name. */
export function findSurfaceByRouteName(
  routeName: string
): UiMigrationEntry | undefined {
  return uiMigrationRegistry.find((entry) =>
    entry.routeNames.includes(routeName)
  );
}
