# Implementation Plan: Dashboard Statistics Quick Access

**Branch**: `001-dashboard-statistics` | **Date**: 2025-11-07 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/001-dashboard-statistics/spec.md`

## Summary

Implement a high-performance dashboard featuring 4 summary cards (Search Results, Emails Extracted, Yellow Pages, Emails Sent) with trend indicators, date range filtering, and 4 interactive charts (Line, Bar, Pie, Area). The dashboard must load within 2 seconds and provide instant access to statistics through an Electron IPC architecture connecting Vue 3 frontend with TypeORM/SQLite backend.

## Technical Context

**Language/Version**: TypeScript 4.x+, Node.js 16+  
**Primary Dependencies**: Vue 3 (Composition API), Vuetify 3, ApexCharts ^3.40.0, TypeORM, SQLite, Electron  
**Storage**: SQLite database with TypeORM ORM (existing tables: `search_result`, `emailsearch_result`, `yellow_pages_result`, `emailmarketing_send_log`)  
**Testing**: NO TEST CODE GENERATION REQUIRED (per user specification)  
**Target Platform**: Electron desktop application (Windows, macOS, Linux)  
**Project Type**: Electron app with IPC architecture - main process (backend) and renderer process (frontend)  
**Performance Goals**: 
- Dashboard initial load < 2 seconds
- Chart render time < 500ms per chart  
- API/IPC response < 300ms for date ranges under 90 days
- Support 100 concurrent users without degradation

**Constraints**: 
- All database access must go through Electron IPC (main → renderer communication)
- SQLite-specific query optimization required
- 5-minute client-side caching with manual refresh override
- IPC latency must be accounted for in performance budget
- Responsive design: Mobile (< 768px), Tablet (768-1199px), Desktop (≥ 1200px)

**Scale/Scope**:
- 4 summary stat cards + 4 charts
- Expected data volume: < 100K records per metric for typical 30-90 day queries
- 4 new IPC channels + 1 controller + 5 database indexes
- ~15-20 new frontend components

**Architecture Pattern**: Electron IPC with TypeORM backend

```
┌─────────────────────────────────────────────────────────┐
│  Renderer Process (Frontend - Vue 3)                    │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Dashboard View (home.vue)                        │  │
│  │    ├─ Summary Cards Component                     │  │
│  │    ├─ Date Range Filter Component                 │  │
│  │    └─ Charts Components (4x)                      │  │
│  └──────────────────────────────────────────────────┘  │
│              ↕ (IPC invoke via api/dashboard.ts)        │
└─────────────────────────────────────────────────────────┘
                        ↕ IPC Channels
