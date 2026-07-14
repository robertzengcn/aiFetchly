/**
 * AI Navigation Route Manifest.
 *
 * A pure, component-free, serializable list of route metadata that the
 * main-process AI navigation tool uses to discover navigable pages. It is
 * the source of truth for model-facing route discovery (see technical design
 * §7.3). The authored Vue Router (`src/views/router/index.ts`) remains the
 * source of truth for actual app routing; the renderer always re-validates
 * a route name against `router.getRoutes()` before navigating.
 *
 * Importing this file from main-process tool code is safe: it pulls in no
 * Vue, Vue Router instances, layouts, or `.vue` components.
 *
 * Route names and paths below were verified against
 * `src/views/router/index.ts`. Two entries (`AI_Auto_Reply_Audit_List`,
 * `Email_Receive_List`) correspond to routes present on `dev` but not yet on
 * this branch; they are included so the tool can resolve them once merged.
 * The renderer's `router.getRoutes()` check rejects them gracefully until
 * then.
 *
 * @see docs/prd/ai-app-navigation-tool-technical-design.md §7
 */

export interface AiNavigationRouteManifestEntry {
  /** Stable Vue Router route name. */
  readonly routeName: string;
  /** Full route path (always begins with `/`). */
  readonly path: string;
  /** Existing i18n title key from `meta.title`, if any. */
  readonly titleKey?: string;
  /** Whether the route is visible in the application menu. */
  readonly visible?: boolean;
  /** Explicitly include (`true`) or exclude (`false`) from AI navigation. */
  readonly aiNavigable?: boolean;
  /** Natural-language phrases that should match this page. */
  readonly aiAliases?: readonly string[];
  /** Human-readable route purpose for matching and tool descriptions. */
  readonly aiDescription?: string;
}

export const aiNavigationRouteManifest: readonly AiNavigationRouteManifestEntry[] =
  [
    {
      routeName: "Email_Marketing_Service_LIST",
      path: "/emailmarketing/emailservice/list",
      titleKey: "route.email_service",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "email service",
        "email edit",
        "email settings",
        "mailbox settings",
        "smtp settings",
        "sending mailbox",
      ],
      aiDescription:
        "Manage email sending service accounts, sending mailbox settings, and SMTP configuration",
    },
    {
      routeName: "AI_Auto_Reply_Audit_List",
      path: "/emailmarketing/emailreply/audit/list",
      titleKey: "route.ai_auto_replies",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "email reply log",
        "auto reply log",
        "reply audit",
        "ai replies",
        "email auto replies",
        "email reply audit",
      ],
      aiDescription:
        "Review AI auto-reply decisions, sent replies, skipped replies, and audit logs",
    },
    {
      routeName: "Email_Receive_List",
      path: "/emailmarketing/emailreceive/list",
      titleKey: "route.email_receive",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "email receive",
        "inbox",
        "received emails",
        "email receive list",
        "incoming emails",
      ],
      aiDescription: "View received emails and inbox",
    },
    {
      routeName: "Email_Marketing_Template_List",
      path: "/emailmarketing/template/list",
      titleKey: "route.email_template",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "email template",
        "email templates",
        "email template list",
        "mail template",
      ],
      aiDescription: "Create and manage reusable email marketing templates",
    },
    {
      routeName: "Email_Marketing_Filter_LIST",
      path: "/emailmarketing/emailfilter/list",
      titleKey: "route.email_filter",
      visible: true,
      aiNavigable: true,
      aiAliases: ["email filter", "email filters", "email filter list"],
      aiDescription: "Manage email filtering rules",
    },
    {
      routeName: "BUCK_Email_TASK_LIST",
      path: "/emailmarketing/buckemailtask/list",
      titleKey: "route.bulk_email_task_list",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "bulk email task",
        "bulk email",
        "bulk email task list",
        "mass email task",
        "email send task",
      ],
      aiDescription: "View and manage bulk email sending tasks",
    },
    {
      routeName: "CampaignList",
      path: "/campaign/list",
      titleKey: "route.campaign_list",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "campaign",
        "campaign list",
        "campaigns",
        "marketing campaign",
      ],
      aiDescription: "View and manage marketing campaigns",
    },
    {
      routeName: "SocialAccount",
      path: "/socialaccount/list",
      titleKey: "route.account_list",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "social account",
        "social accounts",
        "account list",
        "social media account",
      ],
      aiDescription: "Manage social media platform accounts",
    },
    {
      routeName: "ScheduleList",
      path: "/schedule/list",
      titleKey: "route.schedule_list",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "schedule",
        "schedule list",
        "schedules",
        "task schedule",
        "scheduled tasks",
      ],
      aiDescription: "View and manage scheduled tasks",
    },
    {
      routeName: "system_setting_index",
      path: "/systemsetting/index",
      titleKey: "route.system_setting",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "system settings",
        "settings",
        "system setting",
        "app settings",
        "configuration",
      ],
      aiDescription: "Configure application-wide system settings",
    },
    {
      routeName: "Searchform",
      path: "/search/form",
      titleKey: "route.search_scraper",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "search",
        "search scraper",
        "google search",
        "search task",
        "web search",
      ],
      aiDescription: "Create and run web search scraping tasks",
    },
    {
      routeName: "Email_Extraction_Form",
      path: "/emailextraction/form",
      titleKey: "route.email_extraction_form",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "email extraction",
        "extract emails",
        "email extractor",
        "email extraction form",
      ],
      aiDescription:
        "Extract email addresses from websites and search results",
    },
    {
      routeName: "YellowPagesList",
      path: "/yellowpages/list",
      titleKey: "route.yellow_pages_list",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "yellow pages",
        "yellow pages list",
        "business directory",
      ],
      aiDescription: "Scrape business listings from yellow pages directories",
    },
    {
      routeName: "MapScraper",
      path: "/map-scraper",
      titleKey: "route.map_scraper",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "map scraper",
        "google maps scraper",
        "yandex maps scraper",
        "maps",
        "map scraping",
      ],
      aiDescription:
        "Scrape business listings from map providers (Google Maps, Yandex Maps)",
    },
    {
      routeName: "Proxylist",
      path: "/proxy/list",
      titleKey: "route.proxy_list",
      visible: true,
      aiNavigable: true,
      aiAliases: ["proxy", "proxy list", "proxies", "proxy management"],
      aiDescription: "Manage proxy servers for scraping and automation",
    },
    {
      routeName: "KnowledgeLibrary",
      path: "/knowledge/library",
      titleKey: "route.knowledge_library",
      visible: true,
      aiNavigable: true,
      aiAliases: [
        "knowledge",
        "knowledge library",
        "knowledge base",
        "rag",
        "documents",
      ],
      aiDescription:
        "Manage knowledge library documents for retrieval-augmented generation",
    },
  ];
