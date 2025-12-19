/**
 * Simple rate limiter for tool execution
 */

export interface RateLimitConfig {
    maxPerMinute: number;
    maxConcurrent: number;
    cooldownMs: number;
}

export class RateLimiter {
    private executionTimes: number[] = [];
    private concurrentCount = 0;
    private config: RateLimitConfig;

    constructor(config: RateLimitConfig) {
        this.config = config;
    }

    /**
     * Check if execution is allowed and wait if necessary
     */
    async acquire(): Promise<void> {
        // Clean old execution times (older than 1 minute)
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        this.executionTimes = this.executionTimes.filter(time => time > oneMinuteAgo);

        // Check per-minute limit
        if (this.executionTimes.length >= this.config.maxPerMinute) {
            const oldestExecution = Math.min(...this.executionTimes);
            const waitTime = 60000 - (now - oldestExecution);

            if (waitTime > 0) {
                console.log(`Rate limit reached. Waiting ${waitTime}ms...`);
                await this.sleep(waitTime);
            }
        }

        // Check concurrent limit
        while (this.concurrentCount >= this.config.maxConcurrent) {
            console.log(`Concurrent limit reached. Waiting...`);
            await this.sleep(100);
        }

        // Acquire slot
        this.concurrentCount++;
        this.executionTimes.push(now);

        // Apply cooldown
        if (this.config.cooldownMs > 0) {
            await this.sleep(this.config.cooldownMs);
        }
    }

    /**
     * Release the execution slot
     */
    release(): void {
        this.concurrentCount = Math.max(0, this.concurrentCount - 1);
    }

    /**
     * Get current rate limit status
     */
    getStatus(): { perMinute: number; concurrent: number; withinLimits: boolean } {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        const recentExecutions = this.executionTimes.filter(time => time > oneMinuteAgo);

        return {
            perMinute: recentExecutions.length,
            concurrent: this.concurrentCount,
            withinLimits: recentExecutions.length < this.config.maxPerMinute &&
                       this.concurrentCount < this.config.maxConcurrent
        };
    }

    /**
     * Simple sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}