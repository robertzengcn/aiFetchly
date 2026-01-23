'use strict';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { TaskController } from '@/controller/taskController';
import { MockTaskModel } from '../utils/model-mocks';
import { taskFixtures } from '../utils/fixtures';

describe('TaskController', () => {
  let taskController: TaskController;
  let mockTaskModel: MockTaskModel;

  beforeEach(() => {
    mockTaskModel = new MockTaskModel();
    // Inject the mock model into TaskController
    taskController = new TaskController(mockTaskModel as unknown);
  });

  describe('createTask', () => {
    it('should create a task successfully', async () => {
      const taskData = taskFixtures.validCreateRequest();
      const taskId = await taskController.createTask(taskData);
      
      expect(taskId).to.be.a('number');
      expect(taskId).to.be.greaterThan(0);
    });

    it('should handle task creation with minimal data', async () => {
      const taskData = taskFixtures.minimalCreateRequest();
      const taskId = await taskController.createTask(taskData);
      
      expect(taskId).to.be.a('number');
    });
  });

  describe('updateTask', () => {
    it('should update a task successfully', async () => {
      const taskData = taskFixtures.validCreateRequest();
      const taskId = await taskController.createTask(taskData);
      
      const updateData = taskFixtures.validUpdateRequest(taskId);
      const result = await taskController.updateTask(updateData);
      
      expect(result).to.be.true;
    });

    it('should throw error when updating non-existent task', async () => {
      const updateData = taskFixtures.validUpdateRequest(99999);
      
      try {
        await taskController.updateTask(updateData);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.an('error');
      }
    });
  });

  describe('deleteTask', () => {
    it('should delete a task successfully', async () => {
      const taskData = taskFixtures.validCreateRequest();
      const taskId = await taskController.createTask(taskData);
      
      const result = await taskController.deleteTask(taskId);
      expect(result).to.be.true;
    });

    it('should throw error when deleting non-existent task', async () => {
      try {
        await taskController.deleteTask(99999);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.an('error');
      }
    });
  });

  describe('getTaskList', () => {
    it('should return paginated task list', async () => {
      // Create multiple tasks
      for (let i = 0; i < 5; i++) {
        const taskData = taskFixtures.validCreateRequest();
        taskData.name = `Task ${i + 1}`;
        await taskController.createTask(taskData);
      }
      
      const result = await taskController.getTaskList(1, 10);
      
      expect(result).to.have.property('tasks');
      expect(result).to.have.property('total');
      expect(result).to.have.property('page');
      expect(result).to.have.property('size');
      expect(result.tasks).to.be.an('array');
      expect(result.page).to.equal(1);
      expect(result.size).to.equal(10);
    });

    it('should support search functionality', async () => {
      const taskData = taskFixtures.validCreateRequest();
      taskData.name = 'Searchable Task';
      await taskController.createTask(taskData);
      
      const result = await taskController.getTaskList(1, 10, 'Searchable');
      
      expect(result.tasks.length).to.be.greaterThan(0);
      expect(result.tasks[0].name).to.include('Searchable');
    });

    it('should handle pagination correctly', async () => {
      // Create tasks
      for (let i = 0; i < 15; i++) {
        const taskData = taskFixtures.validCreateRequest();
        taskData.name = `Task ${i + 1}`;
        await taskController.createTask(taskData);
      }
      
      const page1 = await taskController.getTaskList(1, 10);
      const page2 = await taskController.getTaskList(2, 10);
      
      expect(page1.tasks.length).to.equal(10);
      expect(page2.tasks.length).to.be.lessThanOrEqual(10);
      expect(page1.tasks[0].id).to.not.equal(page2.tasks[0].id);
    });
  });

  describe('getTaskDetail', () => {
    it('should return task detail successfully', async () => {
      const taskData = taskFixtures.validCreateRequest();
      const taskId = await taskController.createTask(taskData);
      
      const result = await taskController.getTaskDetail(taskId);
      
      expect(result).to.have.property('task');
      expect(result.task.id).to.equal(taskId);
      expect(result.task.name).to.equal(taskData.name);
    });

    it('should throw error for non-existent task', async () => {
      try {
        await taskController.getTaskDetail(99999);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.an('error');
        expect((error as Error).message).to.include('not found');
      }
    });
  });

  describe('runTask', () => {
    it('should update task status to running', async () => {
      const taskData = taskFixtures.validCreateRequest();
      const taskId = await taskController.createTask(taskData);
      
      const result = await taskController.runTask(taskId);
      expect(result).to.be.true;
      
      const taskDetail = await taskController.getTaskDetail(taskId);
      expect(taskDetail.task.status).to.equal('running');
    });
  });

  describe('cancelTask', () => {
    it('should update task status to cancelled', async () => {
      const taskData = taskFixtures.validCreateRequest();
      const taskId = await taskController.createTask(taskData);
      
      const result = await taskController.cancelTask(taskId);
      expect(result).to.be.true;
      
      const taskDetail = await taskController.getTaskDetail(taskId);
      expect(taskDetail.task.status).to.equal('cancelled');
    });
  });

  describe('getTaskResults', () => {
    it('should return paginated task results', async () => {
      const taskData = taskFixtures.validCreateRequest();
      const taskId = await taskController.createTask(taskData);
      
      const result = await taskController.getTaskResults(taskId, 1, 10);
      
      expect(result).to.have.property('results');
      expect(result).to.have.property('total');
      expect(result).to.have.property('page');
      expect(result).to.have.property('size');
      expect(result.results).to.be.an('array');
    });
  });
});
