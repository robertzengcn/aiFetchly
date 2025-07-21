import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { ScheduleDependencyEntity, DependencyCondition } from "@/entity/ScheduleDependency.entity";
import { ScheduleDependencyModelInterface, DependencyStatistics, DependencyValidationResult } from "@/modules/interface/ScheduleDependencyModelInterface";

export class ScheduleDependencyModel extends BaseDb implements ScheduleDependencyModelInterface {
    private repository: Repository<ScheduleDependencyEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(ScheduleDependencyEntity);
    }

    /**
     * Create a new dependency relationship
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     * @param condition The dependency condition
     * @param delayMinutes Optional delay in minutes
     * @param notes Optional notes about the dependency
     * @returns The ID of the created dependency
     */
    async createDependency(
        parentId: number, 
        childId: number, 
        condition: DependencyCondition, 
        delayMinutes: number = 0,
        notes?: string
    ): Promise<number> {
        const dependency = new ScheduleDependencyEntity();
        dependency.parent_schedule_id = parentId;
        dependency.child_schedule_id = childId;
        dependency.dependency_condition = condition;
        dependency.delay_minutes = delayMinutes;
        dependency.is_active = true;
        dependency.notes = notes || null;

        const savedDependency = await this.repository.save(dependency);
        return savedDependency.id;
    }

    /**
     * Update an existing dependency
     * @param id The dependency ID
     * @param condition The new dependency condition
     * @param delayMinutes The new delay in minutes
     * @param notes Optional notes about the dependency
     */
    async updateDependency(
        id: number, 
        condition: DependencyCondition, 
        delayMinutes: number,
        notes?: string
    ): Promise<void> {
        const updateData: any = {
            dependency_condition: condition,
            delay_minutes: delayMinutes
        };

        if (notes !== undefined) {
            updateData.notes = notes;
        }

        await this.repository.update({ id }, updateData);
    }

    /**
     * Delete a dependency relationship
     * @param id The dependency ID
     */
    async deleteDependency(id: number): Promise<void> {
        await this.repository.delete({ id });
    }

    /**
     * Delete a dependency by parent and child IDs
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     */
    async deleteDependencyByParentChild(parentId: number, childId: number): Promise<void> {
        await this.repository.delete({
            parent_schedule_id: parentId,
            child_schedule_id: childId
        });
    }

    /**
     * Get all dependencies for a parent schedule
     * @param parentId The parent schedule ID
     * @returns Array of dependency entities
     */
    async getDependenciesByParent(parentId: number): Promise<ScheduleDependencyEntity[]> {
        return await this.repository.find({
            where: { 
                parent_schedule_id: parentId,
                is_active: true
            },
            order: { delay_minutes: 'ASC' }
        });
    }

    /**
     * Get all dependencies for a child schedule
     * @param childId The child schedule ID
     * @returns Array of dependency entities
     */
    async getDependenciesByChild(childId: number): Promise<ScheduleDependencyEntity[]> {
        return await this.repository.find({
            where: { 
                child_schedule_id: childId,
                is_active: true
            },
            order: { delay_minutes: 'ASC' }
        });
    }

    /**
     * Get dependency by ID
     * @param id The dependency ID
     * @returns The dependency entity or null
     */
    async getDependencyById(id: number): Promise<ScheduleDependencyEntity | null> {
        return await this.repository.findOne({
            where: { id }
        });
    }

    /**
     * Get dependency by parent and child IDs
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     * @returns The dependency entity or null
     */
    async getDependencyByParentChild(parentId: number, childId: number): Promise<ScheduleDependencyEntity | null> {
        return await this.repository.findOne({
            where: {
                parent_schedule_id: parentId,
                child_schedule_id: childId
            }
        });
    }

    /**
     * Check if a circular dependency would be created
     * @param parentId The parent schedule ID
     * @param childId The child schedule ID
     * @returns True if circular dependency is detected
     */
    async checkCircularDependency(parentId: number, childId: number): Promise<boolean> {
        const visited = new Set<number>();
        const recursionStack = new Set<number>();

        const hasCycle = async (id: number): Promise<boolean> => {
            if (recursionStack.has(id)) {
                return true; // Circular dependency detected
            }

            if (visited.has(id)) {
                return false; // Already processed
            }

            visited.add(id);
            recursionStack.add(id);

            // Get all dependencies where this schedule is a parent
            const dependencies = await this.repository.find({
                where: { 
                    parent_schedule_id: id,
                    is_active: true
                }
            });

            // Check each child for cycles
            for (const dependency of dependencies) {
                const hasCircular = await hasCycle(dependency.child_schedule_id);
                if (hasCircular) return true;
            }

            recursionStack.delete(id);
            return false;
        };

        return await hasCycle(childId);
    }

    /**
     * Get the complete dependency chain starting from a schedule
     * @param startId The schedule ID to start from
     * @returns Array of dependency entities in the chain
     */
    async getDependencyChain(startId: number): Promise<ScheduleDependencyEntity[]> {
        const chain: ScheduleDependencyEntity[] = [];
        const visited = new Set<number>();

        const traverse = async (id: number): Promise<void> => {
            if (visited.has(id)) return;

            visited.add(id);

            const dependencies = await this.repository.find({
                where: { 
                    parent_schedule_id: id,
                    is_active: true
                },
                order: { delay_minutes: 'ASC' }
            });

            for (const dependency of dependencies) {
                chain.push(dependency);
                await traverse(dependency.child_schedule_id);
            }
        };

        await traverse(startId);
        return chain;
    }

    /**
     * Get all schedules that depend on a specific schedule
     * @param scheduleId The schedule ID
     * @returns Array of schedule IDs that depend on the given schedule
     */
    async getDependentSchedules(scheduleId: number): Promise<number[]> {
        const dependencies = await this.repository.find({
            where: { 
                parent_schedule_id: scheduleId,
                is_active: true
            },
            select: ['child_schedule_id']
        });

        return dependencies.map(dep => dep.child_schedule_id);
    }

    /**
     * Get all schedules that a specific schedule depends on
     * @param scheduleId The schedule ID
     * @returns Array of schedule IDs that the given schedule depends on
     */
    async getParentSchedules(scheduleId: number): Promise<number[]> {
        const dependencies = await this.repository.find({
            where: { 
                child_schedule_id: scheduleId,
                is_active: true
            },
            select: ['parent_schedule_id']
        });

        return dependencies.map(dep => dep.parent_schedule_id);
    }

    /**
     * Enable a dependency
     * @param id The dependency ID
     */
    async enableDependency(id: number): Promise<void> {
        await this.repository.update({ id }, { is_active: true });
    }

    /**
     * Disable a dependency
     * @param id The dependency ID
     */
    async disableDependency(id: number): Promise<void> {
        await this.repository.update({ id }, { is_active: false });
    }

    /**
     * Get dependencies by condition
     * @param condition The dependency condition to filter by
     * @returns Array of dependency entities
     */
    async getDependenciesByCondition(condition: DependencyCondition): Promise<ScheduleDependencyEntity[]> {
        return await this.repository.find({
            where: { 
                dependency_condition: condition,
                is_active: true
            },
            order: { delay_minutes: 'ASC' }
        });
    }

    /**
     * Get all active dependencies
     * @returns Array of all active dependency entities
     */
    async getAllActiveDependencies(): Promise<ScheduleDependencyEntity[]> {
        return await this.repository.find({
            where: { is_active: true },
            order: { parent_schedule_id: 'ASC', delay_minutes: 'ASC' }
        });
    }

    /**
     * Get dependency statistics
     * @returns Object with dependency statistics
     */
    async getDependencyStatistics(): Promise<DependencyStatistics> {
        const total = await this.repository.count();
        const active = await this.repository.count({ where: { is_active: true } });
        const inactive = await this.repository.count({ where: { is_active: false } });

        // Get count by condition
        const byCondition: Record<string, number> = {};
        const conditions = Object.values(DependencyCondition);
        
        for (const condition of conditions) {
            const count = await this.repository.count({
                where: { 
                    dependency_condition: condition,
                    is_active: true
                }
            });
            byCondition[condition] = count;
        }

        return {
            total,
            active,
            inactive,
            byCondition
        };
    }

    /**
     * Validate dependency relationships
     * @param scheduleId The schedule ID to validate
     * @returns Object with validation results
     */
    async validateDependencies(scheduleId: number): Promise<DependencyValidationResult> {
        const errors: string[] = [];
        const circularDependencies: number[] = [];
        const orphanedDependencies: number[] = [];

        // Check for circular dependencies
        const hasCircular = await this.checkCircularDependency(scheduleId, scheduleId);
        if (hasCircular) {
            circularDependencies.push(scheduleId);
            errors.push(`Circular dependency detected for schedule ${scheduleId}`);
        }

        // Check for orphaned dependencies (child schedules that don't exist)
        const childDependencies = await this.getDependenciesByChild(scheduleId);
        for (const dep of childDependencies) {
            // Note: This would require checking against the ScheduleTask repository
            // For now, we'll just collect the IDs
            orphanedDependencies.push(dep.parent_schedule_id);
        }

        return {
            isValid: errors.length === 0,
            circularDependencies,
            orphanedDependencies,
            errors
        };
    }

    /**
     * Clean up inactive dependencies
     * @returns Number of deleted dependencies
     */
    async cleanupInactiveDependencies(): Promise<number> {
        const result = await this.repository.delete({ is_active: false });
        return result.affected || 0;
    }

    /**
     * Truncate the database table
     */
    async truncatedb(): Promise<void> {
        await this.repository.clear();
    }
} 