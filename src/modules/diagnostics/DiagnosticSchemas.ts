'use strict';
import { z } from 'zod';

const processTypes = z.enum(['main', 'renderer', 'worker', 'utility', 'gpu', 'unknown']);
const crashTypes = z.enum([
  'uncaught-exception',
  'unhandled-rejection',
  'render-process-gone',
  'child-process-gone',
  'gpu-process-crashed',
  'worker-exit',
  'unclean-shutdown',
]);
const rfc3339 = z.string().refine(
  (v) => !Number.isNaN(Date.parse(v)),
  { message: 'timestamp must be RFC3339' }
);

export const diagnosticBreadcrumbSchema = z.object({
  timestamp: rfc3339,
  category: z.string().max(64),
  message: z.string().max(2048),
  level: z.enum(['info', 'warn', 'error']).optional(),
});
export type DiagnosticBreadcrumb = z.infer<typeof diagnosticBreadcrumbSchema>;

export const crashRecordSchema = z.object({
  schemaVersion: z.literal(1),
  timestamp: rfc3339,
  crashId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(128),
  installId: z.string().min(1).max(128),
  appVersion: z.string().min(1).max(64),
  platform: z.string().min(1).max(32),
  arch: z.string().min(1).max(32),
  processType: processTypes,
  crashType: crashTypes,
  feature: z.string().max(128).optional(),
  taskId: z.string().max(128).optional(),
  workerType: z.string().max(128).optional(),
  message: z.string().min(1).max(8 * 1024),
  stack: z.string().max(16 * 1024).optional(),
  reason: z.string().max(1024).optional(),
  exitCode: z.number().int().optional(),
  signal: z.string().max(32).optional(),
  breadcrumbs: z.array(diagnosticBreadcrumbSchema).max(200),
});
export type CrashRecord = z.infer<typeof crashRecordSchema>;

export const errorRecordSchema = z.object({
  schemaVersion: z.literal(1),
  timestamp: rfc3339,
  errorId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(128),
  level: z.enum(['warn', 'error']),
  processType: z.enum(['main', 'renderer', 'worker']),
  feature: z.string().max(128).optional(),
  message: z.string().min(1).max(8 * 1024),
  stack: z.string().max(16 * 1024).optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});
export type ErrorRecord = z.infer<typeof errorRecordSchema>;

export const diagnosticReportPackageSchema = z.object({
  schemaVersion: z.literal(1),
  appVersion: z.string().min(1).max(64),
  platform: z.string().min(1).max(32),
  arch: z.string().min(1).max(32),
  installId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  crash: crashRecordSchema,
  recentErrors: z.array(errorRecordSchema).max(100),
  breadcrumbs: z.array(diagnosticBreadcrumbSchema).max(200),
});
export type DiagnosticReportPackage = z.infer<typeof diagnosticReportPackageSchema>;
