import { BaseModule } from "@/modules/baseModule";
import { ScheduleDependencyModel } from "@/model/ScheduleDependency.model";
import { ScheduleDependencyEntity } from "@/entity/ScheduleDependency.entity";
import { DependencyCondition } from "@/entity/ScheduleDependency.entity";
import { SortBy, ListData } from "@/entityTypes/commonType";
import { ScheduleDependencyInterface, DependencyStatistics, DependencyValidationResult } from "@/modules/interface/ScheduleDependencyInterface";

export class ScheduleDependencyModule extends BaseModule implements ScheduleDependencyInterface {
    private scheduleDependencyModel: ScheduleDependencyModel;

    constructor() {
        super();
        this.scheduleDependencyModel = new ScheduleDependencyModel(this.dbpath);
    }

    async createDependency(
        parentId: number, 
        childId: number, 
        condition: DependencyCondition, 
        delayMinutes: number = 0,
        notes?: string
    ): Promise<number> {
        try {
            // Check for circular dependency before creating
            const hasCircular = await this.checkCircularDependency(parentId, childId);
            if (hasCircular) {
                throw new Error(`Circular dependency detected: Cannot create dependency from schedule ${parentId} to ${childId}`);
            }

            return await this.scheduleDependencyModel.createDependency(
                parentId,
                childId,
                condition,
                delayMinutes,
                notes
            );
        } catch (error) {
            console.error('Error creating dependency:', error);
            throw error;
        }
    }

    async updateDependency(
        id: number, 
        condition: DependencyCondition, 
        delayMinutes: number,
        notes?: string
    ): Promise<void> {
        try {
            await this.scheduleDependencyModel.updateDependency(
                id,
                condition,
                delayMinutes,
                notes
            );
        } catch (error) {
            console.error('Error updating dependency:', error);
            throw error;
        }
    }

    async deleteDependency(id: number): Promise<void> {
        try {
            await this.scheduleDependencyModel.deleteDependency(id);
        } catch (error) {
            console.error('Error deleting dependency:', error);
            throw error;
        }
    }

    async deleteDependencyByParentChild(parentId: number, childId: number): Promise<void> {
        try {
            await this.scheduleDependencyModel.deleteDependencyByParentChild(parentId, childId);
        } catch (error) {
            console.error('Error deleting dependency by parent-child:', error);
            throw error;
        }
    }

    async getDependencyById(id: number): Promise<ScheduleDependencyEntity | null> {
        try {
            return await this.scheduleDependencyModel.getDependencyById(id);
        } catch (error) {
            console.error('Error getting dependency by ID:', error);
            throw error;
        }
    }

    async getDependencyByParentChild(parentId: number, childId: number): Promise<ScheduleDependencyEntity | null> {
        try {
            return await this.scheduleDependencyModel.getDependencyByParentChild(parentId, childId);
        } catch (error) {
            console.error('Error getting dependency by parent-child:', error);
            throw error;
        }
    }

    async getDependenciesByParent(parentId: number): Promise<ScheduleDependencyEntity[]> {
        try {
            return await this.scheduleDependencyModel.getDependenciesByParent(parentId);
        } catch (error) {
            console.error('Error getting dependencies by parent:', error);
            throw error;
        }
    }

    async getDependenciesByChild(childId: number): Promise<ScheduleDependencyEntity[]> {
        try {
            return await this.scheduleDependencyModel.getDependenciesByChild(childId);
        } catch (error) {
            console.error('Error getting dependencies by child:', error);
            throw error;
        }
    }

    async getDependentSchedules(scheduleId: number): Promise<number[]> {
        try {
            return await this.scheduleDependencyModel.getDependentSchedules(scheduleId);
        } catch (error) {
            console.error('Error getting dependent schedules:', error);
            throw error;
        }
    }

    async getParentSchedules(scheduleId: number): Promise<number[]> {
        try {
            return await this.scheduleDependencyModel.getParentSchedules(scheduleId);
        } catch (error) {
            console.error('Error getting parent schedules:', error);
            throw error;
        }
    }

    async getDependencyChain(startId: number): Promise<ScheduleDependencyEntity[]> {
        try {
            return await this.scheduleDependencyModel.getDependencyChain(startId);
        } catch (error) {
            console.error('Error getting dependency chain:', error);
            throw error;
        }
    }

    async checkCircularDependency(parentId: number, childId: number): Promise<boolean> {
        try {
            return await this.scheduleDependencyModel.checkCircularDependency(parentId, childId);
        } catch (error) {
            console.error('Error checking circular dependency:', error);
            throw error;
        }
    }

    async enableDependency(id: number): Promise<void> {
        try {
            await this.scheduleDependencyModel.enableDependency(id);
        } catch (error) {
            console.error('Error enabling dependency:', error);
            throw error;
        }
    }

    async disableDependency(id: number): Promise<void> {
        try {
            await this.scheduleDependencyModel.disableDependency(id);
        } catch (error) {
            console.error('Error disabling dependency:', error);
            throw error;
        }
    }

    async getDependenciesByCondition(condition: DependencyCondition): Promise<ScheduleDependencyEntity[]> {
        try {
            return await this.scheduleDependencyModel.getDependenciesByCondition(condition);
        } catch (error) {
            console.error('Error getting dependencies by condition:', error);
            throw error;
        }
    }

    async getAllActiveDependencies(): Promise<ScheduleDependencyEntity[]> {
        try {
            return await this.scheduleDependencyModel.getAllActiveDependencies();
        } catch (error) {
            console.error('Error getting all active dependencies:', error);
            throw error;
        }
    }

