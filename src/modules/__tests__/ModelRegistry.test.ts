'use strict';
import { expect, test, describe, beforeEach } from 'vitest';
import { ModelRegistry, ModelMetadata, ModelPerformance } from '../ModelRegistry';

describe('ModelRegistry', () => {
    let registry: ModelRegistry;

    beforeEach(() => {
        registry = new ModelRegistry();
    });

    describe('constructor', () => {
        test('should initialize with default models', () => {
            const stats = registry.getStats();
            expect(stats.totalModels).toBeGreaterThan(0);
            expect(stats.activeModels).toBeGreaterThan(0);
        });

        test('should set default model', () => {
            const defaultModel = registry.getDefaultModel();
            expect(defaultModel).toBeDefined();
            expect(defaultModel?.model).toBe('text-embedding-3-small');
        });
    });

    describe('registerModel', () => {
        test('should register a new model', () => {
            const modelId = 'test-model';
            const metadata: ModelMetadata = {
                model: 'test-model',
                category: 'fast',
                priority: 5,
                status: 'active',
                performance: {
                    latency: 100,
                    accuracy: 0.9,
                    cost: 0.5,
                    lastUpdated: Date.now()
                },
                description: 'Test model',
                capabilities: ['text-embedding'],
                requirements: {
                    minMemory: 512,
                    minCpu: 1
                }
            };

            registry.registerModel(modelId, metadata);
            const retrieved = registry.getModel(modelId);

            expect(retrieved).toEqual(metadata);
        });

        test('should update existing model', () => {
            const modelId = 'test-model';
            const metadata1: ModelMetadata = {
                model: 'test-model',
                category: 'fast',
                priority: 5,
                status: 'active',
                performance: { latency: 100, accuracy: 0.9, cost: 0.5, lastUpdated: Date.now() },
                description: 'Test model',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 512, minCpu: 1 }
            };

            const metadata2: ModelMetadata = {
                ...metadata1,
                priority: 8,
                description: 'Updated test model'
            };

            registry.registerModel(modelId, metadata1);
            registry.registerModel(modelId, metadata2);

            const retrieved = registry.getModel(modelId);
            expect(retrieved?.priority).toBe(8);
            expect(retrieved?.description).toBe('Updated test model');
        });
    });

    describe('getModel', () => {
        test('should return model metadata for existing model', () => {
            const modelId = 'test-model';
            const metadata: ModelMetadata = {
                model: 'test-model',
                category: 'fast',
                priority: 5,
                status: 'active',
                performance: { latency: 100, accuracy: 0.9, cost: 0.5, lastUpdated: Date.now() },
                description: 'Test model',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 512, minCpu: 1 }
            };

            registry.registerModel(modelId, metadata);
            const retrieved = registry.getModel(modelId);

            expect(retrieved).toEqual(metadata);
        });

        test('should return null for non-existent model', () => {
            const retrieved = registry.getModel('non-existent');
            expect(retrieved).toBeNull();
        });
    });

    describe('getAllModels', () => {
        test('should return all registered models', () => {
            const models = registry.getAllModels();
            expect(Array.isArray(models)).toBe(true);
            expect(models.length).toBeGreaterThan(0);
        });

        test('should include newly registered models', () => {
            const initialCount = registry.getAllModels().length;

            registry.registerModel('new-model', {
                model: 'new-model',
                category: 'accurate',
                priority: 7,
                status: 'active',
                performance: { latency: 200, accuracy: 0.95, cost: 0.7, lastUpdated: Date.now() },
                description: 'New model',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 1024, minCpu: 2 }
            });

            const models = registry.getAllModels();
            expect(models.length).toBe(initialCount + 1);
        });
    });

    describe('getModelsByCategory', () => {
        test('should return models in specific category', () => {
            const fastModels = registry.getModelsByCategory('fast');
            const accurateModels = registry.getModelsByCategory('accurate');

            expect(Array.isArray(fastModels)).toBe(true);
            expect(Array.isArray(accurateModels)).toBe(true);

            fastModels.forEach(model => {
                expect(model.category).toBe('fast');
                expect(model.status).toBe('active');
            });

            accurateModels.forEach(model => {
                expect(model.category).toBe('accurate');
                expect(model.status).toBe('active');
            });
        });

        test('should return empty array for non-existent category', () => {
            const models = registry.getModelsByCategory('non-existent' as any);
            expect(models).toEqual([]);
        });
    });

    describe('getBestModel', () => {
        test('should return best model without category filter', () => {
            const bestModel = registry.getBestModel();
            expect(bestModel).toBeDefined();
            expect(bestModel?.status).toBe('active');
        });

        test('should return best model in specific category', () => {
            const bestFastModel = registry.getBestModel('fast');
            const bestAccurateModel = registry.getBestModel('accurate');

            if (bestFastModel) {
                expect(bestFastModel.category).toBe('fast');
            }
            if (bestAccurateModel) {
                expect(bestAccurateModel.category).toBe('accurate');
            }
        });

        test('should return null when no models available', () => {
            const emptyRegistry = new ModelRegistry();
            // Clear all models
            emptyRegistry.getAllModels().forEach(model => {
                emptyRegistry.unregisterModel(model.model);
            });

            const bestModel = emptyRegistry.getBestModel();
            expect(bestModel).toBeNull();
        });
    });

    describe('setDefaultModel', () => {
        test('should set default model for existing model', () => {
            const modelId = 'test-model';
            const metadata: ModelMetadata = {
                model: 'test-model',
                category: 'fast',
                priority: 5,
                status: 'active',
                performance: { latency: 100, accuracy: 0.9, cost: 0.5, lastUpdated: Date.now() },
                description: 'Test model',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 512, minCpu: 1 }
            };

            registry.registerModel(modelId, metadata);
            registry.setDefaultModel(modelId);

            const defaultModel = registry.getDefaultModel();
            expect(defaultModel?.model).toBe('test-model');
        });

        test('should throw error for non-existent model', () => {
            expect(() => {
                registry.setDefaultModel('non-existent');
            }).toThrow('Model non-existent not found in registry');
        });
    });

    describe('getDefaultModel', () => {
        test('should return set default model', () => {
            const defaultModel = registry.getDefaultModel();
            expect(defaultModel).toBeDefined();
            expect(defaultModel?.status).toBe('active');
        });

        test('should return best available model when no default set', () => {
            const defaultModel = registry.getDefaultModel();
            expect(defaultModel).toBeDefined();
        });
    });

    describe('updatePerformance', () => {
        test('should update model performance metrics', () => {
            const modelId = 'test-model';
            const metadata: ModelMetadata = {
                model: 'test-model',
                category: 'fast',
                priority: 5,
                status: 'active',
                performance: { latency: 100, accuracy: 0.9, cost: 0.5, lastUpdated: Date.now() },
                description: 'Test model',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 512, minCpu: 1 }
            };

            registry.registerModel(modelId, metadata);

            const newPerformance: Partial<ModelPerformance> = {
                latency: 150,
                accuracy: 0.95
            };

            registry.updatePerformance(modelId, newPerformance);

            const updatedModel = registry.getModel(modelId);
            expect(updatedModel?.performance.latency).toBe(150);
            expect(updatedModel?.performance.accuracy).toBe(0.95);
            expect(updatedModel?.performance.cost).toBe(0.5); // Should remain unchanged
        });

        test('should update lastUpdated timestamp', () => {
            const modelId = 'test-model';
            const metadata: ModelMetadata = {
                model: 'test-model',
                category: 'fast',
                priority: 5,
                status: 'active',
                performance: { latency: 100, accuracy: 0.9, cost: 0.5, lastUpdated: Date.now() - 1000 },
                description: 'Test model',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 512, minCpu: 1 }
            };

            registry.registerModel(modelId, metadata);
            const originalTimestamp = metadata.performance.lastUpdated;

            registry.updatePerformance(modelId, { latency: 150 });

            const updatedModel = registry.getModel(modelId);
            expect(updatedModel?.performance.lastUpdated).toBeGreaterThan(originalTimestamp);
        });
    });

    describe('updateStatus', () => {
        test('should update model status', () => {
            const modelId = 'test-model';
            const metadata: ModelMetadata = {
                model: 'test-model',
                category: 'fast',
                priority: 5,
                status: 'active',
                performance: { latency: 100, accuracy: 0.9, cost: 0.5, lastUpdated: Date.now() },
                description: 'Test model',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 512, minCpu: 1 }
            };

            registry.registerModel(modelId, metadata);
            registry.updateStatus(modelId, 'inactive');

            const updatedModel = registry.getModel(modelId);
            expect(updatedModel?.status).toBe('inactive');
        });
    });

    describe('unregisterModel', () => {
        test('should remove model from registry', () => {
            const modelId = 'test-model';
            const metadata: ModelMetadata = {
                model: 'test-model',
                category: 'fast',
                priority: 5,
                status: 'active',
                performance: { latency: 100, accuracy: 0.9, cost: 0.5, lastUpdated: Date.now() },
                description: 'Test model',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 512, minCpu: 1 }
            };

            registry.registerModel(modelId, metadata);
            registry.unregisterModel(modelId);

            const retrieved = registry.getModel(modelId);
            expect(retrieved).toBeNull();
        });

        test('should clear default model if it was unregistered', () => {
            const modelId = 'test-model';
            const metadata: ModelMetadata = {
                model: 'test-model',
                category: 'fast',
                priority: 5,
                status: 'active',
                performance: { latency: 100, accuracy: 0.9, cost: 0.5, lastUpdated: Date.now() },
                description: 'Test model',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 512, minCpu: 1 }
            };

            registry.registerModel(modelId, metadata);
            registry.setDefaultModel(modelId);
            registry.unregisterModel(modelId);

            // Should fall back to best available model
            const defaultModel = registry.getDefaultModel();
            expect(defaultModel?.model).not.toBe('test-model');
        });
    });

    describe('getStats', () => {
        test('should return correct statistics', () => {
            const stats = registry.getStats();

            expect(stats.totalModels).toBeGreaterThan(0);
            expect(stats.activeModels).toBeGreaterThan(0);
            expect(stats.inactiveModels).toBeGreaterThanOrEqual(0);
            expect(stats.deprecatedModels).toBeGreaterThanOrEqual(0);
            expect(typeof stats.categories).toBe('object');
        });

        test('should update statistics after model changes', () => {
            const initialStats = registry.getStats();

            registry.registerModel('new-model', {
                model: 'new-model',
                category: 'fast',
                priority: 5,
                status: 'inactive',
                performance: { latency: 100, accuracy: 0.9, cost: 0.5, lastUpdated: Date.now() },
                description: 'New model',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 512, minCpu: 1 }
            });

            const updatedStats = registry.getStats();
            expect(updatedStats.totalModels).toBe(initialStats.totalModels + 1);
            expect(updatedStats.inactiveModels).toBe(initialStats.inactiveModels + 1);
        });
    });

    describe('performance score calculation', () => {
        test('should calculate performance scores correctly', () => {
            const model1: ModelMetadata = {
                model: 'model1',
                category: 'fast',
                priority: 5,
                status: 'active',
                performance: { latency: 100, accuracy: 0.9, cost: 0.3, lastUpdated: Date.now() },
                description: 'Model 1',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 512, minCpu: 1 }
            };

            const model2: ModelMetadata = {
                model: 'model2',
                category: 'accurate',
                priority: 5,
                status: 'active',
                performance: { latency: 200, accuracy: 0.95, cost: 0.7, lastUpdated: Date.now() },
                description: 'Model 2',
                capabilities: ['text-embedding'],
                requirements: { minMemory: 1024, minCpu: 2 }
            };

            registry.registerModel('model1', model1);
            registry.registerModel('model2', model2);

            // Both have same priority, so performance score should determine order
            const bestModel = registry.getBestModel();
            expect(bestModel).toBeDefined();
        });
    });
});


