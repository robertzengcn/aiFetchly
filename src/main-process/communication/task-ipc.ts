import { BrowserWindow } from 'electron'
import { TaskController } from '@/controller/taskController'
import {
  TaskCreateRequest,
  TaskUpdateRequest,
} from '@/entityTypes/task-type'
import { registerValidatedHandler } from '@/main-process/communication/_shared/registerValidatedHandler'
import {
  taskWriteInputSchema,
  taskByIdInputSchema,
  taskListInputSchema,
  taskResultsInputSchema,
  taskPlatformListInputSchema,
} from '@/schemas/ipc/task'

/**
 * Task IPC handlers — all 9 migrated to registerValidatedHandler.
 *
 * Envelope caveat: original handlers threw on error and returned raw
 * values (taskId / success boolean / objects). Wrapper now wraps all
 * returns in {status: true, msg: 'ok', data: <value>} and converts
 * thrown errors to {status: false, msg: <err.message>, data: null}.
 *
 * Frontend that did `const id = await invoke('task:create', ...)`
 * should now do `const id = (await invoke(...)).data`.
 */
export function registerTaskIpcHandlers(_mainWindow: BrowserWindow) {
  registerValidatedHandler(
    'task:create',
    taskWriteInputSchema,
    async (input) => {
      const taskController = new TaskController()
      return taskController.createTask(input as unknown as TaskCreateRequest)
    },
  )

  registerValidatedHandler(
    'task:update',
    taskWriteInputSchema,
    async (input) => {
      const taskController = new TaskController()
      return taskController.updateTask(input as unknown as TaskUpdateRequest)
    },
  )

  registerValidatedHandler(
    'task:delete',
    taskByIdInputSchema,
    async (input) => {
      const taskController = new TaskController()
      return taskController.deleteTask(input.id)
    },
  )

  registerValidatedHandler(
    'task:list',
    taskListInputSchema,
    async (input) => {
      const taskController = new TaskController()
      return taskController.getTaskList(input.page, input.size, input.search)
    },
  )

  registerValidatedHandler(
    'task:detail',
    taskByIdInputSchema,
    async (input) => {
      const taskController = new TaskController()
      return taskController.getTaskDetail(input.id)
    },
  )

  registerValidatedHandler(
    'task:run',
    taskByIdInputSchema,
    async (input) => {
      const taskController = new TaskController()
      return taskController.runTask(input.id)
    },
  )

  registerValidatedHandler(
    'task:cancel',
    taskByIdInputSchema,
    async (input) => {
      const taskController = new TaskController()
      return taskController.cancelTask(input.id)
    },
  )

  registerValidatedHandler(
    'task:results',
    taskResultsInputSchema,
    async (input) => {
      const taskController = new TaskController()
      return taskController.getTaskResults(input.id, input.page, input.size)
    },
  )

  registerValidatedHandler(
    'platform:list',
    taskPlatformListInputSchema,
    async () => {
      // TODO: Implement platform list retrieval (placeholder data)
      const platforms = [
        {
          id: 'google',
          name: 'Google',
          description: 'Search engine for web scraping',
          is_active: true,
          tags: ['search', 'web'],
          config: {
            baseUrl: 'https://www.google.com',
            searchEndpoint: '/search',
            selectors: { results: '.g', title: 'h3', url: 'a[href]' },
          },
        },
        {
          id: 'linkedin',
          name: 'LinkedIn',
          description: 'Professional networking platform',
          is_active: true,
          tags: ['social', 'professional'],
          config: {
            baseUrl: 'https://www.linkedin.com',
            searchEndpoint: '/search/results',
            selectors: {
              results: '.search-result',
              title: '.result-title',
              url: 'a[href]',
            },
          },
        },
      ]
      return { platforms, total: platforms.length }
    },
  )
}
