# Dashboard Statistical Analytics System - Product Requirements Document

## 1. Executive Summary

### 1.1 Overview
The Dashboard Statistical Analytics System is a comprehensive, responsive web dashboard designed to provide real-time insights and visualizations of key metrics from the aiFetchly application. The dashboard will display statistical charts and analytics for search engine results, email extraction, yellow pages data, and email marketing campaigns, all within a fully responsive design that works seamlessly across desktop, tablet, and mobile devices.

### 1.2 Objectives
- Provide real-time statistical insights into application activity
- Display visual analytics through interactive charts and graphs
- Ensure full responsive web design for all screen sizes
- Integrate seamlessly with existing aiFetchly architecture
- Enable users to quickly understand their data at a glance
- Support customizable date range filtering

### 1.3 Success Metrics
- Dashboard loads in under 2 seconds
- Charts render smoothly with smooth animations
- Responsive design works on all screen sizes (320px to 4K)
- Data accuracy: 100% reflection of actual database records
- User engagement: 80%+ of users access dashboard daily

## 2. Dashboard Requirements

### 2.1 Layout Structure (Responsive Grid System)

#### Desktop View (≥1200px)
```
┌─────────────────────────────────────────────────────────────────┐
│  Summary Cards (4 columns)                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Search   │ │  Email   │ │ Yellow   │ │  Email   │          │
│  │ Results  │ │Extracted │ │  Pages   │ │   Sent   │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  Charts Section (2x2 grid)                                       │
│  ┌────────────────────┐ ┌────────────────────┐               │
│  │  Line Chart        │ │  Bar Chart          │               │
│  │  Trends Over Time  │ │  By Search Engine   │               │
│  └────────────────────┘ └────────────────────┘               │
│  ┌────────────────────┐ ┌────────────────────┐               │
│  │  Pie Chart         │ │  Area Chart         │               │
│  │  Email Status      │ │  Daily Activity     │               │
│  └────────────────────┘ └────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

#### Tablet View (768px - 1199px)
```
┌──────────────────────────────────────┐
│  Summary Cards (2x2 grid)             │
│  ┌──────────┐ ┌──────────┐          │
│  │ Search   │ │  Email   │          │
│  │ Results  │ │Extracted │          │
│  └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐          │
│  │ Yellow   │ │  Email   │          │
│  │  Pages   │ │   Sent   │          │
│  └──────────┘ └──────────┘          │
├──────────────────────────────────────┤
│  Charts Section (1 column stacked)   │
│  ┌────────────────────┐              │
│  │  Line Chart        │              │
│  └────────────────────┘              │
│  ┌────────────────────┐              │
│  │  Bar Chart         │              │
│  └────────────────────┘              │
│  ┌────────────────────┐              │
│  │  Pie Chart         │              │
│  └────────────────────┘              │
│  ┌────────────────────┐              │
│  │  Area Chart        │              │
│  └────────────────────┘              │
└──────────────────────────────────────┘
```

#### Mobile View (<768px)
```
┌────────────────────┐
│  Summary Cards      │
│  (1 column stack)   │
│  ┌──────────┐       │
│  │ Search   │       │
│  │ Results  │       │
│  └──────────┘       │
│  ┌──────────┐       │
│  │  Email   │       │
│  │Extracted │       │
│  └──────────┘       │
│  ┌──────────┐       │
│  │ Yellow   │       │
│  │  Pages   │       │
│  └──────────┘       │
│  ┌──────────┐       │
│  │  Email   │       │
│  │   Sent   │       │
│  └──────────┘       │
├────────────────────┤
│  Charts             │
│  (1 column stack)   │
│  ┌──────────┐       │
│  │  Line    │       │
│  │  Chart   │       │
│  └──────────┘       │
│  ┌──────────┐       │
│  │   Bar    │       │
│  │  Chart   │       │
│  └──────────┘       │
│  ┌──────────┐       │
│  │   Pie    │       │
│  │  Chart   │       │
│  └──────────┘       │
│  ┌──────────┐       │
│  │  Area    │       │
│  │  Chart   │       │
│  └──────────┘       │
└────────────────────┘
```

### 2.2 Summary Cards Component

#### Card 1: Search Engine Results
- **Title**: "Search Results"
- **Icon**: `mdi-magnify` or similar search icon
- **Primary Metric**: Total count from `search_result` table
- **Secondary Info**: Count for selected time period (e.g., "Last 30 days: 1,234")
- **Trend Indicator**: Up/Down arrow with percentage change vs. previous period
- **Color Scheme**: Primary blue
- **Click Action**: Navigate to search results list page

#### Card 2: Emails Extracted
- **Title**: "Emails Extracted"
- **Icon**: `mdi-email-multiple` or similar email icon
- **Primary Metric**: Total count from `emailsearch_result` table
- **Secondary Info**: Count for selected time period
- **Trend Indicator**: Up/Down arrow with percentage change
- **Color Scheme**: Success green
- **Click Action**: Navigate to email extraction results page

#### Card 3: Yellow Pages Results
- **Title**: "Yellow Pages"
- **Icon**: `mdi-book-open-page-variant` or similar yellow pages icon
- **Primary Metric**: Total count from `yellow_pages_result` table
- **Secondary Info**: Count for selected time period
- **Trend Indicator**: Up/Down arrow with percentage change
- **Color Scheme**: Warning amber/yellow
- **Click Action**: Navigate to yellow pages results page

#### Card 4: Emails Sent
- **Title**: "Emails Sent"
- **Icon**: `mdi-email-send` or similar send icon
- **Primary Metric**: Total count from `emailmarketing_send_log` table where `status = success`
- **Secondary Info**: Success rate (e.g., "98% success rate")
- **Trend Indicator**: Up/Down arrow with percentage change
- **Color Scheme**: Info cyan/blue
- **Click Action**: Navigate to email marketing log page

### 2.3 Chart Components

#### Chart 1: Line Chart - Trends Over Time
- **Type**: Multi-line line chart
- **X-axis**: Date (days/weeks/months based on date range)
- **Y-axis**: Count (numeric scale)
- **Data Series**:
  - Search Results (blue line)
  - Emails Extracted (green line)
  - Yellow Pages Results (yellow line)
  - Emails Sent (cyan line)
- **Features**:
  - Interactive tooltips on hover
  - Legend with toggleable series
  - Zoom and pan capabilities (desktop)
  - Responsive height adjustment
- **Data Source**: Aggregated daily counts from respective tables

#### Chart 2: Bar Chart - By Search Engine
- **Type**: Vertical bar chart
- **X-axis**: Search Engine name (Google, Bing, DuckDuckGo, etc.)
- **Y-axis**: Result count
- **Features**:
  - Color-coded bars
  - Value labels on top of bars
  - Interactive click to filter
- **Data Source**: `search_result` table grouped by search engine (from `keyword_id` → search task → engine type)

#### Chart 3: Pie/Doughnut Chart - Email Send Status
- **Type**: Doughnut chart (preferred for better readability)
- **Segments**:
  - Successful (green)
  - Failed (red)
  - Pending (yellow)
- **Features**:
  - Percentage labels on segments
  - Interactive legend
  - Hover effects
- **Data Source**: `emailmarketing_send_log` table grouped by `status` field

#### Chart 4: Area Chart - Daily Activity Breakdown
- **Type**: Stacked area chart
- **X-axis**: Date
- **Y-axis**: Count (stacked)
- **Data Series** (stacked areas):
  - Search Results (bottom layer, blue)
  - Emails Extracted (second layer, green)
  - Yellow Pages Results (third layer, yellow)
  - Emails Sent (top layer, cyan)
- **Features**:
  - Interactive tooltips showing all values
  - Smooth transitions
  - Gradient fills
- **Data Source**: Aggregated daily counts from all sources

### 2.4 Responsive Design Requirements

#### Breakpoints
- **Mobile**: < 768px
- **Tablet**: 768px - 1199px
- **Desktop**: ≥ 1200px
- **Large Desktop**: ≥ 1920px

#### Responsive Behavior

**Summary Cards:**
- **Desktop**: 4 columns in a row
- **Tablet**: 2x2 grid
- **Mobile**: Single column stack

**Charts:**
- **Desktop**: 2x2 grid layout
- **Tablet**: Single column, full width
- **Mobile**: Single column, full width, simplified tooltips

**Chart Sizing:**
- **Desktop**: Charts maintain aspect ratio, minimum height 400px
- **Tablet**: Charts full width, minimum height 350px
- **Mobile**: Charts full width, minimum height 300px, simplified legends

**Typography:**
- **Desktop**: Standard font sizes (16px base)
- **Tablet**: Slightly reduced (15px base)
- **Mobile**: Optimized for readability (14px base, larger headings)

**Interactive Elements:**
- **Desktop**: Full hover effects, tooltips, zoom/pan
- **Tablet**: Touch-friendly, simplified interactions
- **Mobile**: Touch-optimized, larger tap targets (min 44px)

#### Touch and Mobile Optimizations
- All interactive elements minimum 44px touch target
- Swipe gestures for navigating between charts (mobile)
- Simplified tooltips on mobile (show on tap, auto-hide)
- Horizontal scroll indicators for date ranges
- Pull-to-refresh for data updates (mobile)

### 2.5 Date Range Filtering

#### Date Range Options
- **Quick Filters**: 
  - Last 7 days
  - Last 30 days
  - Last 90 days
  - Last 365 days
  - All time
- **Custom Range**: 
  - Date picker for start and end dates
  - Maximum range: 2 years
  - Minimum range: 1 day

#### UI Component
- **Desktop**: Dropdown + date picker component
- **Tablet**: Collapsible panel with date picker
- **Mobile**: Modal overlay with date picker

#### Behavior
- Selected range applies to all charts simultaneously
- Summary cards update based on selected range
- Default selection: "Last 30 days"
- Real-time update when range changes (debounced)

### 2.6 Additional Features

#### Data Refresh
- **Manual Refresh Button**: 
  - Icon: `mdi-refresh`
  - Location: Top right of dashboard
  - Loading state during refresh
- **Auto-refresh**: 
  - Optional setting (disabled by default)
  - Configurable interval (1, 5, 15, 30 minutes)
  - Respects user's active state (pause when tab inactive)

#### Export Functionality
- **Export Options**:
  - Export chart data as CSV
  - Export chart as PNG image
  - Export full dashboard report as PDF
- **UI**: Dropdown menu in top right
- **Available on**: Desktop and Tablet (simplified on mobile)

#### Loading States
- **Initial Load**: Skeleton screens for all cards and charts
- **Data Fetch**: Loading spinners with progress indication
- **Empty State**: Friendly messages when no data available
- **Error State**: Clear error messages with retry button

#### Performance Optimizations
- Lazy load charts (load as user scrolls into view)
- Data caching (5-minute cache with manual refresh override)
- Debounced date range changes
- Optimized database queries with indexes

## 3. Technical Architecture

### 3.1 Frontend Stack

**Framework & UI Library:**
- **Vue 3** (Composition API)
- **Vuetify 3** (Material Design components)
- **TypeScript** (Type safety)

**Chart Library:**
- **ApexCharts** or **Chart.js with vue-chartjs**
  - Recommendation: **ApexCharts** (better Vue integration, more features)
  - Alternative: **Chart.js** (lighter weight, good performance)

**State Management:**
- Vue Composition API `ref`/`reactive`
- Optional: Pinia for complex state if needed

**API Communication:**
- Existing `apirequest.ts` utilities
- Existing IPC communication patterns

### 3.2 Backend/API Requirements

#### New API Endpoints Needed

**Endpoint 1: Dashboard Summary Stats**
```
GET /api/dashboard/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD

