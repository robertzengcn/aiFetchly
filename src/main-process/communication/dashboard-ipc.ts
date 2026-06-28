import { ipcMain } from 'electron';
import { DashboardController } from '@/controller/DashboardController';
import {
  DASHBOARD_SUMMARY,
  DASHBOARD_TRENDS,
  DASHBOARD_SEARCH_ENGINES,
  DASHBOARD_EMAIL_STATUS
} from '@/config/channellist';
import { registerValidatedHandler } from '@/main-process/communication/_shared/registerValidatedHandler';
import {
  dashboardDateRangeInputSchema,
  dashboardTrendsInputSchema,
} from '@/schemas/ipc/dashboard';

/**
 * Register Dashboard IPC handlers.
 *
 * All 4 handlers go through registerValidatedHandler now:
 *  - schema validates startDate/endDate strings parse as real dates
 *    (replaces manual isNaN(new Date(str).getTime()) checks)
 *  - schema requires both dates present (replaces "startDate and endDate
 *    are required" runtime check)
 *  - start <= end ordering enforced inside handler via thrown Error
 *    (caught and wrapped by wrapper as status:false envelope)
 *
 * Envelope caveat: original returned specific success messages like
 * "Dashboard summary retrieved successfully"; wrapper standardizes to
 * msg:'ok'. Frontend should rely on status + data, not msg wording.
 */
export function registerDashboardIpcHandlers(): void {
  console.log("Dashboard IPC handlers registered");

  // Summary Statistics
  registerValidatedHandler(
    DASHBOARD_SUMMARY,
    dashboardDateRangeInputSchema,
    async (input) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);
      if (startDate > endDate) {
        throw new Error('Start date must be before end date');
      }
      const controller = new DashboardController();
      await controller.ensureConnection();
      return controller.getSummaryStats(startDate, endDate);
    },
  );

  // Trends Data
  registerValidatedHandler(
    DASHBOARD_TRENDS,
    dashboardTrendsInputSchema,
    async (input) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);
      if (startDate > endDate) {
        throw new Error('Start date must be before end date');
      }
      const controller = new DashboardController();
      await controller.ensureConnection();
      return controller.getTrendData(startDate, endDate, input.groupBy);
    },
  );

  // Search Engine Breakdown
  registerValidatedHandler(
    DASHBOARD_SEARCH_ENGINES,
    dashboardDateRangeInputSchema,
    async (input) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);
      if (startDate > endDate) {
        throw new Error('Start date must be before end date');
      }
      const controller = new DashboardController();
      await controller.ensureConnection();
      return controller.getSearchEngineBreakdown(startDate, endDate);
    },
  );

  // Email Status Breakdown
  registerValidatedHandler(
    DASHBOARD_EMAIL_STATUS,
    dashboardDateRangeInputSchema,
    async (input) => {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);
      if (startDate > endDate) {
        throw new Error('Start date must be before end date');
      }
      const controller = new DashboardController();
      await controller.ensureConnection();
      return controller.getEmailStatusBreakdown(startDate, endDate);
    },
  );
}
