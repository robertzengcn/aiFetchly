'use strict';
import type { DiagnosticBreadcrumb, ErrorRecord } from './DiagnosticSchemas';

export class DiagnosticBreadcrumbBuffer {
  private breadcrumbs: DiagnosticBreadcrumb[] = [];
  private errors: ErrorRecord[] = [];

  constructor(
    private readonly maxBreadcrumbs = 200,
    private readonly maxErrors = 100,
  ) {}

  addBreadcrumb(b: DiagnosticBreadcrumb): void {
    this.breadcrumbs.push(b);
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.splice(0, this.breadcrumbs.length - this.maxBreadcrumbs);
    }
  }

  addError(e: ErrorRecord): void {
    this.errors.push(e);
    if (this.errors.length > this.maxErrors) {
      this.errors.splice(0, this.errors.length - this.maxErrors);
    }
  }

  getBreadcrumbs(): DiagnosticBreadcrumb[] {
    return [...this.breadcrumbs];
  }

  getRecentErrors(): ErrorRecord[] {
    return [...this.errors];
  }

  clear(): void {
    this.breadcrumbs = [];
    this.errors = [];
  }
}