Response:
{
  searchResults: {
    total: number,
    periodCount: number,
    trend: number, // percentage change
    trendDirection: 'up' | 'down'
  },
  emailsExtracted: { ... },
  yellowPagesResults: { ... },
  emailsSent: {
    total: number,
    periodCount: number,
    successRate: number,
    trend: number,
    trendDirection: 'up' | 'down'
  }
}
```

**Endpoint 2: Dashboard Trends**
```
GET /api/dashboard/trends?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&groupBy=day|week|month

Response:
{
  dates: string[],
  searchResults: number[],
  emailsExtracted: number[],
  yellowPagesResults: number[],
  emailsSent: number[]
}
```

**Endpoint 3: Search Engine Breakdown**
```
GET /api/dashboard/search-engines?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD

Response:
{
  engines: [
    { name: string, count: number }
  ]
}
```

**Endpoint 4: Email Status Breakdown**
```
GET /api/dashboard/email-status?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD

Response:
{
  successful: number,
  failed: number,
  pending: number
}
```

### 3.3 Database Queries

#### Query Patterns (Optimized)

**Search Results Count:**
```sql
-- Summary count
SELECT COUNT(*) FROM search_result 
WHERE record_time >= ? AND record_time <= ?

-- Daily breakdown
SELECT DATE(record_time) as date, COUNT(*) as count 
FROM search_result 
WHERE record_time >= ? AND record_time <= ?
GROUP BY DATE(record_time)
ORDER BY date

