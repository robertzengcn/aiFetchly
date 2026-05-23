/**
 * Model mock factories for testing
 * Provides factory functions and utilities for mocking models
 */

import { TaskEntity } from '@/entity/Task.entity';
import { TaskCreateRequest, TaskUpdateRequest, TaskListResponse } from '@/entityTypes/task-type';
import { createMockTaskEntity } from './entity-mocks';

/**
 * Mock TaskModel class for testing
 * Use with Sinon stubs or Vitest mocks
 */
export class MockTaskModel {
  private tasks: Map<number, TaskEntity> = new Map();
  private nextId = 1;

  async createTask(taskData: TaskCreateRequest): Promise<number> {
    const task = createMockTaskEntity({
      id: this.nextId++,
      name: taskData.name,
      description: taskData.description || '',
      platform: taskData.platform,
      keywords: taskData.keywords,
      location: taskData.location || '',
      numPages: taskData.numPages,
      concurrency: taskData.concurrency,
      showBrowser: taskData.showBrowser,
    });
    this.tasks.set(task.id, task);
    return task.id;
  }

  async updateTask(taskData: TaskUpdateRequest): Promise<void> {
    const task = this.tasks.get(taskData.id);
    if (!task) {
      throw new Error(`Task with ID ${taskData.id} not found`);
    }

    if (taskData.name !== undefined) task.name = taskData.name;
    if (taskData.description !== undefined) task.description = taskData.description;
    if (taskData.platform !== undefined) task.platform = taskData.platform;
    if (taskData.keywords !== undefined) task.keywords = taskData.keywords;
    if (taskData.location !== undefined) task.location = taskData.location;
    if (taskData.numPages !== undefined) task.numPages = taskData.numPages;
    if (taskData.concurrency !== undefined) task.concurrency = taskData.concurrency;
    if (taskData.showBrowser !== undefined) task.showBrowser = taskData.showBrowser;

    task.updated_at = new Date().toISOString();
    this.tasks.set(task.id, task);
  }

  async deleteTask(taskId: number): Promise<void> {
    if (!this.tasks.has(taskId)) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    this.tasks.delete(taskId);
  }

  async getTaskById(taskId: number): Promise<TaskEntity | null> {
    return this.tasks.get(taskId) || null;
  }

  async getTaskList(page: number, size: number, search?: string): Promise<TaskListResponse> {
    let tasks = Array.from(this.tasks.values());

    // Apply search filter if provided
    if (search) {
      const searchLower = search.toLowerCase();
      tasks = tasks.filter(
        (task) =>
          task.name.toLowerCase().includes(searchLower) ||
          task.description?.toLowerCase().includes(searchLower) ||
          task.keywords.some((kw) => kw.toLowerCase().includes(searchLower))
      );
    }

    // Sort by id descending (newest first)
    tasks.sort((a, b) => b.id - a.id);

    // Apply pagination
    const total = tasks.length;
    const startIndex = (page - 1) * size;
    const endIndex = startIndex + size;
    const paginatedTasks = tasks.slice(startIndex, endIndex);

    return {
      tasks: paginatedTasks,
      total,
      page,
      size,
    };
  }

  async updateTaskStatus(taskId: number, status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    task.status = status;
    task.updated_at = new Date().toISOString();
    if (status === 'completed' || status === 'failed') {
      task.completed_at = new Date().toISOString();
    }
    this.tasks.set(taskId, task);
  }

  async getTaskResults(taskId: number, page: number, size: number): Promise<{
    results: unknown[];
    total: number;
    page: number;
    size: number;
  }> {
    // Mock implementation - return empty results
    return {
      results: [],
      total: 0,
      page,
      size,
    };
  }

  // Helper methods for testing
  clear(): void {
    this.tasks.clear();
    this.nextId = 1;
  }

  addTask(task: TaskEntity): void {
    this.tasks.set(task.id, task);
    if (task.id >= this.nextId) {
      this.nextId = task.id + 1;
    }
  }

  getTaskCount(): number {
    return this.tasks.size;
  }
}
