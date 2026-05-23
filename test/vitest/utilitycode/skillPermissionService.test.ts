'use strict';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Token before importing anything
const mockStore: Record<string, string> = {};
vi.mock('@/modules/token', () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn((key: string) => mockStore[key] || ''),
    setValue: vi.fn((key: string, value: string) => {
      mockStore[key] = value;
    }),
  })),
}));

// Mock ToolExecutor (used by skillsRegistry at module load time)
vi.mock('@/service/ToolExecutor', () => ({
  ToolExecutor: {
    execute: vi.fn().mockResolvedValue({ results: [] }),
  },
}));

vi.mock('@/service/MCPToolService', () => ({
  MCPToolService: vi.fn().mockImplementation(() => ({
    getEnabledMCPToolsAsFunctions: vi.fn().mockResolvedValue([]),
  })),
}));

import { SkillPermissionService } from '@/service/SkillPermissionService';

describe('SkillPermissionService', () => {
  beforeEach(() => {
    // Clear mock store before each test
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key];
    }
  });

  describe('checkPermission', () => {
    test('should allow pure skills without prompt', () => {
      const result = SkillPermissionService.checkPermission('generate_keywords');
      expect(result.allowed).toBe(true);
      expect(result.needsPrompt).toBe(false);
    });

    test('should prompt for network skills with no stored permission', () => {
      const result = SkillPermissionService.checkPermission('scrape_urls_from_google');
      expect(result.allowed).toBe(false);
      expect(result.needsPrompt).toBe(true);
    });

    test('should allow network skills with stored granted permission', () => {
      mockStore['SKILL_PERMISSION_scrape_urls_from_google'] = 'granted';
      const result = SkillPermissionService.checkPermission('scrape_urls_from_google');
      expect(result.allowed).toBe(true);
      expect(result.needsPrompt).toBe(false);
    });

    test('should deny network skills with stored denied permission', () => {
      mockStore['SKILL_PERMISSION_scrape_urls_from_google'] = 'denied';
      const result = SkillPermissionService.checkPermission('scrape_urls_from_google');
      expect(result.allowed).toBe(false);
      expect(result.needsPrompt).toBe(false);
      expect(result.reason).toBeDefined();
    });

    test('should deny unknown skills', () => {
      const result = SkillPermissionService.checkPermission('nonexistent_skill');
      expect(result.allowed).toBe(false);
      expect(result.needsPrompt).toBe(false);
    });

    test('should prompt for automation skills with no stored permission', () => {
      const result = SkillPermissionService.checkPermission('extract_emails_from_urls');
      expect(result.allowed).toBe(false);
      expect(result.needsPrompt).toBe(true);
    });
  });

  describe('grantPermission', () => {
    test('should store granted permission persistently', () => {
      SkillPermissionService.grantPermission('scrape_urls_from_google', true);
      expect(mockStore['SKILL_PERMISSION_scrape_urls_from_google']).toBe('granted');
    });

    test('should not store non-persistent grant', () => {
      SkillPermissionService.grantPermission('scrape_urls_from_google', false);
      expect(mockStore['SKILL_PERMISSION_scrape_urls_from_google']).toBeUndefined();
    });

    test('should allow skill after persistent grant', () => {
      SkillPermissionService.grantPermission('scrape_urls_from_google', true);
      const result = SkillPermissionService.checkPermission('scrape_urls_from_google');
      expect(result.allowed).toBe(true);
    });
  });

  describe('denyPermission', () => {
    test('should store denied permission', () => {
      SkillPermissionService.denyPermission('scrape_urls_from_google');
      expect(mockStore['SKILL_PERMISSION_scrape_urls_from_google']).toBe('denied');
    });

    test('should deny skill after deny', () => {
      SkillPermissionService.denyPermission('scrape_urls_from_google');
      const result = SkillPermissionService.checkPermission('scrape_urls_from_google');
      expect(result.allowed).toBe(false);
      expect(result.needsPrompt).toBe(false);
    });
  });

  describe('revokePermission', () => {
    test('should clear stored permission', () => {
      SkillPermissionService.grantPermission('scrape_urls_from_google', true);
      expect(mockStore['SKILL_PERMISSION_scrape_urls_from_google']).toBe('granted');

      SkillPermissionService.revokePermission('scrape_urls_from_google');
      // After revocation, the value should be empty
      expect(mockStore['SKILL_PERMISSION_scrape_urls_from_google']).toBe('');

      // Should now prompt again
      const result = SkillPermissionService.checkPermission('scrape_urls_from_google');
      expect(result.needsPrompt).toBe(true);
    });
  });

  describe('getPermissionStatus', () => {
    test('should return unknown for no stored permission', () => {
      const status = SkillPermissionService.getPermissionStatus('scrape_urls_from_google');
      expect(status).toBe('unknown');
    });

    test('should return granted for stored granted permission', () => {
      mockStore['SKILL_PERMISSION_scrape_urls_from_google'] = 'granted';
      const status = SkillPermissionService.getPermissionStatus('scrape_urls_from_google');
      expect(status).toBe('granted');
    });

    test('should return denied for stored denied permission', () => {
      mockStore['SKILL_PERMISSION_scrape_urls_from_google'] = 'denied';
      const status = SkillPermissionService.getPermissionStatus('scrape_urls_from_google');
      expect(status).toBe('denied');
    });
  });

  describe('checkNetworkDomain', () => {
    test('should prompt for unknown domain', () => {
      const result = SkillPermissionService.checkNetworkDomain(
        'scrape_urls_from_google',
        'google.com'
      );
      expect(result.allowed).toBe(false);
      expect(result.needsPrompt).toBe(true);
    });

    test('should allow domain with stored always permission', () => {
      mockStore['SKILL_NETWORK_DOMAIN_scrape_urls_from_google_google.com'] = 'always';
      const result = SkillPermissionService.checkNetworkDomain(
        'scrape_urls_from_google',
        'google.com'
      );
      expect(result.allowed).toBe(true);
      expect(result.needsPrompt).toBe(false);
    });
  });

  describe('grantNetworkDomain', () => {
    test('should store persistent domain permission', () => {
      SkillPermissionService.grantNetworkDomain(
        'scrape_urls_from_google',
        'google.com',
        true
      );
      expect(mockStore['SKILL_NETWORK_DOMAIN_scrape_urls_from_google_google.com']).toBe('always');
    });

    test('should store once domain permission', () => {
      SkillPermissionService.grantNetworkDomain(
        'scrape_urls_from_google',
        'google.com',
        false
      );
      expect(mockStore['SKILL_NETWORK_DOMAIN_scrape_urls_from_google_google.com']).toBe('once');
    });
  });

  describe('lifecycle', () => {
    test('grant → check → revoke → check cycle', () => {
      // Initially prompts
      let result = SkillPermissionService.checkPermission('scrape_urls_from_google');
      expect(result.needsPrompt).toBe(true);

      // Grant
      SkillPermissionService.grantPermission('scrape_urls_from_google', true);
      result = SkillPermissionService.checkPermission('scrape_urls_from_google');
      expect(result.allowed).toBe(true);

      // Revoke
      SkillPermissionService.revokePermission('scrape_urls_from_google');
      result = SkillPermissionService.checkPermission('scrape_urls_from_google');
      expect(result.needsPrompt).toBe(true);

      // Deny
      SkillPermissionService.denyPermission('scrape_urls_from_google');
      result = SkillPermissionService.checkPermission('scrape_urls_from_google');
      expect(result.allowed).toBe(false);
      expect(result.needsPrompt).toBe(false);
    });
  });
});