-- By search engine (requires join with search_task)
SELECT se.engine_name, COUNT(*) as count
FROM search_result sr
JOIN search_keyword sk ON sr.keyword_id = sk.id
JOIN search_task st ON sk.task_id = st.id
WHERE sr.record_time >= ? AND sr.record_time <= ?
GROUP BY se.engine_name
```

**Email Extraction Count:**
```sql
-- Summary count
SELECT COUNT(*) FROM emailsearch_result 
WHERE record_time >= ? AND record_time <= ?

-- Daily breakdown
SELECT DATE(record_time) as date, COUNT(*) as count 
FROM emailsearch_result 
WHERE record_time >= ? AND record_time <= ?
GROUP BY DATE(record_time)
ORDER BY date
```

**Yellow Pages Count:**
```sql
-- Summary count
SELECT COUNT(*) FROM yellow_pages_result 
WHERE scraped_at >= ? AND scraped_at <= ?

-- Daily breakdown
SELECT DATE(scraped_at) as date, COUNT(*) as count 
FROM yellow_pages_result 
WHERE scraped_at >= ? AND scraped_at <= ?
GROUP BY DATE(scraped_at)
ORDER BY date
```

**Email Sent Count:**
```sql
-- Summary count with success rate
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as successful,
  SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as failed
