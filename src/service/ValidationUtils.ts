import { PlanCreatedEventData, PlanStepEventData, PlanControlEventData } from '@/entityTypes/commonType';
import { PLAN_CONFIG } from './StreamEventProcessor';

/**
 * Reusable validation utilities for plan and stream data
 */

/**
 * Result of validation operation
 */
export interface ValidationResult<T = unknown> {
    isValid: boolean;
    data?: T;
    errors: string[];
}

/**
 * Common validation patterns
 */
export class ValidationUtils {
    /**
     * Validate if a value is a non-empty string
     */
    static validateNonEmptyString(value: unknown, fieldName: string): string | null {
        if (!value || typeof value !== 'string' || value.trim().length === 0) {
            return `${fieldName} is required and must be a non-empty string`;
        }
        return null;
    }

    /**
     * Validate if a value is a positive integer
     */
    static validatePositiveInteger(value: unknown, fieldName: string): string | null {
        if (value !== undefined) {
            if (typeof value !== 'number' || value <= 0 || !Number.isInteger(value)) {
                return `${fieldName} must be a positive integer`;
            }
        }
        return null;
    }

    /**
     * Validate if a string length is within limits
     */
    static validateStringLength(
        value: string,
        fieldName: string,
        maxLength: number
    ): string | null {
        if (value.length > maxLength) {
            return `${fieldName} exceeds maximum length of ${maxLength} characters`;
        }
        return null;
    }

    /**
     * Validate if an array has valid items
     */
    static validateArray<T>(
        value: unknown,
        fieldName: string,
        itemValidator?: (item: unknown, index: number) => boolean
    ): { isValid: boolean; error?: string; validItems?: T[] } {
        if (!Array.isArray(value)) {
            return { isValid: false, error: `${fieldName} must be an array` };
        }

        if (value.length === 0) {
            return { isValid: false, error: `${fieldName} cannot be empty` };
        }

        if (value.length > PLAN_CONFIG.MAX_PLAN_STEPS) {
            return {
                isValid: false,
                error: `${fieldName} exceeds maximum steps limit of ${PLAN_CONFIG.MAX_PLAN_STEPS}`
            };
        }

        if (itemValidator) {
            const validItems: T[] = [];
            for (let i = 0; i < value.length; i++) {
                if (itemValidator(value[i], i)) {
                    validItems.push(value[i] as T);
                } else {
                    return {
                        isValid: false,
                        error: `Invalid item at index ${i} in ${fieldName}`
                    };
                }
            }
            return { isValid: true, validItems };
        }

        return { isValid: true };
    }

    /**
     * Sanitize string value
     */
    static sanitizeString(value: unknown): string | undefined {
        if (typeof value === 'string') {
            return value.trim();
        }
        return undefined;
    }
}

/**
 * Plan-specific validation utilities
 */
export class PlanValidator {
    /**
     * Validate plan creation event data
     */
    static validatePlanCreatedData(data: unknown): ValidationResult<PlanCreatedEventData> {
        const errors: string[] = [];

        if (!data || typeof data !== 'object') {
            errors.push('Plan created data is not an object');
            return { isValid: false, errors };
        }

        const planData = data as Record<string, unknown>;
        const result: Partial<PlanCreatedEventData> = {};

        // Check if this is the new format (has 'plan' array)
        let planArray: unknown[] | undefined;
        let dataObj: Record<string, unknown> | undefined;

        // Check if plan array is directly in planData
        if (Array.isArray(planData.plan)) {
            planArray = planData.plan;
            dataObj = planData;
        } else if (planData.data && typeof planData.data === 'object') {
            // Check if plan array is nested in data property
            dataObj = planData.data as Record<string, unknown>;
            if (Array.isArray(dataObj.plan)) {
                planArray = dataObj.plan;
            }
        }

        // Handle new format with plan array
        if (planArray && dataObj) {
            const arrayValidation = ValidationUtils.validateArray(
                planArray,
                'plan array',
                (item) => typeof item === 'string'
            );

            if (!arrayValidation.isValid) {
                errors.push(arrayValidation.error || 'Invalid plan array');
                return { isValid: false, errors };
            }

            // Extract and validate title
            const content = ValidationUtils.sanitizeString(planData.content) || 'Execution Plan';
            let title = content;

            if (planArray.length > 0 && typeof planArray[0] === 'string') {
                const firstStep = planArray[0];
                const stepMatch = firstStep.match(/^Step\s+\d+:\s*(.+)$/i);
                if (stepMatch) {
                    title = ValidationUtils.sanitizeString(stepMatch[1]) || content;
                }
            }

            const titleError = ValidationUtils.validateStringLength(
                title,
                'Title',
                PLAN_CONFIG.MAX_PLAN_TITLE_LENGTH
            );
            if (titleError) errors.push(titleError);

            // Validate reasoning if present
            const reasoning = ValidationUtils.sanitizeString(dataObj.reasoning);
            if (reasoning) {
                const reasoningError = ValidationUtils.validateStringLength(
                    reasoning,
                    'Reasoning',
                    PLAN_CONFIG.MAX_PLAN_DESCRIPTION_LENGTH
                );
                if (reasoningError) errors.push(reasoningError);
                result.description = reasoning;
            }

            result.plan_id = `plan-${Date.now()}`;
            result.title = title;
            result.plan = arrayValidation.validItems as string[];

            return { isValid: errors.length === 0, data: result as PlanCreatedEventData, errors };
        }

        // Handle old format
        // Validate required fields
        const planIdError = ValidationUtils.validateNonEmptyString(planData.plan_id, 'plan_id');
        if (planIdError) errors.push(planIdError);

        const titleError = ValidationUtils.validateNonEmptyString(planData.title, 'title');
        if (titleError) errors.push(titleError);

        if (errors.length > 0) {
            return { isValid: false, errors };
        }

        // Validate size limits
        const title = planData.title as string;
        const titleLengthError = ValidationUtils.validateStringLength(
            title,
            'Title',
            PLAN_CONFIG.MAX_PLAN_TITLE_LENGTH
        );
        if (titleLengthError) errors.push(titleLengthError);

        // Build validated result
        result.plan_id = ValidationUtils.sanitizeString(planData.plan_id)!;
        result.title = ValidationUtils.sanitizeString(planData.title)!;

        const description = ValidationUtils.sanitizeString(planData.description);
        if (description) {
            const descLengthError = ValidationUtils.validateStringLength(
                description,
                'Description',
                PLAN_CONFIG.MAX_PLAN_DESCRIPTION_LENGTH
            );
            if (descLengthError) errors.push(descLengthError);
            result.description = description;
        }

        // Validate steps array if present
        if (Array.isArray(planData.steps)) {
            const stepsValidation = ValidationUtils.validateArray(
                planData.steps,
                'steps',
                (step) => step != null && typeof step === 'object'
            );

            if (!stepsValidation.isValid) {
                errors.push(stepsValidation.error || 'Invalid steps array');
            } else {
                result.steps = stepsValidation.validItems?.map(step => {
                    const stepObj = step as Record<string, unknown>;
                    return {
                        step_id: stepObj.step_id ? String(stepObj.step_id) : undefined,
                        step_number: stepObj.step_number ? Number(stepObj.step_number) : undefined,
                        title: stepObj.title ? String(stepObj.title) : undefined,
                        description: stepObj.description ? String(stepObj.description) : undefined
                    };
                });
            }
        }

        return { isValid: errors.length === 0, data: result as PlanCreatedEventData, errors };
    }

