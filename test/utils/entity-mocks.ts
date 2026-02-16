/**
 * Entity mock factories for testing
 * Provides factory functions to create mock entities
 */

import { TaskEntity } from '@/entity/Task.entity';

/**
 * Create a mock TaskEntity
 */
export function createMockTaskEntity(overrides?: Partial<TaskEntity>): TaskEntity {
  const now = new Date().toISOString();
  const defaultTask: TaskEntity = {
    id: 1,
    name: 'Test Task',
    description: 'Test Description',
    platform: 'youtube',
    status: 'pending',
    keywords: ['test', 'keyword'],
    location: 'US',
    numPages: 10,
    concurrency: 3,
    showBrowser: true,
    results_count: 0,
    error_message: undefined,
    created_at: now,
    updated_at: now,
    completed_at: undefined,
  };

  return { ...defaultTask, ...overrides } as TaskEntity;
}

/**
 * Create multiple mock TaskEntity instances
 */
export function createMockTaskEntities(count: number, overrides?: Partial<TaskEntity>): TaskEntity[] {
  const tasks: TaskEntity[] = [];
  for (let i = 0; i < count; i++) {
    tasks.push(createMockTaskEntity({ id: i + 1, name: `Test Task ${i + 1}`, ...overrides }));
  }
  return tasks;
}
