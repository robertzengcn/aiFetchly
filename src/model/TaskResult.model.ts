import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { TaskResultEntity } from "@/entity/TaskResult.entity";
import { getRecorddatetime } from "@/modules/lib/function";
//import en from "@/views/lang/en";

export interface TaskResultData {
  id?: number;
  taskrun_id: number;
  url: string;
  title: string;
  content?: string;
  lang?: string;
  record_time?: string;
}

export type TaskResultSearchres = {
  Total: number;
  Records: Array<TaskResultData>;
}

export class TaskResultModel extends BaseDb {
  private repository: Repository<TaskResultEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(TaskResultEntity);
  }

  /**
   * Save task result
   * @param taskresult The task result data
   * @param callback Optional callback function
   * @returns The ID of the saved task result
   */
  async saveTaskresult(
    taskresult: TaskResultData,
    callback?: ((arg: any) => void) | undefined | null
  ): Promise<number> {
    if (!taskresult.taskrun_id) {
      throw new Error(`task run id empty`);
    }

    const entity = new TaskResultEntity();
    entity.taskrun_id = taskresult.taskrun_id;
    entity.url = taskresult.url;
    entity.title = taskresult.title;
    entity.content = taskresult.content? taskresult.content : '';
    entity.lang = taskresult.lang? taskresult.lang : '';
    // entity.result_path = JSON.stringify({
    //   url: taskresult.url,
    //   title: taskresult.title,
    //   content: taskresult.content,
    //   lang: taskresult.lang
    // });
    entity.record_time = getRecorddatetime();

    const savedEntity = await this.repository.save(entity);

    if (callback) {
      callback(savedEntity.id);
    }

    return savedEntity.id;
  }

  /**
   * Get task result list by task run id
   * @param taskrunId The task run ID
   * @param page Page number
   * @param size Page size
   * @param callback Optional callback function
   * @returns Task result search results
   */
  async getTaskresultlist(
    taskrunId: number,
    page: number,
    size: number,
    callback?: ((res: TaskResultSearchres) => void) | undefined | null
  ): Promise<TaskResultSearchres> {
    const [results, total] = await this.repository.findAndCount({
      where: {  taskrun_id: taskrunId },
      order: { id: "DESC" },
      take: size,
      skip: page * size
    });

    // Convert entity objects to the expected format
    const records: TaskResultData[] = results.map(entity => {
    //   const resultData = JSON.parse(entity.result_path || '{}');
      return {
        id: entity.id,
        taskrun_id: entity.taskrun_id,
        url: entity.url || '',
        title: entity.title || '',
        content: entity.content,
        lang: entity.lang,
        record_time: entity.record_time
      };
    });

    const response: TaskResultSearchres = {
      Total: total,
      Records: records
    };

    if (callback) {
      callback(response);
    }

    return response;
  }

  /**
   * Truncate the database table
   */
  async truncatedb(): Promise<void> {
    await this.repository.clear();
  }

  /**
   * Delete task results by task ID
   * @param taskId The task ID
   * @returns Number of affected rows
   */
  async deleteTaskResults(taskId: number): Promise<number> {
    const result = await this.repository.delete({ taskrun_id: taskId });
    return result.affected || 0;
  }
}