/**
 * Simple logger utility for AI recovery modules
 * Provides consistent logging format across all modules
 *
 * This module now re-exports the shared logger from src/utils/logger.ts
 * for consistency across the application.
 */

export { createLogger, Logger, LogLevel } from '@/utils/logger';
