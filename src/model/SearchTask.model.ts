import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { SearchTaskEntity } from "@/entity/SearchTask.entity";
import { getRecorddatetime } from "@/modules/lib/function";
//import { SearhEnginer } from "@/config/searchSetting";
import { SearchtaskdbEntity } from "@/entityTypes/searchControlType";
import { SortBy } from "@/entityTypes/commonType";

export enum SearchTaskStatus {
  Processing = 1,
  Complete = 2,
  Error = 3,
  NotStart = 4
}

export class SearchTaskModel extends BaseDb {
  private repository: Repository<SearchTaskEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(SearchTaskEntity);
  }

  /**
   * Save a new search task
   * @param enginerId The search engine ID
   * @returns The ID of the created task
   */
  async saveSearchTask(enginerId: number,num_pages?:number,concurrency?:number,notShowBrowser?:boolean,localBrowser?:string,accounts?:Array<number>): Promise<number> {
    const taskEntity = new SearchTaskEntity();
    taskEntity.enginer_id = enginerId.toString();
    taskEntity.record_time = getRecorddatetime();
    taskEntity.status = SearchTaskStatus.NotStart;
    taskEntity.num_pages = num_pages?num_pages:1;
    taskEntity.concurrency = concurrency?concurrency:1;
    taskEntity.notShowBrowser = notShowBrowser ? 1 : 0;
    //taskEntity.useLocalbrowserdata = useLocalbrowserdata ? 1 : 0;
    taskEntity.localBrowser = localBrowser?localBrowser:"";
    //taskEntity.accounts = accounts?accounts:[];
    const savedTask = await this.repository.save(taskEntity);
    return savedTask.id;
  }

  /**
   * Update task error log path
   * @param taskId The task ID
   * @param log The error log content
   */
  async updateTaskLog(taskId: number, log: string): Promise<void> {
    await this.repository.update(
      { id: taskId },
      { error_log: log }
    );
  }

  /**
   * Update task runtime log path
   * @param taskId The task ID
   * @param log The runtime log content
   */
  async updateRuntimeLog(taskId: number, log: string): Promise<void> {
    await this.repository.update(
      { id: taskId },
      { runtime_log: log }
    );
  }

  /**
   * Update task status
   * @param taskId The task ID
   * @param status The new status
   */
  async updateTaskStatus(taskId: number, status: SearchTaskStatus): Promise<void> {
    await this.repository.update(
      { id: taskId },
      { status: status }
    );
  }

  /**
   * List tasks with pagination and sorting
   * @param page Page number (offset)
   * @param size Page size (limit)
   * @param sort Sort parameters
   * @returns Array of search task entities
   */
  async listTask(page: number, size: number, sort?: SortBy): Promise<SearchtaskdbEntity[]> {
    const allowedSortKeys = ['id', 'enginer_id', 'record_time', 'status'];
    const allowedSortOrders = ['ASC', 'DESC'];
    
    let orderOptions: any = { id: 'DESC' };
    
    if (sort && sort.key && sort.order) {
      const sortKey = sort.key.toLowerCase();
      const sortOrder = sort.order.toUpperCase();
      
      if (!allowedSortKeys.includes(sortKey)) {
        throw new Error("Not allowed sort key");
      }
      
      if (!['ASC', 'DESC'].includes(sortOrder)) {
        throw new Error("Not allowed sort order");
      }
      
      orderOptions = { [sortKey]: sortOrder };
    }
    
    const tasks = await this.repository.find({
      order: orderOptions,
      take: size,
      skip: page * size
    });
    
    return tasks as unknown as SearchtaskdbEntity[];
  }

  /**
   * Get total number of tasks
   * @returns Total count of tasks
   */
  async getTaskTotal(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Convert task status to string
   * @param status The task status enum value
   * @returns String representation of the status
   */
  taskStatusToString(status: SearchTaskStatus): string {
    switch (status) {
      case SearchTaskStatus.NotStart:
        return "Not Start";
      case SearchTaskStatus.Processing:
        return "Processing";
      case SearchTaskStatus.Complete:
        return "Complete";
      case SearchTaskStatus.Error:
        return "Error";
      default:
        return "Unknown";
    }
  }

  /**
   * Get task by ID
   * @param taskId The task ID
   * @returns The task entity
   */
  async getTaskEntity(taskId: number): Promise<SearchTaskEntity | null> {
    return this.repository.findOne({
      where: { id: taskId }
    }) 
  }

  /**
   * Check if a task is editable based on its status
   * @param taskId The task ID
   * @returns True if the task can be edited
   */
  async isTaskEditable(taskId: number): Promise<boolean> {
    const task = await this.getTaskEntity(taskId);
    if (!task) {
      return false;
    }
    // Only tasks with status "NotStart" or "Error" can be edited
    return task.status === SearchTaskStatus.NotStart || task.status === SearchTaskStatus.Error;
  }

  /**
   * Update search task properties
   * @param taskId The task ID
   * @param updates The properties to update
   * @returns True if update was successful
   */
  async updateSearchTask(taskId: number, updates: {
    enginer_id?: string;
    num_pages?: number;
    concurrency?: number;
    notShowBrowser?: number;
    localBrowser?: string;
    record_time?: string;
  }): Promise<boolean> {
    // Check if task exists and is editable
    const isEditable = await this.isTaskEditable(taskId);
    if (!isEditable) {
      throw new Error("Task cannot be edited. Only tasks with status 'NotStart' or 'Error' can be modified.");
    }

    // Validate numeric fields
    if (updates.num_pages !== undefined && (updates.num_pages < 1 || updates.num_pages > 100)) {
      throw new Error("Number of pages must be between 1 and 100");
    }

    if (updates.concurrency !== undefined && (updates.concurrency < 1 || updates.concurrency > 10)) {
      throw new Error("Concurrency must be between 1 and 10");
    }

    // Update the task
    const result = await this.repository.update(
      { id: taskId },
      updates
    );

    return result.affected !== undefined && result.affected > 0;
  }

  /**
   * Truncate the database table
   */
  async truncatedb(): Promise<void> {
    await this.repository.clear();
  }
}