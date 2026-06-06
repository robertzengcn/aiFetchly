// Budget constants
const MAX_AI_PAGES_PER_DOMAIN = 1;
const MAX_AI_FALLBACK = 1;
const MAX_AI_PAGES_PER_TASK = 20;
const MIN_CANDIDATE_SCORE = 30;

export class AiBudgetTracker {
  private domainUsage: Map<string, number> = new Map();
  private totalUsage: number = 0;
  private maxPerDomain: number;
  private maxTotal: number;

  constructor(maxPerDomain: number = MAX_AI_PAGES_PER_DOMAIN, maxTotal: number = MAX_AI_PAGES_PER_TASK) {
    this.maxPerDomain = maxPerDomain;
    this.maxTotal = maxTotal;
  }

  canRequest(domain: string): boolean {
    if (this.totalUsage >= this.maxTotal) {
      return false;
    }
    const domainCount = this.domainUsage.get(domain) || 0;
    return domainCount < this.maxPerDomain;
  }

  recordRequest(domain: string): void {
    this.totalUsage++;
    const current = this.domainUsage.get(domain) || 0;
    this.domainUsage.set(domain, current + 1);
  }

  shouldFallback(): boolean {
    return this.totalUsage >= MAX_AI_FALLBACK;
  }

  getRemainingBudget(): number {
    return Math.max(0, this.maxTotal - this.totalUsage);
  }

  getDomainUsage(domain: string): number {
    return this.domainUsage.get(domain) || 0;
  }
}
