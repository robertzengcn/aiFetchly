import { CommonMessage } from './commonType';

// Core Dashboard Data Models

export interface MetricSummary {
  total: number;                 // All-time total
  periodCount: number;           // Count for selected period
  trend: number;                 // Percentage change vs previous period
  trendDirection: 'up' | 'down' | 'neutral';
}

export interface EmailMetricSummary extends MetricSummary {
  successRate: number;           // Percentage of successful sends
  successCount: number;
  failedCount: number;
}

export interface DashboardSummary {
  searchResults: MetricSummary;
  emailsExtracted: MetricSummary;
  yellowPagesResults: MetricSummary;
  emailsSent: EmailMetricSummary;
}

// Trend Data (time series)
export interface TrendData {
  dates: string[];               // ISO date strings
  searchResults: number[];
  emailsExtracted: number[];
  yellowPagesResults: number[];
  emailsSent: number[];
}

// Search Engine Breakdown
export interface EngineMetric {
  name: string;                  // 'Google', 'Bing', 'DuckDuckGo', etc.
  count: number;
}

export interface SearchEngineBreakdown {
  engines: EngineMetric[];
}

// Email Status Breakdown
export interface EmailStatusBreakdown {
  successful: number;
  failed: number;
  pending: number;
}

// Date Range Filter
export interface DateRangeFilter {
  startDate: string;             // ISO date string
  endDate: string;               // ISO date string
  preset?: 'last7' | 'last30' | 'last90' | 'last365' | 'all' | 'custom';
}

// IPC Request/Response Types

export interface DashboardSummaryRequest {
  startDate: string;  // ISO 8601 format
  endDate: string;    // ISO 8601 format
}

export type DashboardSummaryResponse = CommonMessage<DashboardSummary>;

export interface DashboardTrendsRequest {
  startDate: string;
  endDate: string;
  groupBy?: 'day' | 'week' | 'month';  // Auto-determined if not specified
}

export type DashboardTrendsResponse = CommonMessage<TrendData>;

export interface DashboardSearchEnginesRequest {
  startDate: string;
  endDate: string;
}

export type DashboardSearchEnginesResponse = CommonMessage<SearchEngineBreakdown>;

export interface DashboardEmailStatusRequest {
  startDate: string;
  endDate: string;
}

export type DashboardEmailStatusResponse = CommonMessage<EmailStatusBreakdown>;

// Internal Controller Types (not exposed via IPC)

export interface DateRange {
  start: Date;
  end: Date;
  granularity: 'day' | 'week' | 'month';
}

export interface AggregatedCount {
  date: string;
  count: number;
}