    async listDependencies(
        page: number, 
        size: number, 
        parentId?: number,
        childId?: number,
        condition?: DependencyCondition,
        isActive?: boolean,
        sort?: SortBy
    ): Promise<ListData<ScheduleDependencyEntity>> {
        try {
            // Get all dependencies and apply filters
            let dependencies = await this.getAllActiveDependencies();

            // Apply filters
            if (parentId !== undefined) {
                dependencies = dependencies.filter(dep => dep.parent_schedule_id === parentId);
            }
            if (childId !== undefined) {
                dependencies = dependencies.filter(dep => dep.child_schedule_id === childId);
            }
            if (condition !== undefined) {
                dependencies = dependencies.filter(dep => dep.dependency_condition === condition);
            }
            if (isActive !== undefined) {
                dependencies = dependencies.filter(dep => dep.is_active === isActive);
            }

            // Apply sorting
            if (sort) {
                dependencies.sort((a, b) => {
                    const aValue = a[sort.key as keyof ScheduleDependencyEntity];
                    const bValue = b[sort.key as keyof ScheduleDependencyEntity];
                    
                    // Handle null/undefined values
                    if (aValue == null && bValue == null) return 0;
                    if (aValue == null) return sort.order === 'ASC' ? -1 : 1;
                    if (bValue == null) return sort.order === 'ASC' ? 1 : -1;
                    
                    if (sort.order === 'ASC') {
                        return aValue > bValue ? 1 : -1;
                    } else {
                        return aValue < bValue ? 1 : -1;
                    }
                });
            }

            // Apply pagination
            const total = dependencies.length;
            const start = page * size;
            const end = start + size;
            const records = dependencies.slice(start, end);

            return {
                records,
                num: total
            };
        } catch (error) {
            console.error('Error listing dependencies:', error);
            throw error;
        }
    }

    async getDependenciesTotal(
        parentId?: number,
        childId?: number,
        condition?: DependencyCondition,
        isActive?: boolean
    ): Promise<number> {
        try {
            const dependencies = await this.getAllActiveDependencies();
            
            let filtered = dependencies;
            if (parentId !== undefined) {
                filtered = filtered.filter(dep => dep.parent_schedule_id === parentId);
            }
            if (childId !== undefined) {
                filtered = filtered.filter(dep => dep.child_schedule_id === childId);
            }
            if (condition !== undefined) {
                filtered = filtered.filter(dep => dep.dependency_condition === condition);
            }
            if (isActive !== undefined) {
                filtered = filtered.filter(dep => dep.is_active === isActive);
            }
            
            return filtered.length;
        } catch (error) {
            console.error('Error getting dependencies total:', error);
            throw error;
        }
    }

    async getDependencyStatistics(): Promise<DependencyStatistics> {
        try {
            return await this.scheduleDependencyModel.getDependencyStatistics();
        } catch (error) {
            console.error('Error getting dependency statistics:', error);
            throw error;
        }
    }

    async validateDependencies(scheduleId: number): Promise<DependencyValidationResult> {
        try {
            return await this.scheduleDependencyModel.validateDependencies(scheduleId);
        } catch (error) {
            console.error('Error validating dependencies:', error);
            throw error;
        }
    }

    async validateAllDependencies(): Promise<DependencyValidationResult[]> {
        try {
            const allDependencies = await this.getAllActiveDependencies();
            const scheduleIds = new Set<number>();
            
            // Collect all unique schedule IDs
            allDependencies.forEach(dep => {
                scheduleIds.add(dep.parent_schedule_id);
                scheduleIds.add(dep.child_schedule_id);
            });

            const validationResults: DependencyValidationResult[] = [];
            for (const scheduleId of scheduleIds) {
                const result = await this.validateDependencies(scheduleId);
                validationResults.push(result);
            }

            return validationResults;
        } catch (error) {
            console.error('Error validating all dependencies:', error);
            throw error;
        }
    }

    async cleanupInactiveDependencies(): Promise<number> {
        try {
            return await this.scheduleDependencyModel.cleanupInactiveDependencies();
        } catch (error) {
            console.error('Error cleaning up inactive dependencies:', error);
            throw error;
        }
    }

    async getDependencyGraph(scheduleId?: number): Promise<{
        nodes: Array<{ id: number; label: string; type: string }>;
        edges: Array<{ from: number; to: number; condition: string; delay: number }>;
    }> {
        try {
            const dependencies = scheduleId 
                ? await this.getDependenciesByParent(scheduleId)
                : await this.getAllActiveDependencies();

            const nodes = new Map<number, { id: number; label: string; type: string }>();
            const edges: Array<{ from: number; to: number; condition: string; delay: number }> = [];

            // Build nodes and edges
            dependencies.forEach(dep => {
                // Add parent node
                if (!nodes.has(dep.parent_schedule_id)) {
                    nodes.set(dep.parent_schedule_id, {
                        id: dep.parent_schedule_id,
                        label: `Schedule ${dep.parent_schedule_id}`,
                        type: 'schedule'
                    });
                }

                // Add child node
                if (!nodes.has(dep.child_schedule_id)) {
                    nodes.set(dep.child_schedule_id, {
                        id: dep.child_schedule_id,
                        label: `Schedule ${dep.child_schedule_id}`,
                        type: 'schedule'
                    });
                }

                // Add edge
                edges.push({
                    from: dep.parent_schedule_id,
                    to: dep.child_schedule_id,
                    condition: dep.dependency_condition,
                    delay: dep.delay_minutes
                });
            });

            return {
                nodes: Array.from(nodes.values()),
                edges
            };
        } catch (error) {
            console.error('Error getting dependency graph:', error);
            throw error;
        }
    }

    async truncatedb(): Promise<void> {
        try {
            await this.scheduleDependencyModel.truncatedb();
        } catch (error) {
            console.error('Error truncating database:', error);
            throw error;
        }
    }
} 