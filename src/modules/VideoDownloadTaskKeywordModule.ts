import { VideoDownloadTaskKeywordModel } from "@/model/VideoDownloadTaskKeyword.model";
import { VideoDownloadTaskKeywordEntity } from "@/entity/VideoDownloadTaskKeyword.entity"
import { BaseModule } from "@/modules/baseModule";

export class VideoDownloadTaskKeywordModule extends BaseModule {
    private videoDownloadTaskKeywordModel: VideoDownloadTaskKeywordModel
    
    constructor() {
        super()
        this.videoDownloadTaskKeywordModel = new VideoDownloadTaskKeywordModel(this.dbpath)
    }
    
    /**
     * Save a single keyword for a task
     */
    public async saveKeyword(keyword: VideoDownloadTaskKeywordEntity): Promise<number> {
        return this.videoDownloadTaskKeywordModel.saveKeyword(keyword)
    }
    
    /**
     * Save multiple keywords for a task
     */
    public async saveKeywords(taskId: number, keywords: string[]): Promise<number> {
        return this.videoDownloadTaskKeywordModel.saveKeywords(taskId, keywords)
    }
    
    /**
     * Get keyword by ID
     */
    public async getKeyword(keywordId: number): Promise<VideoDownloadTaskKeywordEntity | null> {
        return this.videoDownloadTaskKeywordModel.getKeyword(keywordId)
    }
    
    /**
     * Get all keywords for a specific task
     */
    public async getTaskKeywords(taskId: number): Promise<Array<VideoDownloadTaskKeywordEntity> | null> {
        return this.videoDownloadTaskKeywordModel.getKeywordsByTaskId(taskId)
    }
    
    /**
     * Check if keyword exists for a task
     */
    public async keywordExists(taskId: number, keyword: string): Promise<boolean> {
        return this.videoDownloadTaskKeywordModel.keywordExists(taskId, keyword)
    }
    
    /**
     * Delete keyword by ID
     */
    public async deleteKeyword(keywordId: number): Promise<number> {
        return this.videoDownloadTaskKeywordModel.deleteKeyword(keywordId)
    }
    
    /**
     * Delete all keywords for a task
     */
    public async deleteTaskKeywords(taskId: number): Promise<number> {
        return this.videoDownloadTaskKeywordModel.deleteKeywordsByTaskId(taskId)
    }
    
    /**
     * Get keyword by task ID and keyword value
     */
    public async getKeywordByValue(taskId: number, keyword: string): Promise<VideoDownloadTaskKeywordEntity | null> {
        return this.videoDownloadTaskKeywordModel.getKeywordByTaskAndValue(taskId, keyword)
    }
}