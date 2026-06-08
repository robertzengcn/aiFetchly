'use strict';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-appdata'),
  },
}));

// Mock SkillRegistry module imports
vi.mock('@/service/VectorStoreService', () => ({
  VectorStoreService: vi.fn().mockImplementation(function () {
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/modules/ConfigurationService', () => ({
  ConfigurationServiceImpl: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@/service/DocumentService', () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return {
      getDocuments: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/service/ChunkingService', () => ({
  ChunkingService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@/api/ragConfigApi', () => ({
  RagConfigApi: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@/modules/SystemSettingModule', () => ({
  SystemSettingModule: vi.fn().mockImplementation(function () {
    return {
      getDefaultEmbeddingModel: vi.fn().mockResolvedValue(null),
    };
  }),
}));

vi.mock('@/modules/SystemSettingGroupModule', () => ({
  SystemSettingGroupModule: vi.fn().mockImplementation(function () {
    return {
      getOrCreateEmbeddingGroup: vi.fn().mockResolvedValue({}),
    };
  }),
}));

import { SkillRegistry } from '@/config/skillsRegistry';

describe('knowledge_library_search tool registration', () => {
  test('tool is registered in SkillRegistry', async () => {
    const tools = await SkillRegistry.getAllToolFunctions();
    const knowledgeTool = tools.find(
      (t) => t.name === 'knowledge_library_search'
    );

    expect(knowledgeTool).toBeDefined();
    expect(knowledgeTool!.name).toBe('knowledge_library_search');
    expect(knowledgeTool!.description).toContain('knowledge library');
  });

  test('tool has correct parameter schema', async () => {
    const tools = await SkillRegistry.getAllToolFunctions();
    const knowledgeTool = tools.find(
      (t) => t.name === 'knowledge_library_search'
    );

    expect(knowledgeTool).toBeDefined();
    const params = knowledgeTool!.parameters as Record<string, unknown>;
    const properties = params.properties as Record<string, unknown>;

    expect(properties.query).toBeDefined();
    expect(properties.limit).toBeDefined();
    expect(properties.documentIds).toBeDefined();
    expect(properties.documentTypes).toBeDefined();
    expect(properties.tags).toBeDefined();
    expect(properties.author).toBeDefined();
    expect(properties.dateRange).toBeDefined();
    expect(properties.includeNeighborChunks).toBeDefined();

    const required = params.required as string[];
    expect(required).toContain('query');
  });

  test('tool does not require confirmation', () => {
    const skill = SkillRegistry.getSkill('knowledge_library_search');
    expect(skill).toBeDefined();
    expect(skill!.requiresConfirmation).toBe(false);
    expect(skill!.permissionCategory).toBe('pure');
    expect(skill!.source).toBe('built-in');
  });
});
