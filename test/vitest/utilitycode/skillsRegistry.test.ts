'use strict';
import { describe, test, expect, vi, afterEach } from 'vitest';

// Mock ToolExecutor before importing the registry (it's used at module load time)
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

import { SkillRegistry } from '@/config/skillsRegistry';

describe('SkillRegistry', () => {
  describe('isRegistered', () => {
    test('should return true for a built-in skill', () => {
      expect(SkillRegistry.isRegistered('scrape_urls_from_google')).toBe(true);
    });

    test('should return true for extract_emails_from_urls', () => {
      expect(SkillRegistry.isRegistered('extract_emails_from_urls')).toBe(true);
    });

    test('should return false for unknown skill', () => {
      expect(SkillRegistry.isRegistered('nonexistent_tool')).toBe(false);
    });

    test('should return false for MCP-prefixed tool', () => {
      expect(SkillRegistry.isRegistered('mcp_some_tool')).toBe(false);
    });
  });

  describe('getSkill', () => {
    test('should return skill definition for registered skill', () => {
      const skill = SkillRegistry.getSkill('scrape_urls_from_google');
      expect(skill).not.toBeNull();
      expect(skill!.name).toBe('scrape_urls_from_google');
      expect(skill!.tier).toBe('main');
      expect(skill!.source).toBe('built-in');
      expect(skill!.parameters).toBeDefined();
      expect(typeof skill!.execute).toBe('function');
    });

    test('should return null for unknown skill', () => {
      const skill = SkillRegistry.getSkill('nonexistent_tool');
      expect(skill).toBeNull();
    });

    test('should return skill with pure permission for keyword generation', () => {
      const skill = SkillRegistry.getSkill('generate_keywords');
      expect(skill!.permissionCategory).toBe('pure');
    });

    test('should return skill with network permission for search tools', () => {
      const skill = SkillRegistry.getSkill('scrape_urls_from_bing');
      expect(skill!.permissionCategory).toBe('network');
    });
  });

  describe('getAllToolFunctions', () => {
    test('should return array of ToolFunction objects', async () => {
      const tools = await SkillRegistry.getAllToolFunctions();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    test('should include all built-in tools', async () => {
      const tools = await SkillRegistry.getAllToolFunctions();
      const names = tools.map((t) => t.name);

      expect(names).toContain('scrape_urls_from_google');
      expect(names).toContain('scrape_urls_from_bing');
      expect(names).toContain('extract_emails_from_urls');
      expect(names).toContain('generate_keywords');
      expect(names).toContain('extract_contact_info');
    });

    test('should return ToolFunction with correct shape', async () => {
      const tools = await SkillRegistry.getAllToolFunctions();
      const googleTool = tools.find((t) => t.name === 'scrape_urls_from_google');

      expect(googleTool).toBeDefined();
      expect(googleTool!.type).toBe('function');
      expect(googleTool!.name).toBe('scrape_urls_from_google');
      expect(googleTool!.description).toBeDefined();
      expect(googleTool!.parameters).toBeDefined();
      expect(typeof googleTool!.description).toBe('string');
    });
  });

  describe('registerSkill / unregisterSkill', () => {
    const testSkillName = 'test_custom_skill_vitest';

    afterEach(() => {
      try {
        SkillRegistry.unregisterSkill(testSkillName);
      } catch {
        // Ignore if not registered
      }
    });

    test('should register a new skill', () => {
      SkillRegistry.registerSkill({
        name: testSkillName,
        description: 'Test skill',
        parameters: { type: 'object', properties: {} },
        tier: 'main',
        requiresConfirmation: false,
        permissionCategory: 'pure',
        execute: vi.fn(),
        source: 'user',
      });

      expect(SkillRegistry.isRegistered(testSkillName)).toBe(true);
      const skill = SkillRegistry.getSkill(testSkillName);
      expect(skill!.name).toBe(testSkillName);
    });

    test('should throw when registering duplicate name', () => {
      SkillRegistry.registerSkill({
        name: testSkillName,
        description: 'First',
        parameters: { type: 'object', properties: {} },
        tier: 'main',
        requiresConfirmation: false,
        permissionCategory: 'pure',
        execute: vi.fn(),
        source: 'user',
      });

      expect(() => {
        SkillRegistry.registerSkill({
          name: testSkillName,
          description: 'Duplicate',
          parameters: { type: 'object', properties: {} },
          tier: 'main',
          requiresConfirmation: false,
          permissionCategory: 'pure',
          execute: vi.fn(),
          source: 'user',
        });
      }).toThrow(/already registered/);
    });

    test('should unregister a skill', () => {
      SkillRegistry.registerSkill({
        name: testSkillName,
        description: 'To remove',
        parameters: { type: 'object', properties: {} },
        tier: 'main',
        requiresConfirmation: false,
        permissionCategory: 'pure',
        execute: vi.fn(),
        source: 'user',
      });

      expect(SkillRegistry.isRegistered(testSkillName)).toBe(true);
      SkillRegistry.unregisterSkill(testSkillName);
      expect(SkillRegistry.isRegistered(testSkillName)).toBe(false);
    });

    test('unregisterSkill should not throw for unknown names', () => {
      expect(() => {
        SkillRegistry.unregisterSkill('definitely_not_registered');
      }).not.toThrow();
    });
  });

  describe('findSkillForFileExtension', () => {
    const docSkillName = 'test_doc_skill_pdf_route';
    const noTypesName = 'test_doc_skill_no_types';

    afterEach(() => {
      for (const n of [docSkillName, noTypesName]) {
        try {
          SkillRegistry.unregisterSkill(n);
        } catch {
          // ignore
        }
      }
    });

    test('returns documentation-only user skill when extension matches', () => {
      SkillRegistry.registerSkill({
        name: docSkillName,
        description: 'Doc-only PDF guidance',
        parameters: { type: 'object', properties: {} },
        tier: 'sandboxed',
        requiresConfirmation: false,
        permissionCategory: 'pure',
        execute: vi.fn(),
        source: 'user',
        documentationOnly: true,
        supportedFileTypes: ['.pdf'],
      });

      const hit = SkillRegistry.findSkillForFileExtension('.pdf');
      expect(hit).not.toBeNull();
      expect(hit!.name).toBe(docSkillName);
    });

    test('returns null when user skill has no supportedFileTypes', () => {
      SkillRegistry.registerSkill({
        name: noTypesName,
        description: 'No types',
        parameters: { type: 'object', properties: {} },
        tier: 'sandboxed',
        requiresConfirmation: false,
        permissionCategory: 'pure',
        execute: vi.fn(),
        source: 'user',
        documentationOnly: true,
      });

      expect(SkillRegistry.findSkillForFileExtension('.pdf')).toBeNull();
    });
  });
});
