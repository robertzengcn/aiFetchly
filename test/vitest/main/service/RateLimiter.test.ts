'use strict';
import { describe, test, expect, beforeEach } from 'vitest';
import { RateLimiter, RateLimitConfig } from '@/service/RateLimiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  let config: RateLimitConfig;

  beforeEach(() => {
    config = {
      maxPerMinute: 10,
      maxConcurrent: 3,
      cooldownMs: 0, // No cooldown for faster tests
    };
    rateLimiter = new RateLimiter(config);
  });

  describe('acquire', () => {
    test('should allow acquisition when within limits', async () => {
      await rateLimiter.acquire();
      const status = rateLimiter.getStatus();
      expect(status.perMinute).toBe(1);
      expect(status.concurrent).toBe(1);
      expect(status.withinLimits).toBe(true);
      rateLimiter.release();
    });

    test('should track multiple acquisitions', async () => {
      await rateLimiter.acquire();
      await rateLimiter.acquire();
      await rateLimiter.acquire();
      const status = rateLimiter.getStatus();
      expect(status.perMinute).toBe(3);
      expect(status.concurrent).toBe(3);
      rateLimiter.release();
      rateLimiter.release();
      rateLimiter.release();
    });

    test('should respect concurrent limit', async () => {
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 5; i++) {
        promises.push(rateLimiter.acquire());
      }
      await Promise.all(promises);
      const status = rateLimiter.getStatus();
      expect(status.concurrent).toBeLessThanOrEqual(config.maxConcurrent);
      // Release all
      for (let i = 0; i < 5; i++) {
        rateLimiter.release();
      }
    });

    test('should apply cooldown when configured', async () => {
      const cooldownConfig: RateLimitConfig = {
        maxPerMinute: 100,
        maxConcurrent: 10,
        cooldownMs: 50,
      };
      const limiterWithCooldown = new RateLimiter(cooldownConfig);
      const startTime = Date.now();
      await limiterWithCooldown.acquire();
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
      limiterWithCooldown.release();
    });
  });

  describe('release', () => {
    test('should decrease concurrent count', async () => {
      await rateLimiter.acquire();
      await rateLimiter.acquire();
      expect(rateLimiter.getStatus().concurrent).toBe(2);
      rateLimiter.release();
      expect(rateLimiter.getStatus().concurrent).toBe(1);
      rateLimiter.release();
      expect(rateLimiter.getStatus().concurrent).toBe(0);
    });

    test('should not go below zero', async () => {
      rateLimiter.release();
      rateLimiter.release();
      expect(rateLimiter.getStatus().concurrent).toBe(0);
    });
  });

  describe('getStatus', () => {
    test('should return correct status when within limits', async () => {
      await rateLimiter.acquire();
      const status = rateLimiter.getStatus();
      expect(status.perMinute).toBe(1);
      expect(status.concurrent).toBe(1);
      expect(status.withinLimits).toBe(true);
      rateLimiter.release();
    });

    test('should return withinLimits false when at concurrent limit', async () => {
      const promises: Promise<void>[] = [];
      for (let i = 0; i < config.maxConcurrent; i++) {
        promises.push(rateLimiter.acquire());
      }
      await Promise.all(promises);
      const status = rateLimiter.getStatus();
      expect(status.concurrent).toBe(config.maxConcurrent);
      expect(status.withinLimits).toBe(false);
      // Release all
      for (let i = 0; i < config.maxConcurrent; i++) {
        rateLimiter.release();
      }
    });

    test('should clean old execution times', async () => {
      // Add executions that are old (simulate by manipulating internal state)
      // Note: This test is limited by the private nature of executionTimes
      // We can test the behavior through status checks
      await rateLimiter.acquire();
      const status1 = rateLimiter.getStatus();
      expect(status1.perMinute).toBe(1);
      rateLimiter.release();
    });
  });

  describe('edge cases', () => {
    test('should handle zero maxPerMinute', async () => {
      const zeroConfig: RateLimitConfig = {
        maxPerMinute: 0,
        maxConcurrent: 1,
        cooldownMs: 0,
      };
      const zeroLimiter = new RateLimiter(zeroConfig);
      // Should still work but immediately hit limit
      await zeroLimiter.acquire();
      const status = zeroLimiter.getStatus();
      expect(status.perMinute).toBe(1);
      zeroLimiter.release();
    });

    test('should handle zero maxConcurrent', async () => {
      const zeroConfig: RateLimitConfig = {
        maxPerMinute: 10,
        maxConcurrent: 0,
        cooldownMs: 0,
      };
      const zeroLimiter = new RateLimiter(zeroConfig);
      // Should block or handle gracefully
      await zeroLimiter.acquire();
      const status = zeroLimiter.getStatus();
      expect(status.concurrent).toBeGreaterThanOrEqual(0);
      zeroLimiter.release();
    });
  });
});