┌─────────────────────────────────────────────────────────┐
│  Main Process (Backend - Node.js)                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Dashboard IPC Handlers                           │  │
│  │   (main-process/communication/dashboard-ipc.ts)   │  │
│  │              ↕                                     │  │
│  │  DashboardController                              │  │
│  │   (controller/DashboardController.ts)             │  │
│  │              ↕                                     │  │
│  │  TypeORM Repository Layer                         │  │
│  │   (Entities: SearchResult, EmailSearchResult,     │  │
│  │    YellowPagesResult, EmailMarketingSendLog)      │  │
│  └──────────────────────────────────────────────────┘  │
│              ↕                                           │
│         SQLite Database                                  │
│   (with indexes on timestamp fields)                    │
└─────────────────────────────────────────────────────────┘
```

## Constitution Check

*User requirement: No test code generation needed*

**GATE 1: Type Safety** ✅ PASS
- All TypeScript interfaces will be properly typed
- No use of `any` type (use `unknown` for truly unknown types)
- Strict type checking enabled
- IPC communication types properly defined

**GATE 2: Security** ✅ PASS
- Context isolation enabled (already configured in project)
- IPC channels whitelisted in preload.ts
- Input validation on all date range inputs
- SQL injection prevented via TypeORM parameterized queries

**GATE 3: Code Organization** ✅ PASS
- Follows existing project structure:
  - Controllers in `src/controller/`
  - IPC handlers in `src/main-process/communication/`
  - Frontend components in `src/views/dashboard/`
  - API functions in `src/views/api/`
  - Entities in `src/entity/` (using existing entities)
  - Types in `src/entityTypes/`

**GATE 4: Electron Architecture** ✅ PASS
- Main process handles all database operations
- Renderer process for UI only
- IPC for all main-renderer communication
- MVC pattern maintained

**GATE 5: Performance** ✅ PASS
- Database indexes required on timestamp fields
- Query optimization for SQLite
- Client-side caching (5 min) to reduce IPC/DB load
- Lazy loading for charts
- Debounced date filter updates (300ms)

**Re-check after Phase 1 design**: ✅ All gates remain valid

## Project Structure

### Documentation (this feature)

```text
specs/001-dashboard-statistics/
├── plan.md              # This file
├── spec.md              # Feature specification (completed)
├── checklists/
│   └── requirements.md  # Requirements quality checklist (completed)
├── data-model.md        # Data models and types (Phase 1 output)
├── contracts/           # IPC API contracts (Phase 1 output)
│   ├── dashboard-summary.md
│   ├── dashboard-trends.md
│   ├── dashboard-search-engines.md
│   └── dashboard-email-status.md
└── quickstart.md        # Development setup guide (Phase 1 output)
```

### Source Code (implementation targets)

```text
src/
├── config/
│   └── channellist.ts                    # ADD: 4 new dashboard channel constants
├── entityTypes/
│   └── dashboardType.ts                  # NEW: Dashboard TypeScript interfaces
├── controller/
│   └── DashboardController.ts            # NEW: Dashboard business logic
├── main-process/
│   └── communication/
│       ├── index.ts                      # UPDATE: Register dashboard handlers
│       └── dashboard-ipc.ts              # NEW: Dashboard IPC handlers
├── preload.ts                            # UPDATE: Add dashboard channels to whitelist
└── views/
    ├── api/
    │   └── dashboard.ts                  # NEW: Frontend API wrapper
    ├── dashboard/
    │   ├── home.vue                      # UPDATE/NEW: Main dashboard page
    │   └── components/
    │       ├── DashboardSummaryCards.vue # NEW: 4 summary cards
    │       ├── DashboardDateRangeFilter.vue # NEW: Date filter
    │       ├── DashboardTrendsChart.vue  # NEW: Line chart
    │       ├── DashboardSearchEngineChart.vue # NEW: Bar chart
    │       ├── DashboardEmailStatusChart.vue # NEW: Pie chart
    │       ├── DashboardActivityChart.vue # NEW: Area chart
    │       ├── DashboardLoading.vue      # NEW: Loading skeleton
    │       └── DashboardEmptyState.vue   # NEW: Empty state
    └── utils/
        └── dateUtils.ts                  # NEW: Date formatting helpers
```

## Phase 0: Outline & Research

### Research Tasks

**R1: ApexCharts Integration with Vue 3 Composition API**
- **Topic**: Vue3-ApexCharts library integration patterns
- **Questions**: 
  - Best practices for reactive chart data with `ref`/`reactive`
  - Performance optimization for multiple charts
  - TypeScript typing for chart options
- **Output**: `research.md` section on chart library integration

**R2: SQLite Date Aggregation Performance**
- **Topic**: Optimal SQLite queries for time-series data
- **Questions**:
  - Most performant way to aggregate by day/week/month in SQLite
  - Index strategies for timestamp columns
  - Query optimization for date range filters
- **Output**: `research.md` section on database optimization

**R3: Electron IPC Performance Best Practices**
- **Topic**: Minimizing IPC latency and overhead
- **Questions**:
  - Best data serialization strategies for IPC
  - Caching patterns in renderer process
  - Debouncing strategies for frequent IPC calls
- **Output**: `research.md` section on IPC optimization

**R4: Vuetify 3 Responsive Grid System**
- **Topic**: Responsive layout implementation
- **Questions**:
  - V-container, v-row, v-col best practices
  - Breakpoint handling in Composition API
  - Performance considerations for responsive charts
- **Output**: `research.md` section on responsive design

**Consolidated Research Output**: `research.md` with sections:
1. ApexCharts + Vue 3 integration strategy
2. SQLite query optimization patterns
3. IPC performance optimization
4. Responsive design implementation plan

## Phase 1: Design & Contracts

**Prerequisites:** `research.md` complete

### Data Model Design

**File**: `data-model.md`

**1. Core Domain Models**

```typescript
// Dashboard Summary Data (aggregated)
interface DashboardSummary {
  searchResults: MetricSummary;
  emailsExtracted: MetricSummary;
  yellowPagesResults: MetricSummary;
  emailsSent: EmailMetricSummary;
}

