import {
  DashboardSummary,
  MetricSummary,
  EmailMetricSummary,
  TrendData,
  SearchEngineBreakdown,
  EmailStatusBreakdown,
  DateRange,
  AggregatedCount,
  EngineMetric
} from '@/entityTypes/dashboardType';
import { SearchResultModule } from '@/modules/SearchResultModule';
import { EmailSearchTaskModule } from '@/modules/EmailSearchTaskModule';
import { YellowPagesResultModule } from '@/modules/YellowPagesResultModule';
import { EmailMarketingSendLogModule } from '@/modules/emailMarketingSendLogModule';
import { SearhEnginer } from '@/config/searchSetting';
import { getEnumValueByNumber } from '@/modules/lib/function';

export class DashboardController {
  private readonly searchResultModule: SearchResultModule;
  private readonly emailSearchTaskModule: EmailSearchTaskModule;
  private readonly yellowPagesResultModule: YellowPagesResultModule;
  private readonly emailMarketingSendLogModule: EmailMarketingSendLogModule;

  constructor() {
    this.searchResultModule = new SearchResultModule();
    this.emailSearchTaskModule = new EmailSearchTaskModule();
    this.yellowPagesResultModule = new YellowPagesResultModule();
    this.emailMarketingSendLogModule = new EmailMarketingSendLogModule();
  }
  /**
   * Get summary statistics for all metrics
   */
  async getSummaryStats(startDate: Date, endDate: Date): Promise<DashboardSummary> {
    const previousPeriod = this.calculatePreviousPeriod(startDate, endDate);

    // Fetch all metrics in parallel for performance
    const [
      searchResults,
      emailsExtracted,
      yellowPagesResults,
      emailsSent
    ] = await Promise.all([
      this.getSearchResultsSummary(startDate, endDate, previousPeriod.start, previousPeriod.end),
      this.getEmailsExtractedSummary(startDate, endDate, previousPeriod.start, previousPeriod.end),
      this.getYellowPagesSummary(startDate, endDate, previousPeriod.start, previousPeriod.end),
      this.getEmailsSentSummary(startDate, endDate, previousPeriod.start, previousPeriod.end)
    ]);

    return {
      searchResults,
      emailsExtracted,
      yellowPagesResults,
      emailsSent
    };
  }

  /**
   * Get trend data for charts
   */
  async getTrendData(startDate: Date, endDate: Date, groupBy?: 'day' | 'week' | 'month'): Promise<TrendData> {
    const granularity = groupBy || this.determineGranularity(startDate, endDate);

    // Fetch all trend data in parallel
    const [
      searchResults,
      emailsExtracted,
      yellowPagesResults,
      emailsSent
    ] = await Promise.all([
      this.getSearchResultsTrend(startDate, endDate, granularity),
      this.getEmailsExtractedTrend(startDate, endDate, granularity),
      this.getYellowPagesTrend(startDate, endDate, granularity),
      this.getEmailsSentTrend(startDate, endDate, granularity)
    ]);

    // Combine all dates and fill missing data
    const allDates = this.getAllDatesBetween(startDate, endDate, granularity);
    
    return {
      dates: allDates,
      searchResults: this.fillMissingData(allDates, searchResults),
      emailsExtracted: this.fillMissingData(allDates, emailsExtracted),
      yellowPagesResults: this.fillMissingData(allDates, yellowPagesResults),
      emailsSent: this.fillMissingData(allDates, emailsSent)
    };
  }

  /**
   * Get search engine breakdown
   */
  async getSearchEngineBreakdown(startDate: Date, endDate: Date): Promise<SearchEngineBreakdown> {
    try {
      // Get breakdown by engine ID
      const engineBreakdown = await this.searchResultModule.getBreakdownByEngine(startDate, endDate);

      // Map engine IDs to engine names
      const engines: EngineMetric[] = engineBreakdown.map(item => {
        const engineName = getEnumValueByNumber(SearhEnginer, item.engineId);
        return {
          name: engineName || `Unknown Engine (${item.engineId})`,
          count: item.count
        };
      });

      // Sort by count descending
      engines.sort((a, b) => b.count - a.count);

      return { engines };
    } catch (error) {
      console.error('Error fetching search engine breakdown:', error);
      return { engines: [] };
    }
  }

