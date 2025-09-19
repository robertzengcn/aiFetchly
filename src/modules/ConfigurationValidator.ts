"use strict";
import { EmbeddingConfig } from "@/modules/llm/EmbeddingFactory";
import { ModelRegistry, ModelMetadata } from "./ModelRegistry";

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

export interface ValidationOptions {
    strictMode?: boolean;
    allowDeprecated?: boolean;
    minAccuracy?: number;
    maxLatency?: number;
}

export class ConfigurationValidator {
    private modelRegistry: ModelRegistry;

    constructor(modelRegistry?: ModelRegistry) {
        this.modelRegistry = modelRegistry || new ModelRegistry();
    }

    /**
     * Validate an EmbeddingConfig
     * @param config Configuration to validate
     * @param options Validation options
     * @returns Validation result
     */
    validateConfig(config: EmbeddingConfig, options: ValidationOptions = {}): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const {
            strictMode = false,
            allowDeprecated = false,
            minAccuracy = 0.8,
            maxLatency = 1000
        } = options;

        // Required field validation
        this.validateRequiredFields(config, errors);

        // Field type validation
        this.validateFieldTypes(config, errors);

        // Field value validation
        this.validateFieldValues(config, errors, warnings);

        // Model compatibility validation
        this.validateModelCompatibility(config, errors, warnings, allowDeprecated);

        // Performance validation
        this.validatePerformance(config, errors, warnings, minAccuracy, maxLatency);

        // Version validation
        this.validateVersion(config, errors, warnings);

        const isValid = errors.length === 0 && (!strictMode || warnings.length === 0);

        return {
            isValid,
            errors,
            warnings
        };
    }

    /**
     * Validate required fields
     */
    private validateRequiredFields(config: EmbeddingConfig, errors: string[]): void {
        if (!config.model || config.model.trim() === '') {
            errors.push('Model name is required');
        }

        if (config.dimensions === undefined || config.dimensions === null) {
            errors.push('Dimensions is required');
        }
    }

    /**
     * Validate field types
     */
    private validateFieldTypes(config: EmbeddingConfig, errors: string[]): void {
        if (config.model && typeof config.model !== 'string') {
            errors.push('Model must be a string');
        }

        if (config.dimensions !== undefined && typeof config.dimensions !== 'number') {
            errors.push('Dimensions must be a number');
        }

        if (config.maxTokens !== undefined && typeof config.maxTokens !== 'number') {
            errors.push('MaxTokens must be a number');
        }

        if (config.timeout !== undefined && typeof config.timeout !== 'number') {
            errors.push('Timeout must be a number');
        }

        if (config.retries !== undefined && typeof config.retries !== 'number') {
            errors.push('Retries must be a number');
        }
    }

    /**
     * Validate field values
     */
    private validateFieldValues(config: EmbeddingConfig, errors: string[], warnings: string[]): void {
        // Validate dimensions
        if (config.dimensions !== undefined) {
            if (config.dimensions <= 0) {
                errors.push('Dimensions must be greater than 0');
            } else if (config.dimensions > 4096) {
                warnings.push('Very high dimensions may impact performance');
            }
        }

        // Validate maxTokens
        if (config.maxTokens !== undefined) {
            if (config.maxTokens <= 0) {
                errors.push('MaxTokens must be greater than 0');
            } else if (config.maxTokens > 32000) {
                warnings.push('Very high maxTokens may impact performance');
            }
        }

        // Validate timeout
        if (config.timeout !== undefined) {
            if (config.timeout <= 0) {
                errors.push('Timeout must be greater than 0');
            } else if (config.timeout > 300000) { // 5 minutes
                warnings.push('Very high timeout may impact user experience');
            }
        }

        // Validate retries
        if (config.retries !== undefined) {
            if (config.retries < 0) {
                errors.push('Retries must be non-negative');
            } else if (config.retries > 10) {
                warnings.push('High retry count may impact performance');
            }
        }
    }

    /**
     * Validate model compatibility
     */
    private validateModelCompatibility(
        config: EmbeddingConfig,
        errors: string[],
        warnings: string[],
        allowDeprecated: boolean
    ): void {
        if (!config.model) return;

        const modelMetadata = this.modelRegistry.getModel(config.model);
        if (!modelMetadata) {
            errors.push(`Model '${config.model}' is not registered in the model registry`);
            return;
        }

        // Check model status
        if (modelMetadata.status === 'deprecated' && !allowDeprecated) {
            errors.push(`Model '${config.model}' is deprecated`);
        } else if (modelMetadata.status === 'inactive') {
            errors.push(`Model '${config.model}' is inactive`);
        }

        // Check dimensions compatibility
        if (config.dimensions && modelMetadata.performance) {
            const expectedDimensions = this.getExpectedDimensions(config.model);
            if (expectedDimensions && config.dimensions !== expectedDimensions) {
                warnings.push(`Dimensions ${config.dimensions} may not be optimal for model '${config.model}' (expected: ${expectedDimensions})`);
            }
        }
    }

    /**
     * Validate performance requirements
     */
    private validatePerformance(
        config: EmbeddingConfig,
        errors: string[],
        warnings: string[],
        minAccuracy: number,
        maxLatency: number
    ): void {
        if (!config.model) return;

        const modelMetadata = this.modelRegistry.getModel(config.model);
        if (!modelMetadata || !modelMetadata.performance) return;

        const { latency, accuracy } = modelMetadata.performance;

        if (accuracy < minAccuracy) {
            errors.push(`Model '${config.model}' accuracy (${accuracy}) is below minimum required (${minAccuracy})`);
        }

        if (latency > maxLatency) {
            errors.push(`Model '${config.model}' latency (${latency}ms) exceeds maximum allowed (${maxLatency}ms)`);
        }
    }

    /**
     * Validate configuration version
     */
    private validateVersion(config: EmbeddingConfig, errors: string[], warnings: string[]): void {
        // This is a placeholder for version validation
        // In a real implementation, you might check against a schema version
        const currentVersion = '1.0.0';
        
        if ((config as any).version && (config as any).version !== currentVersion) {
            warnings.push(`Configuration version ${(config as any).version} may not be compatible with current version ${currentVersion}`);
        }
    }

    /**
     * Get expected dimensions for a model
     */
    private getExpectedDimensions(model: string): number | null {
        const dimensionMap: { [key: string]: number } = {
            'text-embedding-3-small': 1536,
            'text-embedding-3-large': 3072,
            'text-embedding-ada-002': 1536,
            'text-embedding-002': 1536
        };

        return dimensionMap[model] || null;
    }

    /**
     * Validate multiple configurations
     */
    validateConfigs(configs: EmbeddingConfig[], options: ValidationOptions = {}): ValidationResult[] {
        return configs.map(config => this.validateConfig(config, options));
    }

    /**
     * Get validation summary
     */
    getValidationSummary(results: ValidationResult[]): {
        total: number;
        valid: number;
        invalid: number;
        totalErrors: number;
        totalWarnings: number;
    } {
        const total = results.length;
        const valid = results.filter(r => r.isValid).length;
        const invalid = total - valid;
        const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
        const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);

        return {
            total,
            valid,
            invalid,
            totalErrors,
            totalWarnings
        };
    }

}
