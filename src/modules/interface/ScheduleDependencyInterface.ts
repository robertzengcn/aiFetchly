import { ScheduleDependencyEntity } from "@/entity/ScheduleDependency.entity";
import { DependencyCondition } from "@/entity/ScheduleDependency.entity";
import { SortBy, ListData } from "@/entityTypes/commonType";

export interface DependencyStatistics {
    total: number;
    active: number;
    inactive: number;
    byCondition: Record<string, number>;
}

export interface DependencyValidationResult {
    isValid: boolean;
    circularDependencies: number[];
    orphanedDependencies: number[];
    errors: string[];
}

export interface ScheduleDependencyInterface {
    /**
     * Create a new dependency relationship
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     * @param condition The dependency condition
     * @param delayMinutes Optional delay in minutes
     * @param notes Optional notes about the dependency
     * @returns The ID of the created dependency
     */
    createDependency(
        parentId: number, 
        childId: number, 
        condition: DependencyCondition, 
        delayMinutes?: number,
        notes?: string
    ): Promise<number>;

    /**
     * Update an existing dependency
     * @param id The dependency ID
     * @param condition The new dependency condition
     * @param delayMinutes The new delay in minutes
     * @param notes Optional notes about the dependency
     */
    updateDependency(
        id: number, 
        condition: DependencyCondition, 
        delayMinutes: number,
        notes?: string
    ): Promise<void>;

    /**
     * Delete a dependency relationship
     * @param id The dependency ID
     */
    deleteDependency(id: number): Promise<void>;

    /**
     * Delete a dependency by parent and child IDs
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     */
    deleteDependencyByParentChild(parentId: number, childId: number): Promise<void>;

    /**
     * Get dependency by ID
     * @param id The dependency ID
     * @returns The dependency entity or null
     */
    getDependencyById(id: number): Promise<ScheduleDependencyEntity | null>;

    /**
     * Get dependency by parent and child IDs
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     * @returns The dependency entity or null
     */
    getDependencyByParentChild(parentId: number, childId: number): Promise<ScheduleDependencyEntity | null>;

    /**
     * Get all dependencies for a parent schedule
     * @param parentId The parent schedule ID
     * @returns Array of dependency entities
     */
    getDependenciesByParent(parentId: number): Promise<ScheduleDependencyEntity[]>;

    /**
     * Get all dependencies for a child schedule
     * @param childId The child schedule ID
     * @returns Array of dependency entities
     */
    getDependenciesByChild(childId: number): Promise<ScheduleDependencyEntity[]>;

    /**
     * Get all schedules that depend on a specific schedule
     * @param scheduleId The schedule ID
     * @returns Array of schedule IDs that depend on the given schedule
     */
    getDependentSchedules(scheduleId: number): Promise<number[]>;

    /**
     * Get all schedules that a specific schedule depends on
     * @param scheduleId The schedule ID
     * @returns Array of schedule IDs that the given schedule depends on
     */
    getParentSchedules(scheduleId: number): Promise<number[]>;

    /**
     * Get the complete dependency chain starting from a schedule
     * @param startId The schedule ID to start from
     * @returns Array of dependency entities in the chain
     */
    getDependencyChain(startId: number): Promise<ScheduleDependencyEntity[]>;

    /**
     * Check if a circular dependency would be created
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     * @returns True if circular dependency is detected
     */
    checkCircularDependency(parentId: number, childId: number): Promise<boolean>;

    /**
     * Enable a dependency
     * @param id The dependency ID
     */
    enableDependency(id: number): Promise<void>;

    /**
     * Disable a dependency
     * @param id The dependency ID
     */
    disableDependency(id: number): Promise<void>;

    /**
     * Get dependencies by condition
     * @param condition The dependency condition to filter by
     * @returns Array of dependency entities
     */
    getDependenciesByCondition(condition: DependencyCondition): Promise<ScheduleDependencyEntity[]>;

    /**
     * Get all active dependencies
     * @returns Array of all active dependency entities
     */
    getAllActiveDependencies(): Promise<ScheduleDependencyEntity[]>;

    /**
     * List dependencies with pagination and filtering
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param parentId Optional parent schedule ID to filter by
     * @param childId Optional child schedule ID to filter by
     * @param condition Optional dependency condition to filter by
     * @param isActive Optional active status to filter by
     * @param sort Optional sort parameters
     * @returns List data containing records and total count
     */
    listDependencies(
        page: number, 
        size: number, 
        parentId?: number,
        childId?: number,
        condition?: DependencyCondition,
        isActive?: boolean,
        sort?: SortBy
    ): Promise<ListData<ScheduleDependencyEntity>>;

    /**
     * Get total number of dependencies with optional filtering
     * @param parentId Optional parent schedule ID to filter by
     * @param childId Optional child schedule ID to filter by
     * @param condition Optional dependency condition to filter by
     * @param isActive Optional active status to filter by
     * @returns Total count of dependencies
     */
    getDependenciesTotal(
        parentId?: number,
        childId?: number,
        condition?: DependencyCondition,
        isActive?: boolean
    ): Promise<number>;

    /**
     * Get dependency statistics
     * @returns Object with dependency statistics
     */
    getDependencyStatistics(): Promise<DependencyStatistics>;

    /**
     * Validate dependency relationships
     * @param scheduleId The schedule ID to validate
     * @returns Object with validation results
     */
    validateDependencies(scheduleId: number): Promise<DependencyValidationResult>;

    /**
     * Validate all dependencies in the system
     * @returns Array of validation results for all schedules
     */
    validateAllDependencies(): Promise<DependencyValidationResult[]>;

    /**
     * Clean up inactive dependencies
     * @returns Number of deleted dependencies
     */
    cleanupInactiveDependencies(): Promise<number>;

    /**
     * Get dependency graph for visualization
     * @param scheduleId Optional schedule ID to focus on
     * @returns Object with nodes and edges for graph visualization
     */
    getDependencyGraph(scheduleId?: number): Promise<{
        nodes: Array<{ id: number; label: string; type: string }>;
        edges: Array<{ from: number; to: number; condition: string; delay: number }>;
    }>;

    /**
     * Truncate the database table
     */
    truncatedb(): Promise<void>;
} 