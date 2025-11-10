import { windowInvoke } from '@/views/utils/apirequest';
import {
  DASHBOARD_SUMMARY,
  DASHBOARD_TRENDS,
  DASHBOARD_SEARCH_ENGINES,
  DASHBOARD_EMAIL_STATUS
} from '@/config/channellist';
import {
  DashboardSummaryRequest,
  DashboardSummaryResponse,
  DashboardTrendsRequest,
  DashboardTrendsResponse,
  DashboardSearchEnginesRequest,
  DashboardSearchEnginesResponse,
  DashboardEmailStatusRequest,
  DashboardEmailStatusResponse,
  DashboardSummary,
  TrendData,
  SearchEngineBreakdown,
  EmailStatusBreakdown
} from '@/entityTypes/dashboardType';

/**
 * Fetch dashboard summary statistics
 * @param startDate ISO 8601 date string (YYYY-MM-DD)
 * @param endDate ISO 8601 date string (YYYY-MM-DD)
 */
export async function getDashboardSummary(startDate: string, endDate: string): Promise<DashboardSummary> {
  const request: DashboardSummaryRequest = {
    startDate,
    endDate
  };
  return await windowInvoke(DASHBOARD_SUMMARY, request);
}

/**
 * Fetch dashboard trend data for charts
 * @param startDate ISO 8601 date string (YYYY-MM-DD)
 * @param endDate ISO 8601 date string (YYYY-MM-DD)
 * @param groupBy Optional granularity ('day', 'week', 'month'). Auto-determined if not specified.
 */
export async function getDashboardTrends(
  startDate: string,
  endDate: string,
  groupBy?: 'day' | 'week' | 'month'
): Promise<TrendData> {
  const request: DashboardTrendsRequest = {
    startDate,
    endDate,
    groupBy
  };
  return await windowInvoke(DASHBOARD_TRENDS, request);
}

/**
 * Fetch search engine breakdown data
 * @param startDate ISO 8601 date string (YYYY-MM-DD)
 * @param endDate ISO 8601 date string (YYYY-MM-DD)
 */
export async function getSearchEngineBreakdown(startDate: string, endDate: string): Promise<SearchEngineBreakdown> {
  const request: DashboardSearchEnginesRequest = {
    startDate,
    endDate
  };
  return await windowInvoke(DASHBOARD_SEARCH_ENGINES, request);
}

/**
 * Fetch email status breakdown data
 * @param startDate ISO 8601 date string (YYYY-MM-DD)
 * @param endDate ISO 8601 date string (YYYY-MM-DD)
 */
export async function getEmailStatusBreakdown(startDate: string, endDate: string): Promise<EmailStatusBreakdown> {
  const request: DashboardEmailStatusRequest = {
    startDate,
    endDate
  };
  return await windowInvoke(DASHBOARD_EMAIL_STATUS, request);
}