FROM emailmarketing_send_log 
WHERE record_time >= ? AND record_time <= ?

-- Daily breakdown
SELECT 
  DATE(record_time) as date, 
  COUNT(*) as total,
  SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as successful
FROM emailmarketing_send_log 
WHERE record_time >= ? AND record_time <= ?
GROUP BY DATE(record_time)
ORDER BY date

-- Status breakdown
SELECT 
  status,
  COUNT(*) as count
FROM emailmarketing_send_log 
WHERE record_time >= ? AND record_time <= ?
GROUP BY status
```

#### Database Optimization
- **Indexes Required**:
  - `search_result.record_time` index
  - `emailsearch_result.record_time` index
  - `yellow_pages_result.scraped_at` index
  - `emailmarketing_send_log.record_time` index
  - `emailmarketing_send_log.status` index

### 3.4 Component Structure

```
src/views/dashboard/
├── home.vue                    # Main dashboard page
├── components/
│   ├── DashboardSummaryCards.vue    # Summary cards component
│   ├── DashboardTrendsChart.vue     # Line chart component
│   ├── DashboardSearchEngineChart.vue # Bar chart component
│   ├── DashboardEmailStatusChart.vue  # Pie chart component
│   ├── DashboardActivityChart.vue     # Area chart component
│   ├── DashboardDateRangeFilter.vue   # Date filter component
│   └── DashboardEmptyState.vue        # Empty state component
└── api/
    └── dashboard.ts            # Dashboard API functions