interface MetricSummary {
  total: number;                 // All-time total
  periodCount: number;           // Count for selected period
  trend: number;                 // Percentage change vs previous period
  trendDirection: 'up' | 'down' | 'neutral';
}

interface EmailMetricSummary extends MetricSummary {
  successRate: number;           // Percentage of successful sends
  successCount: number;
  failedCount: number;
}

// Trend Data (time series)
interface TrendData {
  dates: string[];               // ISO date strings
  searchResults: number[];
  emailsExtracted: number[];
  yellowPagesResults: number[];
  emailsSent: number[];
}

// Search Engine Breakdown
interface SearchEngineBreakdown {
  engines: EngineMetric[];
}

interface EngineMetric {
  name: string;                  // 'Google', 'Bing', 'DuckDuckGo', etc.
  count: number;
}

// Email Status Breakdown
interface EmailStatusBreakdown {
  successful: number;
  failed: number;
  pending: number;
}

// Date Range Filter
interface DateRangeFilter {
  startDate: string;             // ISO date string
  endDate: string;               // ISO date string
  preset?: 'last7' | 'last30' | 'last90' | 'last365' | 'all' | 'custom';
}
```

**2. Database Query Models**

```typescript
// Internal controller types (not exposed via IPC)
interface DateRange {
  start: Date;
  end: Date;
  granularity: 'day' | 'week' | 'month';
}

interface AggregatedCount {
  date: string;
  count: number;
}
```

**3. Entity Relationships**

```
Existing Entities (from TypeORM):
- SearchResultEntity (search_result table)
  - task_id, title, link, snippet, domain, record_time
- EmailSearchResultEntity (emailsearch_result table)
  - task_id, email, name, domain, url, title, record_time
- YellowPagesResultEntity (yellow_pages_result table)
  - task_id, business_name, email, phone, website, scraped_at, platform
- EmailMarketingSendLogEntity (emailmarketing_send_log table)
  - task_id, status, receiver, title, content, log, record_time
```

### IPC Contracts

**File**: `contracts/dashboard-summary.md`

```typescript
/**
 * Channel: DASHBOARD_SUMMARY
 * Purpose: Get aggregated summary statistics for all metrics
 */

// Request
interface DashboardSummaryRequest {
  startDate: string;  // ISO 8601 format
  endDate: string;    // ISO 8601 format
}

// Response
interface DashboardSummaryResponse extends CommonMessage<DashboardSummary> {
  status: boolean;
  msg: string;
  data: DashboardSummary;
}

// Error Scenarios:
// - Invalid date format: { status: false, msg: "Invalid date format", data: null }
// - Database error: { status: false, msg: "Database query failed", data: null }
```

**File**: `contracts/dashboard-trends.md`

```typescript
/**
 * Channel: DASHBOARD_TRENDS
 * Purpose: Get time-series data for trend charts
 */

// Request
interface DashboardTrendsRequest {
  startDate: string;
  endDate: string;
  groupBy?: 'day' | 'week' | 'month';  // Auto-determined if not specified
}

// Response
interface DashboardTrendsResponse extends CommonMessage<TrendData> {
  status: boolean;
  msg: string;
  data: TrendData;
}
```

**File**: `contracts/dashboard-search-engines.md`

```typescript
/**
 * Channel: DASHBOARD_SEARCH_ENGINES
 * Purpose: Get search result counts grouped by search engine
 */

// Request
interface DashboardSearchEnginesRequest {
  startDate: string;
  endDate: string;
}

// Response
interface DashboardSearchEnginesResponse extends CommonMessage<SearchEngineBreakdown> {
  status: boolean;
  msg: string;
  data: SearchEngineBreakdown;
}
```

**File**: `contracts/dashboard-email-status.md`

```typescript
/**
 * Channel: DASHBOARD_EMAIL_STATUS
 * Purpose: Get email send counts grouped by status
 */

// Request
interface DashboardEmailStatusRequest {
  startDate: string;
  endDate: string;
}

