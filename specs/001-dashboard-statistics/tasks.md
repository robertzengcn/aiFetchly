# Tasks: Dashboard Statistics Quick Access

**Input**: Design documents from `specs/001-dashboard-statistics/`  
**Prerequisites**: spec.md (completed), plan.md (completed)

**Tests**: NO TEST CODE GENERATION (per user requirement). Manual testing using Electron DevTools and console logging.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, SETUP)
- Include exact file paths in descriptions

## Path Conventions

- **Electron app**: Backend in `src/controller/`, `src/main-process/`, Frontend in `src/views/`
- **Backend**: Controllers, IPC handlers, entities
- **Frontend**: Vue 3 components, API wrappers, utilities
- All paths relative to project root: `/home/robertzeng/project/aiFetchly`

---

## Phase 1: Setup & Dependencies (Shared Infrastructure)

**Purpose**: Install dependencies, add database indexes, and set up project configuration before any feature work

- [ ] **T001** [SETUP] Install required npm packages: Run `yarn add apexcharts vue3-apexcharts date-fns` in project root
- [ ] **T002** [SETUP] Create database indexes: Execute SQL index creation statements from plan.md on SQLite database (5 indexes: search_result.record_time, emailsearch_result.record_time, yellow_pages_result.scraped_at, emailmarketing_send_log.record_time, emailmarketing_send_log.status)
- [ ] **T003** [P] [SETUP] Add IPC channel constants to `src/config/channellist.ts`: Add 4 new exports (DASHBOARD_SUMMARY, DASHBOARD_TRENDS, DASHBOARD_SEARCH_ENGINES, DASHBOARD_EMAIL_STATUS) at end of file

**Checkpoint**: Dependencies installed, database indexed, channel constants defined

---

## Phase 2: Backend Foundation (Required for All User Stories)

**Purpose**: Core backend infrastructure that MUST be complete before ANY user story implementation can begin

**⚠️ CRITICAL**: No frontend work can begin until this phase is complete and IPC endpoints are testable

- [ ] **T004** [SETUP] Create TypeScript type definitions in `src/entityTypes/dashboardType.ts`: Define all interfaces from plan.md data model section (DashboardSummary, MetricSummary, EmailMetricSummary, TrendData, SearchEngineBreakdown, EmailStatusBreakdown, DateRangeFilter, and request/response types)
- [ ] **T005** [SETUP] Implement DashboardController in `src/controller/DashboardController.ts`: Create class with 4 main methods (getSummaryStats, getTrendData, getSearchEngineBreakdown, getEmailStatusBreakdown) using TypeORM repositories for existing entities (SearchResultEntity, EmailSearchResultEntity, YellowPagesResultEntity, EmailMarketingSendLogEntity)
- [ ] **T006** [SETUP] Add private helper methods to DashboardController: Implement calculateTrend() for percentage change calculation, determineGranularity() for auto-selecting day/week/month aggregation, and formatDateForQuery() for SQLite date handling
- [ ] **T007** [SETUP] Create IPC handler functions in `src/main-process/communication/dashboard-ipc.ts`: Implement registerDashboardIpcHandlers() function with 4 ipcMain.handle() calls following existing pattern from rag-ipc.ts (handle DASHBOARD_SUMMARY, DASHBOARD_TRENDS, DASHBOARD_SEARCH_ENGINES, DASHBOARD_EMAIL_STATUS channels)
- [ ] **T008** [SETUP] Register dashboard IPC handlers in `src/main-process/communication/index.ts`: Add registerDashboardIpcHandlers() call inside registerCommunicationIpcHandlers() function
- [ ] **T009** [SETUP] **🔴 CRITICAL** Update preload.ts whitelist in `src/preload.ts`: Add all 4 new dashboard channels (DASHBOARD_SUMMARY, DASHBOARD_TRENDS, DASHBOARD_SEARCH_ENGINES, DASHBOARD_EMAIL_STATUS) to validChannels array in the invoke section (line ~66-89), otherwise IPC calls will fail silently

