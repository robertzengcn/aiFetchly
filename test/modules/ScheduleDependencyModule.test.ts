import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScheduleDependencyModule } from '@/modules/ScheduleDependencyModule';
import { DependencyCondition } from '@/entity/ScheduleDependency.entity';

describe('ScheduleDependencyModule', () => {
    let scheduleDependencyModule: ScheduleDependencyModule;

    beforeEach(() => {
        scheduleDependencyModule = new ScheduleDependencyModule();
    });

    afterEach(async () => {
        // Clean up after each test
        try {
            await scheduleDependencyModule.truncatedb();
        } catch (error) {
            console.warn('Cleanup failed:', error);
        }
    });

    describe('createDependency', () => {
        it('should create a new dependency', async () => {
            const dependencyId = await scheduleDependencyModule.createDependency(
                1, // parentId
                2, // childId
                DependencyCondition.ON_SUCCESS,
                5, // delayMinutes
                'Test dependency'
            );

            expect(dependencyId).toBeGreaterThan(0);

            const dependency = await scheduleDependencyModule.getDependencyById(dependencyId);
            expect(dependency).not.toBeNull();
            expect(dependency?.parent_schedule_id).toBe(1);
            expect(dependency?.child_schedule_id).toBe(2);
            expect(dependency?.dependency_condition).toBe(DependencyCondition.ON_SUCCESS);
            expect(dependency?.delay_minutes).toBe(5);
            expect(dependency?.notes).toBe('Test dependency');
            expect(dependency?.is_active).toBe(true);
        });

        it('should prevent circular dependencies', async () => {
            // Create a dependency chain: 1 -> 2 -> 3
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(2, 3, DependencyCondition.ON_SUCCESS);

            // Try to create a circular dependency: 3 -> 1
            await expect(
                scheduleDependencyModule.createDependency(3, 1, DependencyCondition.ON_SUCCESS)
            ).rejects.toThrow('Circular dependency detected');
        });
    });

    describe('updateDependency', () => {
        it('should update an existing dependency', async () => {
            const dependencyId = await scheduleDependencyModule.createDependency(
                1, 2, DependencyCondition.ON_SUCCESS, 0, 'Original notes'
            );

            await scheduleDependencyModule.updateDependency(
                dependencyId,
                DependencyCondition.ON_COMPLETION,
                10,
                'Updated notes'
            );

            const updatedDependency = await scheduleDependencyModule.getDependencyById(dependencyId);
            expect(updatedDependency?.dependency_condition).toBe(DependencyCondition.ON_COMPLETION);
            expect(updatedDependency?.delay_minutes).toBe(10);
            expect(updatedDependency?.notes).toBe('Updated notes');
        });
    });

    describe('deleteDependency', () => {
        it('should delete a dependency by ID', async () => {
            const dependencyId = await scheduleDependencyModule.createDependency(
                1, 2, DependencyCondition.ON_SUCCESS
            );

            await scheduleDependencyModule.deleteDependency(dependencyId);

            const deletedDependency = await scheduleDependencyModule.getDependencyById(dependencyId);
            expect(deletedDependency).toBeNull();
        });

        it('should delete a dependency by parent-child IDs', async () => {
            await scheduleDependencyModule.createDependency(
                1, 2, DependencyCondition.ON_SUCCESS
            );

            await scheduleDependencyModule.deleteDependencyByParentChild(1, 2);

            const deletedDependency = await scheduleDependencyModule.getDependencyByParentChild(1, 2);
            expect(deletedDependency).toBeNull();
        });
    });

    describe('getDependenciesByParent', () => {
        it('should get all dependencies for a parent schedule', async () => {
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(1, 3, DependencyCondition.ON_FAILURE);
            await scheduleDependencyModule.createDependency(4, 5, DependencyCondition.ON_SUCCESS);

            const dependencies = await scheduleDependencyModule.getDependenciesByParent(1);
            expect(dependencies.length).toBe(2);
            expect(dependencies.every(dep => dep.parent_schedule_id === 1)).toBe(true);
        });
    });

    describe('getDependenciesByChild', () => {
        it('should get all dependencies for a child schedule', async () => {
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(3, 2, DependencyCondition.ON_FAILURE);
            await scheduleDependencyModule.createDependency(4, 5, DependencyCondition.ON_SUCCESS);

            const dependencies = await scheduleDependencyModule.getDependenciesByChild(2);
            expect(dependencies.length).toBe(2);
            expect(dependencies.every(dep => dep.child_schedule_id === 2)).toBe(true);
        });
    });

    describe('getDependentSchedules', () => {
        it('should get all schedules that depend on a specific schedule', async () => {
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(1, 3, DependencyCondition.ON_FAILURE);

            const dependentSchedules = await scheduleDependencyModule.getDependentSchedules(1);
            expect(dependentSchedules).toContain(2);
            expect(dependentSchedules).toContain(3);
            expect(dependentSchedules.length).toBe(2);
        });
    });

    describe('getParentSchedules', () => {
        it('should get all schedules that a specific schedule depends on', async () => {
            await scheduleDependencyModule.createDependency(1, 3, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(2, 3, DependencyCondition.ON_FAILURE);

            const parentSchedules = await scheduleDependencyModule.getParentSchedules(3);
            expect(parentSchedules).toContain(1);
            expect(parentSchedules).toContain(2);
            expect(parentSchedules.length).toBe(2);
        });
    });

    describe('getDependencyChain', () => {
        it('should get the complete dependency chain', async () => {
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(2, 3, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(3, 4, DependencyCondition.ON_SUCCESS);

            const chain = await scheduleDependencyModule.getDependencyChain(1);
            expect(chain.length).toBe(3);
            expect(chain[0].parent_schedule_id).toBe(1);
            expect(chain[0].child_schedule_id).toBe(2);
            expect(chain[1].parent_schedule_id).toBe(2);
            expect(chain[1].child_schedule_id).toBe(3);
            expect(chain[2].parent_schedule_id).toBe(3);
            expect(chain[2].child_schedule_id).toBe(4);
        });
    });

    describe('enableDisableDependency', () => {
        it('should enable and disable dependencies', async () => {
            const dependencyId = await scheduleDependencyModule.createDependency(
                1, 2, DependencyCondition.ON_SUCCESS
            );

            // Disable the dependency
            await scheduleDependencyModule.disableDependency(dependencyId);
            let dependency = await scheduleDependencyModule.getDependencyById(dependencyId);
            expect(dependency?.is_active).toBe(false);

            // Enable the dependency
            await scheduleDependencyModule.enableDependency(dependencyId);
            dependency = await scheduleDependencyModule.getDependencyById(dependencyId);
            expect(dependency?.is_active).toBe(true);
        });
    });

    describe('getDependenciesByCondition', () => {
        it('should get dependencies by condition', async () => {
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(3, 4, DependencyCondition.ON_FAILURE);
            await scheduleDependencyModule.createDependency(5, 6, DependencyCondition.ON_SUCCESS);

            const successDependencies = await scheduleDependencyModule.getDependenciesByCondition(DependencyCondition.ON_SUCCESS);
            expect(successDependencies.length).toBe(2);
            expect(successDependencies.every(dep => dep.dependency_condition === DependencyCondition.ON_SUCCESS)).toBe(true);
        });
    });

    describe('getAllActiveDependencies', () => {
        it('should get all active dependencies', async () => {
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(3, 4, DependencyCondition.ON_FAILURE);

            const activeDependencies = await scheduleDependencyModule.getAllActiveDependencies();
            expect(activeDependencies.length).toBe(2);
            expect(activeDependencies.every(dep => dep.is_active)).toBe(true);
        });
    });

    describe('listDependencies', () => {
        it('should list dependencies with filtering', async () => {
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(1, 3, DependencyCondition.ON_FAILURE);
            await scheduleDependencyModule.createDependency(4, 5, DependencyCondition.ON_SUCCESS);

            const result = await scheduleDependencyModule.listDependencies(
                0, 10, 1, undefined, DependencyCondition.ON_SUCCESS
            );

            expect(result.records.length).toBe(1);
            expect(result.records[0].parent_schedule_id).toBe(1);
            expect(result.records[0].dependency_condition).toBe(DependencyCondition.ON_SUCCESS);
        });
    });

    describe('getDependencyStatistics', () => {
        it('should get dependency statistics', async () => {
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(3, 4, DependencyCondition.ON_FAILURE);
            await scheduleDependencyModule.createDependency(5, 6, DependencyCondition.ON_COMPLETION);

            const stats = await scheduleDependencyModule.getDependencyStatistics();
            expect(stats.total).toBe(3);
            expect(stats.active).toBe(3);
            expect(stats.inactive).toBe(0);
            expect(stats.byCondition[DependencyCondition.ON_SUCCESS]).toBe(1);
            expect(stats.byCondition[DependencyCondition.ON_FAILURE]).toBe(1);
            expect(stats.byCondition[DependencyCondition.ON_COMPLETION]).toBe(1);
        });
    });

    describe('validateDependencies', () => {
        it('should validate dependencies', async () => {
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);

            const validation = await scheduleDependencyModule.validateDependencies(1);
            expect(validation.isValid).toBe(true);
            expect(validation.circularDependencies.length).toBe(0);
            expect(validation.errors.length).toBe(0);
        });
    });

    describe('getDependencyGraph', () => {
        it('should get dependency graph', async () => {
            await scheduleDependencyModule.createDependency(1, 2, DependencyCondition.ON_SUCCESS);
            await scheduleDependencyModule.createDependency(2, 3, DependencyCondition.ON_FAILURE);

            const graph = await scheduleDependencyModule.getDependencyGraph();
            expect(graph.nodes.length).toBe(3);
            expect(graph.edges.length).toBe(2);
            expect(graph.edges[0].from).toBe(1);
            expect(graph.edges[0].to).toBe(2);
            expect(graph.edges[1].from).toBe(2);
            expect(graph.edges[1].to).toBe(3);
        });
    });

    describe('cleanupInactiveDependencies', () => {
        it('should cleanup inactive dependencies', async () => {
            const dependencyId = await scheduleDependencyModule.createDependency(
                1, 2, DependencyCondition.ON_SUCCESS
            );

            await scheduleDependencyModule.disableDependency(dependencyId);

            const deletedCount = await scheduleDependencyModule.cleanupInactiveDependencies();
            expect(deletedCount).toBe(1);

            const deletedDependency = await scheduleDependencyModule.getDependencyById(dependencyId);
            expect(deletedDependency).toBeNull();
        });
    });
}); 