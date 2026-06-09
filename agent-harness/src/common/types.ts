/**
 * CLI-specific type definitions for the aiFetchly CLI harness.
 */

/** JSON envelope for all --json output */
export interface JsonEnvelope<T = unknown> {
  status: boolean;
  data: T | null;
  error?: string;
  meta: {
    timestamp: string;
    command: string;
  };
}

/** Pagination parameters shared across list commands */
export interface PaginationOptions {
  page: number;
  size: number;
  search?: string;
}

/** Paginated result wrapper */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

/** Export format options */
export type ExportFormat = 'csv' | 'json';

/** CLI global options */
export interface CliGlobalOptions {
  db?: string;
  json: boolean;
  readOnly: boolean;
  verbose: boolean;
  session?: string;
}

/** Session state persisted to disk */
export interface SessionState {
  id: string;
  dbPath: string;
  createdAt: string;
  lastActivity: string;
  commandHistory: string[];
  context: {
    activeTaskId?: number;
    activeSearchTaskId?: number;
    activeScheduleId?: number;
    outputFormat: 'table' | 'json';
    defaultPageSize: number;
  };
}

/** Column configuration for table rendering */
export interface ColumnConfig {
  key: string;
  header: string;
  width?: number;
  transform?: (value: unknown) => string;
}

/** Table configuration for formatted output */
export interface TableConfig {
  columns: ColumnConfig[];
  title?: string;
}