**Checkpoint**: Backend foundation ready - all 4 IPC endpoints are callable and return data. Test each endpoint using Electron DevTools console before proceeding to frontend.

---

## Phase 3: User Story 1 - Instant Statistics Overview (Priority: P1) 🎯 MVP

**Goal**: Display 4 summary cards with real-time statistics within 2 seconds of opening dashboard

**Independent Test**: Open dashboard and verify all 4 cards display accurate totals, trend indicators, and are clickable

### Backend for User Story 1 (Already Complete in Phase 2)

*Note: DASHBOARD_SUMMARY endpoint provides data for this story*

### Frontend for User Story 1

- [ ] **T010** [P] [US1] Create frontend API wrapper in `src/views/api/dashboard.ts`: Implement 4 async functions using windowInvoke from apirequest utility (getDashboardSummary, getDashboardTrends, getSearchEngineBreakdown, getEmailStatusBreakdown) with proper TypeScript types imported from dashboardType.ts
- [ ] **T011** [P] [US1] Create date utility functions in `src/views/utils/dateUtils.ts`: Implement formatDateForDisplay() for human-readable dates, getDateRangePreset() for quick filter date calculations, and formatDateForAPI() for ISO 8601 string conversion
- [ ] **T012** [US1] Create DashboardSummaryCards component in `src/views/dashboard/components/DashboardSummaryCards.vue`: Implement Vue 3 Composition API component with 4 Vuetify v-cards displaying metric name, icon (mdi-magnify, mdi-email-multiple, mdi-book-open-page-variant, mdi-email-send), primary count, trend indicator (arrow + percentage), using responsive v-row/v-col grid (4 cols desktop, 2x2 tablet, 1 col mobile)
- [ ] **T013** [US1] Add card interactivity to DashboardSummaryCards: Implement hover effects (elevation change), click handlers emitting 'card-clicked' event with metric type, and loading skeleton state using Vuetify v-skeleton-loader for each card
- [ ] **T014** [US1] Add empty state handling to DashboardSummaryCards: Display "0" with appropriate message when no data exists, handle null/undefined data gracefully, show "N/A" for trend when previous period has no data
- [ ] **T015** [P] [US1] Create loading skeleton component in `src/views/dashboard/components/DashboardLoading.vue`: Implement reusable skeleton loader using Vuetify v-skeleton-loader for cards (4 card skeletons) and charts (4 chart skeletons with proper dimensions)
- [ ] **T016** [P] [US1] Create empty state component in `src/views/dashboard/components/DashboardEmptyState.vue`: Implement empty state with icon, message "No data available for selected period", and suggestion text, plus error state variant with "Unable to load data" and retry button
- [ ] **T017** [US1] Update or create main dashboard page in `src/views/dashboard/home.vue`: Create Vue 3 Composition API component with reactive state for dashboard data, loading flags, error state, implement fetchDashboardData() async function calling getDashboardSummary from API wrapper, render DashboardSummaryCards with loading and empty states
- [ ] **T018** [US1] Add navigation handlers to dashboard home: Implement card click handlers that navigate to detail pages (search results list, email extraction results, yellow pages list, email marketing logs) using Vue Router, pass appropriate filters/context to detail views
- [ ] **T019** [US1] Implement 5-minute caching in dashboard home: Create cache object with data and timestamp, implement isCacheValid() function checking 5-minute expiration, add manual refresh button that bypasses cache, ensure cache is cleared on date range change

**Checkpoint**: At this point, User Story 1 should be fully functional - dashboard displays 4 summary cards with accurate data, trends, loading states, empty states, and navigation works. Test by opening dashboard and verifying < 2 second load time.

---

## Phase 4: User Story 2 - Time-Based Data Filtering (Priority: P2)

**Goal**: Enable users to filter dashboard data by date ranges with quick presets and custom picker

**Independent Test**: Select different date ranges and verify all cards update within 500ms with filtered data

### Frontend for User Story 2

