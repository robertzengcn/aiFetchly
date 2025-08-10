import { ipcMain, BrowserWindow } from 'electron'
import { TaskController } from '@/controller/taskController'

export function registerTaskIpcHandlers(mainWindow: BrowserWindow) {
  // Create task
  ipcMain.handle('task:create', async (event, taskData) => {
    try {
      const taskController = new TaskController()
      const taskId = await taskController.createTask(taskData)
      return taskId
    } catch (error) {
      console.error('Failed to create task:', error)
      throw error
    }
  })

  // Update task
  ipcMain.handle('task:update', async (event, taskData) => {
    try {
      const taskController = new TaskController()
      const success = await taskController.updateTask(taskData)
      return success
    } catch (error) {
      console.error('Failed to update task:', error)
      throw error
    }
  })

  // Delete task
  ipcMain.handle('task:delete', async (event, { id }) => {
    try {
      const taskController = new TaskController()
      const success = await taskController.deleteTask(id)
      return success
    } catch (error) {
      console.error('Failed to delete task:', error)
      throw error
    }
  })

  // Get task list
  ipcMain.handle('task:list', async (event, { page, size, search }) => {
    try {
      const taskController = new TaskController()
      const result = await taskController.getTaskList(page, size, search)
      return result
    } catch (error) {
      console.error('Failed to get task list:', error)
      throw error
    }
  })

  // Get task detail
  ipcMain.handle('task:detail', async (event, { id }) => {
    try {
      const taskController = new TaskController()
      const task = await taskController.getTaskDetail(id)
      return task
    } catch (error) {
      console.error('Failed to get task detail:', error)
      throw error
    }
  })

  // Run task
  ipcMain.handle('task:run', async (event, { id }) => {
    try {
      const taskController = new TaskController()
      const success = await taskController.runTask(id)
      return success
    } catch (error) {
      console.error('Failed to run task:', error)
      throw error
    }
  })

  // Cancel task
  ipcMain.handle('task:cancel', async (event, { id }) => {
    try {
      const taskController = new TaskController()
      const success = await taskController.cancelTask(id)
      return success
    } catch (error) {
      console.error('Failed to cancel task:', error)
      throw error
    }
  })

  // Get task results
  ipcMain.handle('task:results', async (event, { id, page, size }) => {
    try {
      const taskController = new TaskController()
      const results = await taskController.getTaskResults(id, page, size)
      return results
    } catch (error) {
      console.error('Failed to get task results:', error)
      throw error
    }
  })

  // Platform management
  ipcMain.handle('platform:list', async (event) => {
    try {
      // TODO: Implement platform list retrieval
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
            selectors: {
              results: '.g',
              title: 'h3',
              url: 'a[href]'
            }
          }
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
              url: 'a[href]'
            }
          }
        }
      ]
      
      return {
        platforms,
        total: platforms.length
      }
    } catch (error) {
      console.error('Failed to get platform list:', error)
      throw error
    }
  })
}
