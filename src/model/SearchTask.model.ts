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
   * Truncate the database table
   */
  async truncatedb(): Promise<void> {
    await this.repository.clear();
  }
}