- [ ] **T020** [US2] Create DashboardDateRangeFilter component in `src/views/dashboard/components/DashboardDateRangeFilter.vue`: Implement Vue 3 component with 5 quick filter buttons (Last 7 days, Last 30 days, Last 90 days, Last 365 days, All time) using Vuetify v-btn-toggle or v-chip-group, add custom date picker using v-date-picker with start/end date selection
- [ ] **T021** [US2] Add responsive layouts to DashboardDateRangeFilter: Implement desktop layout (horizontal button group + inline date picker), tablet layout (collapsible v-expansion-panel with date picker), mobile layout (v-dialog modal overlay with touch-friendly date picker and larger buttons min 44px)
- [ ] **T022** [US2] Implement date validation in DashboardDateRangeFilter: Validate start date < end date, enforce maximum range of 2 years, enforce minimum range of 1 day, display v-alert with error message for invalid ranges, disable apply button until valid
- [ ] **T023** [US2] Add date range state management to DashboardDateRangeFilter: Implement reactive state for selected preset and custom dates, emit 'date-range-changed' event with { startDate, endDate, preset } payload, highlight active preset, update preset to 'custom' when dates manually changed
- [ ] **T024** [US2] Integrate date filter into dashboard home: Add DashboardDateRangeFilter component to dashboard home.vue, implement dateRangeChanged event handler that updates component state and calls fetchDashboardData() with new dates, debounce filter changes by 300ms using lodash.debounce or custom implementation to prevent excessive API calls
- [ ] **T025** [US2] Update dashboard data fetching for date ranges: Modify fetchDashboardData() to accept startDate and endDate parameters, pass date range to all API calls (getDashboardSummary, getDashboardTrends, etc.), update cache key to include date range so different ranges cache separately
- [ ] **T026** [US2] Implement trend comparison logic: Update backend query in DashboardController.getSummaryStats() to also query previous equivalent period (e.g., if current is last 7 days, query 7 days before that), calculate percentage change for each metric, set trend direction ('up', 'down', 'neutral'), ensure cards display updated trend indicators

**Checkpoint**: Date filter is fully functional - users can select quick presets or custom ranges, all cards update with debounced API calls, trends compare to previous period, cache respects date ranges.

---

## Phase 5: User Story 3 - Visual Trend Analysis (Priority: P3)

**Goal**: Display 4 interactive charts showing data visualizations and trends

**Independent Test**: Scroll to charts section, verify charts load and render with interactive tooltips, legends work, charts update when date filter changes

### Frontend for User Story 3

- [ ] **T027** [P] [US3] Create DashboardTrendsChart component (Line Chart) in `src/views/dashboard/components/DashboardTrendsChart.vue`: Integrate vue3-apexcharts, implement multi-line chart with 4 series (Search Results, Emails Extracted, Yellow Pages, Emails Sent) using different colors (blue, green, yellow, cyan), configure x-axis as dates and y-axis as counts, add interactive tooltips with hover, implement toggleable legend
- [ ] **T028** [P] [US3] Create DashboardSearchEngineChart component (Bar Chart) in `src/views/dashboard/components/DashboardSearchEngineChart.vue`: Integrate vue3-apexcharts, implement vertical bar chart with search engines on x-axis and counts on y-axis, use color-coded bars, add value labels on top of bars, implement click handler for filtering (emit 'engine-clicked' event), add empty state for no data
- [ ] **T029** [P] [US3] Create DashboardEmailStatusChart component (Pie/Doughnut Chart) in `src/views/dashboard/components/DashboardEmailStatusChart.vue`: Integrate vue3-apexcharts, implement doughnut chart with 3 segments (Successful-green, Failed-red, Pending-yellow), add percentage labels on segments, implement interactive legend with toggle visibility, configure center text showing total count
- [ ] **T030** [P] [US3] Create DashboardActivityChart component (Area Chart) in `src/views/dashboard/components/DashboardActivityChart.vue`: Integrate vue3-apexcharts, implement stacked area chart with 4 layers (Search Results bottom, Emails Extracted, Yellow Pages, Emails Sent top), use gradient fills, add tooltips showing all values on hover, implement smooth transitions for data updates
- [ ] **T031** [US3] Implement chart theming and responsiveness: Configure all 4 charts to respect Vuetify theme (light/dark mode), implement responsive chart sizing (maintain aspect ratio, min height 400px desktop, 350px tablet, 300px mobile), simplify legends on mobile (show below chart), ensure tooltips work on touch devices (tap to show, auto-hide after 3s)
- [ ] **T032** [US3] Add lazy loading to charts in dashboard home: Implement Intersection Observer API in dashboard home.vue to detect when charts section scrolls into viewport, only fetch chart data and render charts when visible (getDashboardTrends, getSearchEngineBreakdown, getEmailStatusBreakdown), show loading skeletons while charts load
- [ ] **T033** [US3] Integrate charts into dashboard home: Add all 4 chart components to dashboard home.vue in 2x2 grid layout (desktop) or stacked layout (mobile), implement chart data state management, connect to API calls for chart data, handle loading and error states for each chart independently
- [ ] **T034** [US3] Implement chart interactivity handlers: Add engine click handler for bar chart that updates date filter or shows detail view, implement legend toggle handlers for all charts, add zoom/pan capabilities to line chart on desktop using ApexCharts built-in zoom toolbar, ensure touch gestures work on mobile