// Response
interface DashboardEmailStatusResponse extends CommonMessage<EmailStatusBreakdown> {
  status: boolean;
  msg: string;
  data: EmailStatusBreakdown;
}
```

### Database Migration

**Required Indexes** (to be added via TypeORM migration or direct SQL):

```sql
-- Performance-critical indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_search_result_record_time 
  ON search_result(record_time);

CREATE INDEX IF NOT EXISTS idx_emailsearch_result_record_time 
  ON emailsearch_result(record_time);

CREATE INDEX IF NOT EXISTS idx_yellow_pages_result_scraped_at 
  ON yellow_pages_result(scraped_at);

CREATE INDEX IF NOT EXISTS idx_emailmarketing_send_log_record_time 
  ON emailmarketing_send_log(record_time);

CREATE INDEX IF NOT EXISTS idx_emailmarketing_send_log_status 
  ON emailmarketing_send_log(status);
```

### Quickstart Guide

**File**: `quickstart.md`

```markdown
# Dashboard Feature Development Quickstart

## Prerequisites
- Node.js 16+ installed
- Yarn package manager
- Project dependencies installed (`yarn install`)

## Setup Steps

### 1. Install New Dependencies
```bash
cd /home/robertzeng/project/aiFetchly
yarn add apexcharts vue3-apexcharts date-fns
```

### 2. Create Database Indexes
Run the SQL commands from `contracts/dashboard-indexes.sql` using your preferred SQLite client or add them to TypeORM migration.

### 3. Add IPC Channel Constants
Edit `src/config/channellist.ts` and add:
```typescript
export const DASHBOARD_SUMMARY = 'dashboard:summary'
export const DASHBOARD_TRENDS = 'dashboard:trends'
export const DASHBOARD_SEARCH_ENGINES = 'dashboard:search_engines'
export const DASHBOARD_EMAIL_STATUS = 'dashboard:email_status'
```

### 4. Development Workflow

**Backend First:**
1. Create `src/entityTypes/dashboardType.ts` with interfaces
2. Implement `src/controller/DashboardController.ts`
3. Create `src/main-process/communication/dashboard-ipc.ts`
4. Register handlers in `src/main-process/communication/index.ts`
5. Update `src/preload.ts` to whitelist new channels

**Frontend Second:**
1. Create `src/views/api/dashboard.ts` API wrapper
2. Implement `src/views/dashboard/components/` (one at a time)
3. Update `src/views/dashboard/home.vue` to use components
4. Test with Electron DevTools

### 5. Testing Strategy (Manual - No Test Code Generated)
- Test each IPC endpoint with Electron DevTools console
- Verify data accuracy by comparing with direct database queries
- Test responsive layouts at 768px and 1200px breakpoints
- Performance test with Chrome DevTools Performance tab

