import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { SchedulerStatusEntity } from "@/entity/SchedulerStatus.entity";

export class SchedulerStatusModel extends BaseDb {
    private repository: Repository<SchedulerStatusEntity>;
    
    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(SchedulerStatusEntity);
    }
    
    /**
     * Get the current scheduler status from database
     */
    async getStatus(): Promise<SchedulerStatusEntity | null> {
        try {
            const status = await this.repository.findOne({
                where: {},
                order: { id: 'DESC' }
            });
            return status;
        } catch (error) {
            console.error('Failed to get scheduler status:', error);
            return null;
        }
    }
    
    /**
     * Update scheduler status in database
     */
    async updateStatus(status: Partial<SchedulerStatusEntity>): Promise<void> {
        try {
            const existingStatus = await this.getStatus();
            if (existingStatus) {
                await this.repository.update(existingStatus.id, status);
            } else {
                await this.repository.save(status);
            }
        } catch (error) {
            console.error('Failed to update scheduler status:', error);
            throw error;
        }
    }
    
    /**
     * Initialize scheduler status if it doesn't exist
     */
    async initializeStatus(): Promise<void> {
        try {
            const existingStatus = await this.getStatus();
            if (!existingStatus) {
                const initialStatus = new SchedulerStatusEntity();
                initialStatus.is_running = false;
                initialStatus.active_schedules = 0;
                initialStatus.total_schedules = 0;
                await this.repository.save(initialStatus);
                console.log('Scheduler status initialized');
            }
        } catch (error) {
            console.error('Failed to initialize scheduler status:', error);
            throw error;
        }
    }
    
    /**
     * Reset scheduler status to default values
     */
    async resetStatus(): Promise<void> {
        try {
            const existingStatus = await this.getStatus();
            if (existingStatus) {
                await this.repository.update(existingStatus.id, {
                    is_running: false,
                    active_schedules: 0,
                    total_schedules: 0,
                    last_check_time: undefined,
                    next_check_time: undefined,
                    last_error_message: undefined,
                    last_start_time: undefined,
                    last_stop_time: undefined
                });
            } else {
                await this.initializeStatus();
            }
        } catch (error) {
            console.error('Failed to reset scheduler status:', error);
            throw error;
        }
    }
    
    /**
     * Check if scheduler should auto-start based on database status
     */
    async shouldAutoStart(): Promise<boolean> {
        try {
            const status = await this.getStatus();
            return status?.is_running || false;
        } catch (error) {
            console.error('Failed to check auto-start status:', error);
            return false;
        }
    }
} 