**Checkpoint**: All 4 charts render correctly, display data from backend, respond to date filter changes, provide interactive tooltips and legends, lazy load on scroll, work on all screen sizes.

---

## Phase 6: User Story 4 - Responsive Mobile Access (Priority: P3)

**Goal**: Ensure dashboard works seamlessly on mobile and tablet devices with touch-friendly interactions

**Independent Test**: Access dashboard on mobile device (< 768px), verify single column layout, touch targets ≥ 44px, tooltips work on tap

### Frontend for User Story 4

- [ ] **T035** [US4] Implement mobile layout for summary cards: Update DashboardSummaryCards responsive breakpoints using Vuetify grid (cols=12 sm=6 md=3 lg=3), verify cards stack vertically on mobile (< 768px), ensure card padding is appropriate for mobile (16px), test minimum touch target size (44px × 44px) for interactive elements
- [ ] **T036** [US4] Implement tablet layout adaptations: Configure 2x2 grid for summary cards on tablet (768-1199px), test portrait vs landscape orientation, ensure charts are full-width and stack vertically on tablet, verify date filter collapsible panel works on tablet
- [ ] **T037** [US4] Add touch interactions for mobile charts: Implement tap-to-show tooltips on all charts (override default hover), add auto-hide after 3 seconds, simplify chart legends for mobile (reduce font size, stack items), disable zoom/pan on mobile (touch conflicts), test swipe gestures don't conflict with chart interaction
- [ ] **T038** [US4] Implement mobile date picker modal: Update DashboardDateRangeFilter to show v-dialog modal on mobile instead of inline picker, ensure modal covers full screen with proper v-toolbar header, add large touch-friendly date picker with minimum 44px touch targets, include clear "Apply" and "Cancel" buttons (44px height)
- [ ] **T039** [US4] Test responsive breakpoint transitions: Manually test dashboard at exact breakpoints (767px, 768px, 1199px, 1200px), verify smooth CSS transitions using Vuetify breakpoint system, ensure no layout breaks or overlapping content at any viewport size, test device rotation on tablet (portrait ↔ landscape)
- [ ] **T040** [US4] Add mobile-specific optimizations: Implement pull-to-refresh gesture for manual data refresh on mobile using touch events, add horizontal scroll indicators for date range if needed, ensure all text is readable at 14px base font size on mobile, verify color contrast meets WCAG standards on mobile screens

**Checkpoint**: Dashboard works perfectly on mobile (< 768px) and tablet (768-1199px) with appropriate layouts, all interactive elements have 44px+ touch targets, touch gestures work intuitively, responsive transitions are smooth.

---

## Phase 7: Performance Optimization & Polish

**Purpose**: Final performance tuning, error handling, and user experience polish

