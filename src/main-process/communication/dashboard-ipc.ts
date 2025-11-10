import { ipcMain } from 'electron';
import { DashboardController } from '@/controller/DashboardController';
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
  DashboardEmailStatusResponse
} from '@/entityTypes/dashboardType';
import { CommonMessage } from '@/entityTypes/commonType';

/**
 * Register Dashboard IPC handlers
 */
export function registerDashboardIpcHandlers(): void {
  console.log("Dashboard IPC handlers registered");

  // Dashboard Summary Statistics
  ipcMain.handle(DASHBOARD_SUMMARY, async (event, data): Promise<DashboardSummaryResponse> => {
    try {
      const controller = new DashboardController();
      const request: DashboardSummaryRequest = typeof data === 'string' ? JSON.parse(data) : data;

      // Validate request
      if (!request.startDate || !request.endDate) {
        const errorResponse: DashboardSummaryResponse = {
          status: false,
          msg: "Invalid request: startDate and endDate are required"
        };
        return errorResponse;
      }

      // Parse dates
      const startDate = new Date(request.startDate);
      const endDate = new Date(request.endDate);

      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        const errorResponse: DashboardSummaryResponse = {
          status: false,
          msg: "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)"
        };
        return errorResponse;
      }

      if (startDate > endDate) {
        const errorResponse: DashboardSummaryResponse = {
          status: false,
          msg: "Start date must be before end date"
        };
        return errorResponse;
      }

      // Fetch dashboard summary
      const summary = await controller.getSummaryStats(startDate, endDate);

      const response: DashboardSummaryResponse = {
        status: true,
        msg: "Dashboard summary retrieved successfully",
        data: summary
      };
      return response;
    } catch (error) {
      console.error('Dashboard summary error:', error);
      const errorResponse: DashboardSummaryResponse = {
        status: false,
        msg: error instanceof Error ? error.message : "Unknown error occurred"
      };
      return errorResponse;
    }
  });

  // Dashboard Trends Data
  ipcMain.handle(DASHBOARD_TRENDS, async (event, data): Promise<DashboardTrendsResponse> => {
    try {
      const controller = new DashboardController();
      const request: DashboardTrendsRequest = typeof data === 'string' ? JSON.parse(data) : data;

      // Validate request
      if (!request.startDate || !request.endDate) {
        const errorResponse: DashboardTrendsResponse = {
          status: false,
          msg: "Invalid request: startDate and endDate are required"
        };
        return errorResponse;
      }

      // Parse dates
      const startDate = new Date(request.startDate);
      const endDate = new Date(request.endDate);

      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        const errorResponse: DashboardTrendsResponse = {
          status: false,
          msg: "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)"
        };
        return errorResponse;
      }

      if (startDate > endDate) {
        const errorResponse: DashboardTrendsResponse = {
          status: false,
          msg: "Start date must be before end date"
        };
        return errorResponse;
      }

      // Fetch trend data
      const trends = await controller.getTrendData(startDate, endDate, request.groupBy);

      const response: DashboardTrendsResponse = {
        status: true,
        msg: "Dashboard trends retrieved successfully",
        data: trends
      };
      return response;
    } catch (error) {
      console.error('Dashboard trends error:', error);
      const errorResponse: DashboardTrendsResponse = {
        status: false,
        msg: error instanceof Error ? error.message : "Unknown error occurred"
      };
      return errorResponse;
    }
  });

  // Search Engine Breakdown
  ipcMain.handle(DASHBOARD_SEARCH_ENGINES, async (event, data): Promise<DashboardSearchEnginesResponse> => {
    try {
      const controller = new DashboardController();
      const request: DashboardSearchEnginesRequest = typeof data === 'string' ? JSON.parse(data) : data;

      // Validate request
      if (!request.startDate || !request.endDate) {
        const errorResponse: DashboardSearchEnginesResponse = {
          status: false,
          msg: "Invalid request: startDate and endDate are required"
        };
        return errorResponse;
      }

      // Parse dates
      const startDate = new Date(request.startDate);
      const endDate = new Date(request.endDate);

      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        const errorResponse: DashboardSearchEnginesResponse = {
          status: false,
          msg: "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)"
        };
        return errorResponse;
      }

      if (startDate > endDate) {
        const errorResponse: DashboardSearchEnginesResponse = {
          status: false,
          msg: "Start date must be before end date"
        };
        return errorResponse;
      }

      // Fetch search engine breakdown
      const breakdown = await controller.getSearchEngineBreakdown(startDate, endDate);

      const response: DashboardSearchEnginesResponse = {
        status: true,
        msg: "Search engine breakdown retrieved successfully",
        data: breakdown
      };
      return response;
    } catch (error) {
      console.error('Search engine breakdown error:', error);
      const errorResponse: DashboardSearchEnginesResponse = {
        status: false,
        msg: error instanceof Error ? error.message : "Unknown error occurred"
      };
      return errorResponse;
    }
  });

  // Email Status Breakdown
  ipcMain.handle(DASHBOARD_EMAIL_STATUS, async (event, data): Promise<DashboardEmailStatusResponse> => {
    try {
      const controller = new DashboardController();
      const request: DashboardEmailStatusRequest = typeof data === 'string' ? JSON.parse(data) : data;

      // Validate request
      if (!request.startDate || !request.endDate) {
        const errorResponse: DashboardEmailStatusResponse = {
          status: false,
          msg: "Invalid request: startDate and endDate are required"
        };
        return errorResponse;
      }

      // Parse dates
      const startDate = new Date(request.startDate);
      const endDate = new Date(request.endDate);

      // Validate dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        const errorResponse: DashboardEmailStatusResponse = {
          status: false,
          msg: "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)"
        };
        return errorResponse;
      }

      if (startDate > endDate) {
        const errorResponse: DashboardEmailStatusResponse = {
          status: false,
          msg: "Start date must be before end date"
        };
        return errorResponse;
      }

      // Fetch email status breakdown
      const breakdown = await controller.getEmailStatusBreakdown(startDate, endDate);

      const response: DashboardEmailStatusResponse = {
        status: true,
        msg: "Email status breakdown retrieved successfully",
        data: breakdown
      };
      return response;
    } catch (error) {
      console.error('Email status breakdown error:', error);
      const errorResponse: DashboardEmailStatusResponse = {
        status: false,
        msg: error instanceof Error ? error.message : "Unknown error occurred"
      };
      return errorResponse;
    }
  });
}