### 6. Common Issues & Solutions
- **IPC Not Working**: Verify channel is in preload.ts whitelist
- **Data Not Updating**: Check 5-minute cache, use manual refresh
- **Charts Not Rendering**: Ensure ApexCharts CSS is imported in main.ts
- **Type Errors**: Run `yarn type-check` to identify issues
```

## Phase 2: Implementation Breakdown

### Backend Implementation (Main Process)

#### Step 1: Type Definitions
**File**: `src/entityTypes/dashboardType.ts`
**Depends on**: data-model.md
**Parallel**: Can start immediately after Phase 1

```typescript
// Define all TypeScript interfaces from data-model.md
// Export all types for use in controller and IPC handlers
```

#### Step 2: Dashboard Controller
**File**: `src/controller/DashboardController.ts`
**Depends on**: Step 1 (types), database indexes
**Parallel**: No

```typescript
export class DashboardController {
  // Method: getSummaryStats(startDate: Date, endDate: Date)
  // Method: getTrendData(startDate: Date, endDate: Date, granularity: string)
  // Method: getSearchEngineBreakdown(startDate: Date, endDate: Date)
  // Method: getEmailStatusBreakdown(startDate: Date, endDate: Date)
  // Private helper: calculateTrend(current: number, previous: number)
  // Private helper: determineGranularity(startDate: Date, endDate: Date)
}
```

**Key Implementation Notes**:
- Use TypeORM repository pattern (existing entities)
- Implement query optimization for SQLite
- Handle edge cases (empty data, invalid dates)
- Calculate trends by comparing current period vs previous equivalent period

#### Step 3: IPC Channel Constants
**File**: `src/config/channellist.ts`
**Depends on**: None
**Parallel**: Yes (can do with Step 1)

Add 4 new constants at end of file:
```typescript
export const DASHBOARD_SUMMARY = 'dashboard:summary'
export const DASHBOARD_TRENDS = 'dashboard:trends'
export const DASHBOARD_SEARCH_ENGINES = 'dashboard:search_engines'
export const DASHBOARD_EMAIL_STATUS = 'dashboard:email_status'
```

#### Step 4: IPC Handlers
**File**: `src/main-process/communication/dashboard-ipc.ts`
**Depends on**: Step 2 (controller), Step 3 (channels)
**Parallel**: No

```typescript
export function registerDashboardIpcHandlers(): void {
  // Register 4 ipcMain.handle() calls for each endpoint
  // Follow existing pattern from rag-ipc.ts or yellowPagesIpc.ts
  // Handle errors and return CommonMessage<T> format
}
```

#### Step 5: Register Handlers
**File**: `src/main-process/communication/index.ts`
**Depends on**: Step 4
**Parallel**: No

Add to `registerCommunicationIpcHandlers()`:
```typescript
registerDashboardIpcHandlers()
```

#### Step 6: Update Preload
**File**: `src/preload.ts`
**Depends on**: Step 3 (channels)
**Parallel**: No (but can be done right after Step 3)

**CRITICAL**: Add new channels to validChannels array in invoke section:
```typescript
const validChannels = [
  // ... existing channels ...
  DASHBOARD_SUMMARY,
  DASHBOARD_TRENDS,
  DASHBOARD_SEARCH_ENGINES,
  DASHBOARD_EMAIL_STATUS
]
```

### Frontend Implementation (Renderer Process)

#### Step 7: Frontend API Wrapper
**File**: `src/views/api/dashboard.ts`
**Depends on**: Backend Steps 1-6 complete (for testing)
**Parallel**: Can code in parallel with backend, but can't test until backend done

```typescript
import { windowInvoke } from '@/views/utils/apirequest'
import { DASHBOARD_SUMMARY, DASHBOARD_TRENDS, ... } from '@/config/channellist'

export async function getDashboardSummary(startDate: string, endDate: string) { }
export async function getDashboardTrends(startDate: string, endDate: string) { }
export async function getSearchEngineBreakdown(startDate: string, endDate: string) { }
export async function getEmailStatusBreakdown(startDate: string, endDate: string) { }
```

#### Step 8: Utility Functions
**File**: `src/views/utils/dateUtils.ts`
**Depends on**: None
**Parallel**: Yes

```typescript
export function formatDateForDisplay(date: Date): string
export function getDateRangePreset(preset: string): { start: Date, end: Date }
export function calculatePreviousPeriod(start: Date, end: Date): { start: Date, end: Date }
```

#### Step 9: Date Range Filter Component
**File**: `src/views/dashboard/components/DashboardDateRangeFilter.vue`
**Depends on**: Step 7, Step 8
**Parallel**: Yes (can develop in isolation)

**Features**:
- Quick filter buttons (7, 30, 90, 365 days, all time)
- Custom date picker (Vuetify v-date-picker)
- Emits `date-range-changed` event
- Responsive: dropdown (desktop), collapsible (tablet), modal (mobile)

#### Step 10: Summary Cards Component
**File**: `src/views/dashboard/components/DashboardSummaryCards.vue`
**Depends on**: Step 7
**Parallel**: Yes

**Features**:
- 4 cards in responsive grid (4 col → 2x2 → 1 col)
- Icons from Material Design Icons (`mdi-*`)
- Trend indicators (up/down arrows with percentage)
- Clickable cards (emit `card-clicked` event)
- Loading skeleton state
- Empty state handling

#### Step 11: Chart Components (4x)
**Files**: 
- `src/views/dashboard/components/DashboardTrendsChart.vue` (Line)
- `src/views/dashboard/components/DashboardSearchEngineChart.vue` (Bar)
- `src/views/dashboard/components/DashboardEmailStatusChart.vue` (Pie)
- `src/views/dashboard/components/DashboardActivityChart.vue` (Area)

**Depends on**: Step 7, ApexCharts installed
**Parallel**: Yes (all 4 can be developed in parallel)

**Common Features**:
- Vue3-ApexCharts integration
- Responsive sizing
- Theme-aware (follow Vuetify theme)
- Loading state
- Empty state
- Error handling

#### Step 12: Loading & Empty State Components
**Files**:
- `src/views/dashboard/components/DashboardLoading.vue`
- `src/views/dashboard/components/DashboardEmptyState.vue`

**Depends on**: None
**Parallel**: Yes

**Features**:
- Skeleton loaders for cards and charts
- Empty state with helpful message
- Error state with retry button

#### Step 13: Main Dashboard Page
**File**: `src/views/dashboard/home.vue`
**Depends on**: Steps 7-12 complete
**Parallel**: No (integration step)

**Features**:
- Compose all components
- Manage state (date range, loading, errors)
- Implement 5-minute caching logic
- Handle manual refresh
- Debounce date range changes (300ms)
- Lazy load charts on scroll (Intersection Observer)

### Frontend Performance Optimizations

#### Step 14: Caching Layer
**Location**: `src/views/dashboard/home.vue`
**Implementation**:
```typescript
const cache = ref<{
  data: DashboardSummary | null,
  timestamp: number
}>({ data: null, timestamp: 0 })