- [ ] **T041** [P] Implement debouncing for date filter: Add 300ms debounce to date range change handler in dashboard home using lodash.debounce or custom setTimeout/clearTimeout implementation, ensure rapid filter changes don't trigger multiple API calls, show loading indicator during debounce delay
- [ ] **T042** [P] Add comprehensive error handling: Implement try-catch blocks in all API wrapper functions in dashboard.ts, add error state to dashboard home component, display user-friendly error messages using Vuetify v-alert or v-snackbar, add retry button that re-fetches failed data, log errors to console for debugging
- [ ] **T043** [P] Implement loading states: Add skeleton loaders for initial page load (DashboardLoading component), implement per-card loading indicators for data refresh, add chart loading spinners, ensure loading states are consistent and visually appealing using Vuetify components
- [ ] **T044** Optimize database queries: Review and optimize SQLite queries in DashboardController, ensure all queries use indexed columns, test query performance with large datasets (100K+ records), add query logging in development mode to identify slow queries, consider adding EXPLAIN QUERY PLAN analysis
- [ ] **T045** Add performance monitoring: Implement timing logs in dashboard home for key operations (data fetch time, chart render time, total page load time), use console.time/console.timeEnd for development, add performance marks using Performance API, verify < 2s initial load and < 500ms chart render in normal conditions
- [ ] **T046** Implement accessibility features: Add proper aria-labels to all interactive elements, ensure keyboard navigation works for date filter and charts, add focus indicators for keyboard users, verify screen reader support for chart data (provide text alternatives), ensure color contrast meets WCAG 2.1 AA for all text and UI elements
- [ ] **T047** Add hover effects and animations: Implement smooth elevation changes on card hover using Vuetify, add subtle fade-in animations for charts using ApexCharts animation config (300ms), implement smooth number counting animation for metric values using countup.js or custom implementation, ensure animations respect prefers-reduced-motion
- [ ] **T048** Final integration testing: Test complete user flow from opening dashboard → viewing cards → changing date filter → scrolling to charts → clicking cards to navigate, verify cache works across sessions, test error scenarios (database timeout, network error, invalid dates), verify performance targets are met (< 2s load, < 500ms charts, < 300ms API responses)

**Checkpoint**: Dashboard is fully polished with optimal performance, comprehensive error handling, smooth animations, accessibility compliance, and all acceptance criteria from user stories are met.

---

## Summary

**Total Tasks**: 48 tasks
- **Setup & Dependencies**: 3 tasks (T001-T003)
- **Backend Foundation**: 6 tasks (T004-T009)
- **User Story 1 (P1)**: 10 tasks (T010-T019) - Instant Statistics Overview
- **User Story 2 (P2)**: 7 tasks (T020-T026) - Time-Based Filtering
- **User Story 3 (P3)**: 8 tasks (T027-T034) - Visual Trend Analysis
- **User Story 4 (P3)**: 6 tasks (T035-T040) - Responsive Mobile Access
- **Performance & Polish**: 8 tasks (T041-T048)

**Parallel Tasks**: 12 tasks can be done in parallel (marked with [P])

**Critical Path**: 
1. Setup (T001-T003) → 
2. Backend Foundation (T004-T009) → 
3. US1 Frontend (T010-T019) → 
4. US2 Filtering (T020-T026) → 
5. US3 Charts (T027-T034, many parallel) → 
6. US4 Mobile (T035-T040) → 
7. Polish (T041-T048, many parallel)

**Estimated Effort**: 3-4 weeks
- Week 1: Setup + Backend Foundation + US1 (T001-T019)
- Week 2: US2 Filtering + US3 Charts (T020-T034)
- Week 3: US4 Mobile + Performance (T035-T048)
- Week 4: Testing, refinement, and deployment

**No Test Code**: Manual testing using Electron DevTools, console logging, and browser developer tools. No automated test files will be generated per user specification.

---

**Document Version**: 1.0  
**Status**: Ready for Implementation  
**Last Updated**: 2025-11-07