    /**
     * Validate plan step event data
     */
    static validatePlanStepData(data: unknown): ValidationResult<PlanStepEventData> {
        const errors: string[] = [];

        if (!data || typeof data !== 'object') {
            errors.push('Plan step data is not an object');
            return { isValid: false, errors };
        }

        const stepData = data as Record<string, unknown>;
        const result: PlanStepEventData = {};

        // step_id is required
        const stepIdError = ValidationUtils.validateNonEmptyString(stepData.step_id, 'step_id');
        if (stepIdError) {
            errors.push(stepIdError);
            return { isValid: false, errors };
        }
        result.step_id = ValidationUtils.sanitizeString(stepData.step_id)!;

        // Optional validations
        const stepNumberError = ValidationUtils.validatePositiveInteger(stepData.step_number, 'step_number');
        if (stepNumberError) errors.push(stepNumberError);
        else if (stepData.step_number !== undefined) result.step_number = stepData.step_number as number;

        // Title validation
        if (stepData.title !== undefined) {
            const titleError = ValidationUtils.validateNonEmptyString(stepData.title, 'title');
            if (titleError) {
                errors.push(titleError);
            } else {
                const title = stepData.title as string;
                const titleLengthError = ValidationUtils.validateStringLength(
                    title,
                    'Step title',
                    PLAN_CONFIG.MAX_STEP_TITLE_LENGTH
                );
                if (titleLengthError) errors.push(titleLengthError);
                else result.title = ValidationUtils.sanitizeString(title);
            }
        }

        // Description validation
        if (stepData.description !== undefined) {
            if (typeof stepData.description !== 'string') {
                errors.push('Step description must be a string');
            } else {
                const descLengthError = ValidationUtils.validateStringLength(
                    stepData.description,
                    'Step description',
                    PLAN_CONFIG.MAX_STEP_DESCRIPTION_LENGTH
                );
                if (descLengthError) errors.push(descLengthError);
                else result.description = ValidationUtils.sanitizeString(stepData.description);
            }
        }

        // Other fields
        if (typeof stepData.result === 'string') result.result = stepData.result;
        if (typeof stepData.error === 'string') result.error = stepData.error;
        if (typeof stepData.success === 'boolean') result.success = stepData.success;
        if (typeof stepData.plan_id === 'string') result.plan_id = ValidationUtils.sanitizeString(stepData.plan_id);
        if (typeof stepData.reason === 'string') result.reason = ValidationUtils.sanitizeString(stepData.reason);

        return { isValid: errors.length === 0, data: result, errors };
    }

    /**
     * Validate plan control event data (pause/resume)
     */
    static validatePlanControlData(data: unknown): ValidationResult<PlanControlEventData> {
        const errors: string[] = [];

        if (!data || typeof data !== 'object') {
            errors.push('Plan control data is not an object');
            return { isValid: false, errors };
        }

        const controlData = data as Record<string, unknown>;
        const result: PlanControlEventData = {};

        if (controlData.plan_id) {
            const planId = ValidationUtils.sanitizeString(controlData.plan_id);
            if (planId) result.plan_id = planId;
        }

        if (controlData.reason) {
            const reason = ValidationUtils.sanitizeString(controlData.reason);
            if (reason) result.reason = reason;
        }

        return { isValid: true, data: result, errors };
    }
}