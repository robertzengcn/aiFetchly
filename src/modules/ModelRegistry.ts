"use strict";
import { ModelInfo } from "@/api/ragConfigApi";

export interface ModelPerformance {
    latency: number; // in milliseconds
    accuracy: number; // 0-1 scale
    cost: number; // relative cost factor
    lastUpdated: number; // timestamp
}

export interface ModelMetadata extends ModelInfo {
    performance: ModelPerformance;
    description: string;
    capabilities: string[];
    requirements: {
        minMemory?: number;
        minCpu?: number;
        gpuRequired?: boolean;
    };
}

export class ModelRegistry {
    private models: Map<string, ModelMetadata> = new Map();
    private defaultModel: string | null = null;

    constructor() {
        this.initializeDefaultModels();
    }

    /**
     * Register a model with its metadata
     * @param modelId Unique model identifier
     * @param metadata Model metadata
     */
    registerModel(modelId: string, metadata: ModelMetadata): void {
        this.models.set(modelId, {
            ...metadata,
            performance: {
                ...metadata.performance,
                lastUpdated: Date.now()
            }
        });
    }

    /**
     * Get model metadata by ID
     * @param modelId Model identifier
     * @returns Model metadata or null if not found
     */
    getModel(modelId: string): ModelMetadata | null {
        return this.models.get(modelId) || null;
    }

    /**
     * Get all available models
     * @returns Array of all registered models
     */
    getAllModels(): ModelMetadata[] {
        return Array.from(this.models.values());
    }

    /**
     * Get models by category
     * @param category Model category
     * @returns Array of models in the category
     */
    getModelsByCategory(category: ModelInfo['category']): ModelMetadata[] {
        return Array.from(this.models.values())
            .filter(model => model.category === category && model.status === 'active');
    }

    /**
     * Get the best model based on priority and performance
     * @param category Optional category filter
     * @returns Best model or null if none available
     */
    getBestModel(category?: ModelInfo['category']): ModelMetadata | null {
        let candidates = Array.from(this.models.values())
            .filter(model => model.status === 'active');

        if (category) {
            candidates = candidates.filter(model => model.category === category);
        }

        if (candidates.length === 0) {
            return null;
        }

        // Sort by priority (higher is better) and then by performance score
        return candidates.sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            return this.calculatePerformanceScore(b) - this.calculatePerformanceScore(a);
        })[0];
    }

    /**
     * Set the default model
     * @param modelId Model identifier
     */
    setDefaultModel(modelId: string): void {
        if (this.models.has(modelId)) {
            this.defaultModel = modelId;
        } else {
            throw new Error(`Model ${modelId} not found in registry`);
        }
    }

    /**
     * Get the default model
     * @returns Default model metadata or best available model
     */
    getDefaultModel(): ModelMetadata | null {
        if (this.defaultModel && this.models.has(this.defaultModel)) {
            return this.models.get(this.defaultModel)!;
        }
        return this.getBestModel();
    }

    /**
     * Update model performance metrics
     * @param modelId Model identifier
     * @param performance New performance metrics
     */
    updatePerformance(modelId: string, performance: Partial<ModelPerformance>): void {
        const model = this.models.get(modelId);
        if (model) {
            model.performance = {
                ...model.performance,
                ...performance,
                lastUpdated: Date.now()
            };
        }
    }

    /**
     * Update model status
     * @param modelId Model identifier
     * @param status New status
     */
    updateStatus(modelId: string, status: ModelInfo['status']): void {
        const model = this.models.get(modelId);
        if (model) {
            model.status = status;
        }
    }

    /**
     * Remove a model from the registry
     * @param modelId Model identifier
     */
    unregisterModel(modelId: string): void {
        this.models.delete(modelId);
        if (this.defaultModel === modelId) {
            this.defaultModel = null;
        }
    }

    /**
     * Get registry statistics
     * @returns Registry statistics
     */
    getStats(): {
        totalModels: number;
        activeModels: number;
        inactiveModels: number;
        deprecatedModels: number;
        categories: { [key: string]: number };
    } {
        const models = Array.from(this.models.values());
        const categories: { [key: string]: number } = {};

        models.forEach(model => {
            categories[model.category] = (categories[model.category] || 0) + 1;
        });

        return {
            totalModels: models.length,
            activeModels: models.filter(m => m.status === 'active').length,
            inactiveModels: models.filter(m => m.status === 'inactive').length,
            deprecatedModels: models.filter(m => m.status === 'deprecated').length,
            categories
        };
    }

    /**
     * Calculate performance score for model selection
     * @param model Model metadata
     * @returns Performance score (higher is better)
     */
    private calculatePerformanceScore(model: ModelMetadata): number {
        const { latency, accuracy, cost } = model.performance;
        
        // Normalize metrics (lower latency and cost are better)
        const latencyScore = Math.max(0, 1000 - latency) / 1000; // Normalize to 0-1
        const accuracyScore = accuracy; // Already 0-1
        const costScore = Math.max(0, 1 - cost); // Invert cost (lower cost = higher score)
        
        // Weighted average (accuracy is most important)
        return (accuracyScore * 0.5) + (latencyScore * 0.3) + (costScore * 0.2);
    }

    /**
     * Initialize default models
     */
    private initializeDefaultModels(): void {
        // Add some default models for fallback
        this.registerModel('text-embedding-3-small', {
            model: 'text-embedding-3-small',
            category: 'fast',
            priority: 8,
            status: 'active',
            performance: {
                latency: 200,
                accuracy: 0.85,
                cost: 0.3,
                lastUpdated: Date.now()
            },
            description: 'Fast and efficient embedding model',
            capabilities: ['text-embedding', 'semantic-search'],
            requirements: {
                minMemory: 512,
                minCpu: 1
            }
        });

        this.registerModel('text-embedding-3-large', {
            model: 'text-embedding-3-large',
            category: 'accurate',
            priority: 9,
            status: 'active',
            performance: {
                latency: 500,
                accuracy: 0.92,
                cost: 0.7,
                lastUpdated: Date.now()
            },
            description: 'High accuracy embedding model',
            capabilities: ['text-embedding', 'semantic-search', 'fine-grained-analysis'],
            requirements: {
                minMemory: 1024,
                minCpu: 2
            }
        });

        this.registerModel('text-embedding-ada-002', {
            model: 'text-embedding-ada-002',
            category: 'balanced',
            priority: 7,
            status: 'active',
            performance: {
                latency: 300,
                accuracy: 0.88,
                cost: 0.5,
                lastUpdated: Date.now()
            },
            description: 'Balanced performance and accuracy',
            capabilities: ['text-embedding', 'semantic-search'],
            requirements: {
                minMemory: 768,
                minCpu: 1
            }
        });

        // Set default model
        this.setDefaultModel('text-embedding-3-small');
    }
}