  /**
   * Get email status breakdown
   */
  async getEmailStatusBreakdown(startDate: Date, endDate: Date): Promise<EmailStatusBreakdown> {
    try {
      const statusRows = await this.emailMarketingSendLogModule.countStatusByDateRange(startDate, endDate);

      const breakdown: EmailStatusBreakdown = { successful: 0, failed: 0, pending: 0 };
      statusRows.forEach(row => {
        if (row.status === 1) {
          breakdown.successful = row.count;
        } else if (row.status === 0) {
          breakdown.failed = row.count;
        } else {
          breakdown.pending = row.count;
        }
      });

      return breakdown;
    } catch (error) {
      console.error('Error fetching email status breakdown:', error);
      return { successful: 0, failed: 0, pending: 0 };
    }
  }

  // Private helper methods

  private async getSearchResultsSummary(
    startDate: Date,
    endDate: Date,
    prevStartDate: Date,
    prevEndDate: Date
  ): Promise<MetricSummary> {
    const [total, periodCount, previousCount] = await Promise.all([
      this.searchResultModule.countAll(),
      this.searchResultModule.countByDateRange(startDate, endDate),
      this.searchResultModule.countByDateRange(prevStartDate, prevEndDate)
    ]);

    const { trend, trendDirection } = this.calculateTrend(periodCount, previousCount);

    return { total, periodCount, trend, trendDirection };
  }

  private async getEmailsExtractedSummary(
    startDate: Date,
    endDate: Date,
    prevStartDate: Date,
    prevEndDate: Date
  ): Promise<MetricSummary> {
    const [total, periodCount, previousCount] = await Promise.all([
      this.emailSearchTaskModule.countAllResults(),
      this.emailSearchTaskModule.countResultsByDateRange(startDate, endDate),
      this.emailSearchTaskModule.countResultsByDateRange(prevStartDate, prevEndDate)
    ]);

    const { trend, trendDirection } = this.calculateTrend(periodCount, previousCount);

    return { total, periodCount, trend, trendDirection };
  }

  private async getYellowPagesSummary(
    startDate: Date,
    endDate: Date,
    prevStartDate: Date,
    prevEndDate: Date
  ): Promise<MetricSummary> {
    const [total, periodCount, previousCount] = await Promise.all([
      this.yellowPagesResultModule.countResults(),
      this.yellowPagesResultModule.countResultsByDateRange(startDate, endDate),
      this.yellowPagesResultModule.countResultsByDateRange(prevStartDate, prevEndDate)
    ]);

    const { trend, trendDirection } = this.calculateTrend(periodCount, previousCount);

    return { total, periodCount, trend, trendDirection };
  }

  private async getEmailsSentSummary(
    startDate: Date,
    endDate: Date,
    prevStartDate: Date,
    prevEndDate: Date
  ): Promise<EmailMetricSummary> {
    const [totalResult, periodResult, previousResult] = await Promise.all([
      this.emailMarketingSendLogModule.countAll(),
      this.emailMarketingSendLogModule.countByDateRange(startDate, endDate),
      this.emailMarketingSendLogModule.countByDateRange(prevStartDate, prevEndDate)
    ]);

    const statusRows = await this.emailMarketingSendLogModule.countStatusByDateRange(startDate, endDate);
    let successCount = 0;
    let failedCount = 0;
    statusRows.forEach(row => {
      if (row.status === 1) {
        successCount = row.count;
      } else if (row.status === 0) {
        failedCount = row.count;
      }
    });

    const total = totalResult;
    const periodCount = periodResult;
    const previousCount = previousResult;

    const successRate = periodCount > 0 ? (successCount / periodCount) * 100 : 0;
    const { trend, trendDirection } = this.calculateTrend(periodCount, previousCount);

    return {
      total,
      periodCount,
      trend,
      trendDirection,
      successRate,
      successCount,
      failedCount
    };
  }

  private async getSearchResultsTrend(startDate: Date, endDate: Date, granularity: 'day' | 'week' | 'month'): Promise<AggregatedCount[]> {
    try {
      return await this.searchResultModule.aggregateByDateRange(startDate, endDate, granularity);
    } catch (error) {
      console.error('Error fetching search results trend:', error);
      return [];
    }
  }

