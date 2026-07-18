'use strict';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory Token store so tests can flip USER_AI_ENABLED per case.
const tokenStore: Record<string, string> = {};

vi.mock('@/modules/token', () => ({
  Token: class {
    getValue(key: string): string {
      return tokenStore[key];
    }
  },
}));

import { isAiEnabled } from '@/service/AiFeatureGate';
import { USER_AI_ENABLED } from '@/config/usersetting';

describe('isAiEnabled', () => {
  beforeEach(() => {
    for (const k of Object.keys(tokenStore)) delete tokenStore[k];
  });

  test('returns true when USER_AI_ENABLED is "true"', () => {
    tokenStore[USER_AI_ENABLED] = 'true';
    expect(isAiEnabled()).toBe(true);
  });

  test('returns false when USER_AI_ENABLED is "false"', () => {
    tokenStore[USER_AI_ENABLED] = 'false';
    expect(isAiEnabled()).toBe(false);
  });

  test('returns false when USER_AI_ENABLED is unset', () => {
    expect(isAiEnabled()).toBe(false);
  });

  test('returns false for unexpected truthy-but-not-"true" values', () => {
    tokenStore[USER_AI_ENABLED] = '1';
    expect(isAiEnabled()).toBe(false);
  });
});

// Separate describe so we can swap the Token mock to one that throws.
describe('isAiEnabled fail-closed behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/modules/token', () => ({
      Token: class {
        getValue(): string {
          throw new Error('encrypted store corrupted');
        }
      },
    }));
  });

  test('returns false (not throw) when Token service throws', async () => {
    const { isAiEnabled: fresh } = await import('@/service/AiFeatureGate');
    expect(fresh()).toBe(false);
  });
});
