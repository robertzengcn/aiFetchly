/**
 * Test fixtures - Common test data
 */

import { TaskCreateRequest, TaskUpdateRequest } from '@/entityTypes/task-type';

/**
 * Common test fixtures for tasks
 */
export const taskFixtures = {
  /**
   * Valid task creation data
   */
  validCreateRequest: (): TaskCreateRequest => ({
    name: 'Test Task',
    description: 'Test Description',
    platform: 'youtube',
    keywords: ['test', 'keyword'],
    location: 'US',
    numPages: 10,
    concurrency: 3,
    showBrowser: true,
  }),

  /**
   * Minimal task creation data (only required fields)
   */
  minimalCreateRequest: (): TaskCreateRequest => ({
    name: 'Minimal Task',
    platform: 'youtube',
    keywords: ['test'],
    numPages: 1,
    concurrency: 1,
    showBrowser: false,
  }),

  /**
   * Task update data
   */
  validUpdateRequest: (id: number): TaskUpdateRequest => ({
    id,
    name: 'Updated Task Name',
    description: 'Updated Description',
    numPages: 20,
  }),

  /**
   * Invalid task creation data (missing required fields)
   */
  invalidCreateRequest: (): Partial<TaskCreateRequest> => ({
    name: 'Invalid Task',
    // Missing required fields
  }),
};
