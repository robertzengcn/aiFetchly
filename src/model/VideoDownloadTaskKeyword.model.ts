import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm"
import { VideoDownloadTaskKeywordEntity } from "@/entity/VideoDownloadTaskKeyword.entity"

export class VideoDownloadTaskKeywordModel extends BaseDb {
    private repository: Repository<VideoDownloadTaskKeywordEntity>
    
    constructor(filepath: string) {
        super(filepath)
        this.repository = this.sqliteDb.connection.getRepository(VideoDownloadTaskKeywordEntity)
    }
    
    /**
     * Save task keyword
     * If keyword exists for the task, update it, otherwise create new
     */
    async saveKeyword(keywordInfo: VideoDownloadTaskKeywordEntity): Promise<number> {
        // Find if this keyword already exists for this task
        let existingKeyword = await this.getKeywordByTaskAndValue(keywordInfo.task_id, keywordInfo.keyword);
        
        if (existingKeyword) {
            // Update existing keyword
            existingKeyword.keyword = keywordInfo.keyword;
            await this.repository.save(existingKeyword);
            return existingKeyword.id;
        } else {
            // Create new keyword
            const result = await this.repository.save(keywordInfo);
            return result.id;
        }
    }
    
    /**
     * Save multiple keywords for a task
     */
    async saveKeywords(taskId: number, keywords: string[]): Promise<number> {
        let count = 0;
        
        for (const keyword of keywords) {
            const keywordEntity = new VideoDownloadTaskKeywordEntity();
            keywordEntity.task_id = taskId;
            keywordEntity.keyword = keyword;
            
            await this.saveKeyword(keywordEntity);
            count++;
        }
        
        return count;
    }

    /**
     * Clear database
     */
    async truncatedb() {
        return await this.repository.clear();
    }
    
    /**
     * Get keyword by ID
     */
    async getKeyword(id: number): Promise<VideoDownloadTaskKeywordEntity | null> {
        return this.repository.findOne({ where: { id: id } });
    }
    
    /**
     * Find keyword by task ID and keyword value
     */
    async getKeywordByTaskAndValue(taskId: number, keyword: string): Promise<VideoDownloadTaskKeywordEntity | null> {
        return this.repository.findOne({ where: { task_id: taskId, keyword: keyword } });
    }
    
    /**
     * Get all keywords for a task
     */
    async getKeywordsByTaskId(taskId: number): Promise<Array<VideoDownloadTaskKeywordEntity> | null> {
        return this.repository.find({ where: { task_id: taskId } });
    }
    
    /**
     * Delete specific keyword by ID
     */
    async deleteKeyword(id: number): Promise<number> {
        const result = await this.repository.delete({ id: id });
        return result.affected || 0;
    }
    
    /**
     * Delete all keywords for a task
     */
    async deleteKeywordsByTaskId(taskId: number): Promise<number> {
        const result = await this.repository.delete({ task_id: taskId });
        return result.affected || 0;
    }
    
    /**
     * Check if a keyword exists for a task
     */
    async keywordExists(taskId: number, keyword: string): Promise<boolean> {
        const count = await this.repository.count({ 
            where: { task_id: taskId, keyword: keyword } 
        });
        return count > 0;
    }
}