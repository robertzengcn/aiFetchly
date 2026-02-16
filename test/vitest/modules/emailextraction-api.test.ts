import { describe, it, expect, beforeEach, vi } from 'vitest'
import { 
  getEmailSearchTask, 
  updateEmailSearchTask, 
  deleteEmailSearchTask,
  listEmailSearchtasks,
  downloadErrorLog
} from '@/views/api/emailextraction'

// Mock the window.invoke function
const mockWindowInvoke = vi.fn()
global.window = {
  invoke: mockWindowInvoke
} as any

describe('Email Extraction API Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getEmailSearchTask', () => {
    it('should successfully get a task by ID', async () => {
      const mockTask = {
        id: 1,
        status: 'pending',
        urls: ['https://example.com'],
        createdAt: new Date().toISOString()
      }
      
      mockWindowInvoke.mockResolvedValue({
        status: true,
        data: mockTask
      })

      const result = await getEmailSearchTask(1)
      
      expect(mockWindowInvoke).toHaveBeenCalledWith('GETEMAILSEARCHTASK', { id: 1 })
      expect(result).toEqual({
        status: true,
        data: mockTask
      })
    })

    it('should handle task not found error', async () => {
      mockWindowInvoke.mockResolvedValue({
        status: false,
        msg: 'Task not found'
      })

      const result = await getEmailSearchTask(999)
      
      expect(result).toEqual({
        status: false,
        msg: 'Task not found'
      })
    })

    it('should handle network errors', async () => {
      mockWindowInvoke.mockRejectedValue(new Error('Network error'))

      await expect(getEmailSearchTask(1)).rejects.toThrow('Network error')
    })
  })

  describe('updateEmailSearchTask', () => {
    it('should successfully update a task', async () => {
      const updateData = {
        extratype: 'ManualInputUrl',
        urls: ['https://example.com'],
        pagelength: 10,
        concurrency: 1,
        notShowBrowser: false,
        processTimeout: 30
      }
      
      mockWindowInvoke.mockResolvedValue({
        status: true,
        msg: 'Task updated successfully'
      })

      const result = await updateEmailSearchTask(1, updateData)
      
      expect(mockWindowInvoke).toHaveBeenCalledWith('UPDATEEMAILSEARCHTASK', {
        id: 1,
        ...updateData
      })
      expect(result).toEqual({
        status: true,
        msg: 'Task updated successfully'
      })
    })

    it('should handle validation errors', async () => {
      const invalidData = {
        extratype: 'ManualInputUrl',
        urls: [],
        pagelength: -1,
        concurrency: 1,
        notShowBrowser: false,
        processTimeout: 30
      }
      
      mockWindowInvoke.mockResolvedValue({
        status: false,
        msg: 'Validation failed'
      })

      const result = await updateEmailSearchTask(1, invalidData)
      
      expect(result).toEqual({
        status: false,
        msg: 'Validation failed'
      })
    })

    it('should handle task status errors', async () => {
      const updateData = {
        extratype: 'ManualInputUrl',
        urls: ['https://example.com'],
        concurrency: 1,
        pagelength: 10,
        notShowBrowser: false,
        processTimeout: 30
      }
      
      mockWindowInvoke.mockResolvedValue({
        status: false,
        msg: 'Cannot edit running task'
      })

      const result = await updateEmailSearchTask(1, updateData)
      
      expect(result).toEqual({
        status: false,
        msg: 'Cannot edit running task'
      })
    })
  })

  describe('deleteEmailSearchTask', () => {
    it('should successfully delete a task', async () => {
      mockWindowInvoke.mockResolvedValue({
        status: true,
        msg: 'Task deleted successfully'
      })

      const result = await deleteEmailSearchTask(1)
      
      expect(mockWindowInvoke).toHaveBeenCalledWith('DELETEEMAILSEARCHTASK', { id: 1 })
      expect(result).toEqual({
        status: true,
        msg: 'Task deleted successfully'
      })
    })

    it('should handle task not found error', async () => {
      mockWindowInvoke.mockResolvedValue({
        status: false,
        msg: 'Task not found'
      })

      const result = await deleteEmailSearchTask(999)
      
      expect(result).toEqual({
        status: false,
        msg: 'Task not found'
      })
    })

    it('should handle permission errors', async () => {
      mockWindowInvoke.mockResolvedValue({
        status: false,
        msg: 'Permission denied'
      })

      const result = await deleteEmailSearchTask(1)
      
      expect(result).toEqual({
        status: false,
        msg: 'Permission denied'
      })
    })
  })

  describe('listEmailSearchtasks', () => {
    it('should successfully list tasks', async () => {
      const mockTasks = [
        { id: 1, status: 'pending', createdAt: new Date().toISOString() },
        { id: 2, status: 'completed', createdAt: new Date().toISOString() }
      ]
      
      mockWindowInvoke.mockResolvedValue({
        status: true,
        data: mockTasks,
        num: 2
      })

      const result = await listEmailSearchtasks({ page: 0, size: 100 })
      
      expect(mockWindowInvoke).toHaveBeenCalledWith('LISTEMAILSEARCHTASK', { page: 0, size: 100 })
      expect(result).toEqual({
        status: true,
        data: mockTasks,
        num: 2
      })
    })

    it('should handle empty task list', async () => {
      mockWindowInvoke.mockResolvedValue({
        status: true,
        data: [],
        num: 0
      })

      const result = await listEmailSearchtasks({ page: 0, size: 100 })
      
      expect(result).toEqual({
        status: true,
        data: [],
        num: 0
      })
    })
  })

  describe('downloadErrorLog', () => {
    it('should successfully download error log', async () => {
      const mockLogContent = 'Error log content...'
      
      mockWindowInvoke.mockResolvedValue({
        status: true,
        msg: '',
        data: mockLogContent
      })

      const result = await downloadErrorLog(1)
      
      expect(mockWindowInvoke).toHaveBeenCalledWith('EMAILSEARCHTASK_ERROR_LOG_DOWNLOAD', { id: 1 })
      expect(result).toEqual({
        status: true,
        msg: '',
        data: mockLogContent
      })
    })

    it('should handle log file not found', async () => {
      mockWindowInvoke.mockResolvedValue({
        status: false,
        msg: 'Log file not found'
      })

      const result = await downloadErrorLog(999)
      
      expect(result).toEqual({
        status: false,
        msg: 'Log file not found'
      })
    })

    it('should handle download errors', async () => {
      mockWindowInvoke.mockRejectedValue(new Error('Download failed'))

      await expect(downloadErrorLog(1)).rejects.toThrow('Download failed')
    })
  })
}) 