import { format, subDays, startOfDay, endOfDay } from 'date-fns';

/**
 * Format a date for display to users
 * @param date Date object or ISO string
 * @param formatStr Format string (default: 'MMM dd, yyyy')
 */
export function formatDateForDisplay(date: Date | string, formatStr: string = 'MMM dd, yyyy'): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return format(dateObj, formatStr);
}

/**
 * Format a date for API calls (ISO 8601 YYYY-MM-DD format)
 * @param date Date object
 */
export function formatDateForAPI(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Get date range for preset filters
 * @param preset Quick filter preset
 */
export function getDateRangePreset(preset: 'last7' | 'last30' | 'last90' | 'last365' | 'all'): { startDate: Date; endDate: Date } {
  const endDate = endOfDay(new Date());
  let startDate: Date;

  switch (preset) {
    case 'last7':
      startDate = startOfDay(subDays(endDate, 6)); // Today + 6 days ago = 7 days
      break;
    case 'last30':
      startDate = startOfDay(subDays(endDate, 29)); // Today + 29 days ago = 30 days
      break;
    case 'last90':
      startDate = startOfDay(subDays(endDate, 89));
      break;
    case 'last365':
      startDate = startOfDay(subDays(endDate, 364));
      break;
    case 'all':
      // Set to a very early date for "all time" (e.g., January 1, 2020)
      startDate = startOfDay(new Date('2020-01-01'));
      break;
    default:
      startDate = startOfDay(subDays(endDate, 29)); // Default to last 30 days
  }

  return { startDate, endDate };
}

/**
 * Calculate days between two dates
 * @param startDate Start date
 * @param endDate End date
 */
export function getDaysBetween(startDate: Date, endDate: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const start = startOfDay(startDate).getTime();
  const end = startOfDay(endDate).getTime();
  return Math.ceil((end - start) / msPerDay);
}

/**
 * Validate date range
 * @param startDate Start date
 * @param endDate End date
 * @param maxDays Maximum allowed days (default: 730 = 2 years)
 */
export function validateDateRange(startDate: Date, endDate: Date, maxDays: number = 730): {
  valid: boolean;
  error?: string;
} {
  if (startDate > endDate) {
    return { valid: false, error: 'Start date must be before end date' };
  }

  const days = getDaysBetween(startDate, endDate);

  if (days < 1) {
    return { valid: false, error: 'Date range must be at least 1 day' };
  }

  if (days > maxDays) {
    return { valid: false, error: `Date range cannot exceed ${maxDays} days (${Math.floor(maxDays / 365)} years)` };
  }

  return { valid: true };
}

/**
 * Get user-friendly date range label
 * @param startDate Start date
 * @param endDate End date
 * @param preset Optional preset name
 */
export function getDateRangeLabel(startDate: Date, endDate: Date, preset?: string): string {
  if (preset) {
    const labels: Record<string, string> = {
      last7: 'Last 7 days',
      last30: 'Last 30 days',
      last90: 'Last 90 days',
      last365: 'Last 365 days',
      all: 'All time'
    };
    return labels[preset] || 'Custom range';
  }

  const start = formatDateForDisplay(startDate);
  const end = formatDateForDisplay(endDate);
  return `${start} - ${end}`;
}