  private async getEmailsExtractedTrend(startDate: Date, endDate: Date, granularity: 'day' | 'week' | 'month'): Promise<AggregatedCount[]> {
    try {
      return await this.emailSearchTaskModule.aggregateResultsByDateRange(startDate, endDate, granularity);
    } catch (error) {
      console.error('Error fetching emails extracted trend:', error);
      return [];
    }
  }

  private async getYellowPagesTrend(startDate: Date, endDate: Date, granularity: 'day' | 'week' | 'month'): Promise<AggregatedCount[]> {
    try {
      return await this.yellowPagesResultModule.aggregateResultsByDateRange(startDate, endDate, granularity);
    } catch (error) {
      console.error('Error fetching yellow pages trend:', error);
      return [];
    }
  }

  private async getEmailsSentTrend(startDate: Date, endDate: Date, granularity: 'day' | 'week' | 'month'): Promise<AggregatedCount[]> {
    try {
      return await this.emailMarketingSendLogModule.aggregateByDateRange(startDate, endDate, granularity);
    } catch (error) {
      console.error('Error fetching emails sent trend:', error);
      return [];
    }
  }

  /**
   * Calculate trend percentage and direction
   */
  private calculateTrend(current: number, previous: number): { trend: number; trendDirection: 'up' | 'down' | 'neutral' } {
    if (previous === 0) {
      if (current === 0) {
        return { trend: 0, trendDirection: 'neutral' };
      }
      return { trend: 100, trendDirection: 'up' };
    }

    const percentageChange = ((current - previous) / previous) * 100;
    const trend = Math.abs(percentageChange);

    let trendDirection: 'up' | 'down' | 'neutral' = 'neutral';
    if (percentageChange > 0) {
      trendDirection = 'up';
    } else if (percentageChange < 0) {
      trendDirection = 'down';
    }

    return { trend: Math.round(trend * 10) / 10, trendDirection };
  }

  /**
   * Determine appropriate granularity based on date range
   */
  private determineGranularity(startDate: Date, endDate: Date): 'day' | 'week' | 'month' {
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff <= 90) {
      return 'day';
    } else if (daysDiff <= 365) {
      return 'week';
    } else {
      return 'month';
    }
  }

  /**
   * Format date for SQLite queries
   */
  private formatDateForQuery(date: Date): string {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  /**
   * Get date format string for SQL GROUP BY based on granularity
   */
  /**
   * Calculate previous period for trend comparison
   */
  private calculatePreviousPeriod(startDate: Date, endDate: Date): { start: Date; end: Date } {
    const periodLength = endDate.getTime() - startDate.getTime();
    const previousEnd = new Date(startDate.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - periodLength);

    return {
      start: previousStart,
      end: previousEnd
    };
  }

  /**
   * Get all dates between start and end with given granularity
   */
  private getAllDatesBetween(startDate: Date, endDate: Date, granularity: 'day' | 'week' | 'month'): string[] {
    const keys: string[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      keys.push(this.formatDateKey(current, granularity));

      if (granularity === 'day') {
        current.setDate(current.getDate() + 1);
      } else if (granularity === 'week') {
        current.setDate(current.getDate() + 7);
      } else {
        current.setMonth(current.getMonth() + 1);
        current.setDate(1);
      }
    }

    return Array.from(new Set(keys));
  }

  /**
   * Fill missing dates with zero counts
   */
  private fillMissingData(allDates: string[], aggregatedData: AggregatedCount[]): number[] {
    const dataMap = new Map(aggregatedData.map(item => [item.date, item.count]));
    return allDates.map(date => dataMap.get(date) || 0);
  }

  private formatDateKey(date: Date, granularity: 'day' | 'week' | 'month'): string {
    if (granularity === 'week') {
      const week = this.getWeekNumber(date);
      return `${date.getFullYear()}-${week.toString().padStart(2, '0')}`;
    }
    if (granularity === 'month') {
      return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    }
    return this.formatDateForQuery(date);
  }

  private getWeekNumber(date: Date): number {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const dayOfYear = this.getDayOfYear(date);
    const week = Math.floor((dayOfYear - date.getDay() + 6) / 7);
    return Math.max(0, week);
  }

  private getDayOfYear(date: Date): number {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const diff = date.getTime() - startOfYear.getTime();
    return Math.floor(diff / (24 * 60 * 60 * 1000));
  }
}