```

## 4. Implementation Plan

### 4.1 Phase 1: Foundation (Week 1)
- ✅ Set up dashboard route and basic page structure
- ✅ Create responsive grid layout
- ✅ Implement summary cards component
- ✅ Add date range filter component
- ✅ Set up API endpoints structure

### 4.2 Phase 2: Charts Implementation (Week 2)
- ✅ Integrate chart library (ApexCharts or Chart.js)
- ✅ Implement Line Chart (Trends Over Time)
- ✅ Implement Bar Chart (Search Engine Breakdown)
- ✅ Implement Pie Chart (Email Status)
- ✅ Implement Area Chart (Daily Activity)

### 4.3 Phase 3: Backend Integration (Week 2-3)
- ✅ Create dashboard controller/module
- ✅ Implement database queries with indexes
- ✅ Create API endpoints
- ✅ Add caching layer
- ✅ Optimize query performance

### 4.4 Phase 4: Responsive Refinement (Week 3)
- ✅ Mobile layout optimization
- ✅ Tablet layout optimization
- ✅ Touch interactions
- ✅ Performance optimization
- ✅ Loading and error states

### 4.5 Phase 5: Polish & Testing (Week 4)
- ✅ Export functionality
- ✅ Auto-refresh feature
- ✅ Accessibility improvements
- ✅ Cross-browser testing
- ✅ User acceptance testing

## 5. Design Specifications

### 5.1 Color Scheme
- **Primary**: Material Design primary color (blue)
- **Success**: Material Design success color (green)
- **Warning**: Material Design warning color (amber/yellow)
- **Info**: Material Design info color (cyan)
- **Error**: Material Design error color (red)

### 5.2 Typography
- **Headings**: Roboto Medium
- **Body**: Roboto Regular
- **Numbers**: Roboto Medium (for emphasis)

### 5.3 Spacing
- **Card Padding**: 16px (mobile), 24px (desktop)
- **Grid Gaps**: 16px (mobile), 24px (desktop)
- **Chart Margins**: 16px all around

### 5.4 Animation
- **Chart Loading**: Fade in with slight scale (300ms)
- **Card Updates**: Smooth number counting animation
- **Hover Effects**: Subtle elevation changes
- **Page Transitions**: Smooth fade (200ms)

## 6. Accessibility Requirements

- **WCAG 2.1 AA Compliance**
- Keyboard navigation for all interactive elements
- Screen reader support for all charts (aria-labels)
- Color contrast ratios meet WCAG standards
- Focus indicators clearly visible
- Alt text for all icons and images

## 7. Testing Requirements

### 7.1 Unit Tests
- Component rendering tests
- API call tests
- Data transformation tests

### 7.2 Integration Tests
- API endpoint tests
- Database query tests
- Chart rendering tests

### 7.3 E2E Tests
- Dashboard load and display
- Date range filtering
- Chart interactions
- Responsive layout switching

### 7.4 Performance Tests
- Initial load time (< 2 seconds)
- Chart render time (< 500ms per chart)
- API response time (< 300ms)
- Memory usage (charts cleanup)

## 8. Future Enhancements (Out of Scope for MVP)

- Real-time WebSocket updates
- Customizable dashboard layout (drag & drop)
- More chart types (heatmaps, scatter plots)
- Data drill-down capabilities
- Comparison mode (compare two time periods)
- Scheduled email reports
- Dashboard sharing/export

## 9. Dependencies

### Frontend
- `vue`: ^3.3.0
- `vuetify`: ^3.5.0
- `apexcharts`: ^3.40.0 (or `chart.js`: ^4.4.0 + `vue-chartjs`: ^5.3.0)
- `date-fns`: ^2.30.0 (for date formatting)

### Backend
- Existing database infrastructure
- Existing API patterns
- No new dependencies required

## 10. Success Criteria

### Functional
- ✅ All 4 summary cards display accurate counts
- ✅ All 4 charts render correctly with data
- ✅ Date range filtering works for all components
- ✅ Responsive design works on mobile, tablet, desktop
- ✅ Export functionality works

### Performance
- ✅ Dashboard loads in < 2 seconds
- ✅ Charts render in < 500ms each
- ✅ API responses < 300ms
- ✅ Smooth scrolling and interactions

### User Experience
- ✅ Intuitive navigation
- ✅ Clear visual hierarchy
- ✅ Helpful tooltips and labels
- ✅ Smooth animations
- ✅ Accessible to all users

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Status**: Ready for Implementation