const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

function isCacheValid(): boolean {
  return cache.value.data && (Date.now() - cache.value.timestamp < CACHE_DURATION)
}
```

#### Step 15: Lazy Loading
**Location**: Chart components
**Implementation**: Use Intersection Observer API to load charts only when visible

#### Step 16: Debouncing
**Location**: Date filter component
**Implementation**: Debounce date range changes by 300ms using lodash.debounce or custom implementation

## Implementation Order Summary

### Phase A: Backend Foundation (Sequential)
1. Create types (`dashboardType.ts`)
2. Add channel constants (`channellist.ts`)
3. Implement controller (`DashboardController.ts`)
4. Create IPC handlers (`dashboard-ipc.ts`)
5. Register handlers (`index.ts`)
6. **Update preload.ts** (CRITICAL - add channels to whitelist)

### Phase B: Frontend Foundation (Can overlap with Phase A)
7. Create API wrapper (`api/dashboard.ts`)
8. Create utility functions (`utils/dateUtils.ts`)

### Phase C: Frontend Components (Parallel development possible)
9. Date Range Filter component
10. Summary Cards component
11. Chart components (4x - can be parallel)
12. Loading & Empty State components

### Phase D: Integration & Polish (Sequential)
13. Integrate all components in main dashboard page
14. Implement caching layer
15. Implement lazy loading
16. Implement debouncing
17. Manual testing and refinement

## Dependencies to Install

```bash
yarn add apexcharts vue3-apexcharts date-fns
```

## Database Indexes (Migration Required)

Execute the SQL statements in the "Database Migration" section above before implementing the controller.

## Critical Implementation Notes

1. **Preload.ts Update**: When adding new IPC channels, MUST add them to the `validChannels` array in preload.ts, otherwise IPC calls will fail silently.

2. **No Test Code**: Per user specification, no test files will be generated. Manual testing using Electron DevTools and console logging is expected.

3. **Type Safety**: Strictly follow TypeScript best practices. No `any` types. Use `unknown` for truly unknown types.

4. **Error Handling**: All IPC handlers must return `CommonMessage<T>` format with proper error messages.

5. **Performance**: 
   - Database queries must use indexes
   - Implement client-side caching (5 min)
   - Debounce date filter changes (300ms)
   - Lazy load charts

6. **Responsive Design**: Test at all 3 breakpoints (< 768px, 768-1199px, ≥ 1200px)

## Next Steps

1. **Execute Phase 0 Research** - Complete `research.md`
2. **Review Phase 1 Designs** - Review data-model.md and contracts/
3. **Begin Implementation** - Start with Phase A (Backend Foundation)
4. **Incremental Testing** - Test each backend endpoint before moving to frontend
5. **Integration Testing** - Test complete dashboard after Phase D

---

**Plan Version**: 1.0  
**Status**: Ready for Implementation  
**Estimated Effort**: 3-4 weeks  
**Backend Tasks**: 6 tasks (Steps 1-6)  
**Frontend Tasks**: 10 tasks (Steps 7-16)  
**Critical Path**: Backend → Frontend API → Components → Integration

