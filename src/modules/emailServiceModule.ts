import { BaseModule } from "@/modules/baseModule";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { SortBy } from "@/entityTypes/commonType";
import { ListData } from "@/entityTypes/commonType";
import { EmailServiceModuleInterface } from "@/modules/interface/EmailServiceModuleInterface";

export class EmailServiceModule extends BaseModule implements EmailServiceModuleInterface {
    private emailServiceModel: EmailServiceModel;

    constructor() {
        super();
        this.emailServiceModel = new EmailServiceModel(this.dbpath);
    }

    async createEmailService(service: EmailServiceEntity): Promise<number> {
        try {
            return await this.emailServiceModel.create(service);
        } catch (error) {
            console.error('Error creating email service:', error);
            throw error;
        }
    }

    async getEmailService(id: number): Promise<EmailServiceEntity | undefined> {
        try {
            return await this.emailServiceModel.read(id);
        } catch (error) {
            console.error('Error getting email service:', error);
            throw error;
        }
    }

    async updateEmailService(id: number, service: EmailServiceEntity): Promise<void> {
        try {
            await this.emailServiceModel.update(id, service);
        } catch (error) {
            console.error('Error updating email service:', error);
            throw error;
        }
    }

    async deleteEmailService(id: number): Promise<void> {
        try {
            await this.emailServiceModel.delete(id);
        } catch (error) {
            console.error('Error deleting email service:', error);
            throw error;
        }
    }

    async updateEmailServiceStatus(id: number, status: number): Promise<void> {
        try {
            await this.emailServiceModel.updateServiceStatus(id, status);
        } catch (error) {
            console.error('Error updating email service status:', error);
            throw error;
        }
    }

    async listEmailServices(page: number, size: number, search?: string,sort?: SortBy): Promise<ListData<EmailServiceEntity>> {
        try {
            const records = await this.emailServiceModel.listEmailServices(page, size, search,sort);
            const num = await this.emailServiceModel.countEmailServices();
           
            return {
                records,
                num
            };
        } catch (error) {
            console.error('Error listing email services:', error);
            throw error;
        }
    }

    async countEmailServices(): Promise<number> {
        try {
            return await this.emailServiceModel.countEmailServices();
        } catch (error) {
            console.error('Error counting email services:', error);
            throw error;
        }
    }

    async findEmailServiceByName(name: string): Promise<EmailServiceEntity | undefined> {
        try {
            return await this.emailServiceModel.findByName(name);
        } catch (error) {
            console.error('Error finding email service by name:', error);
            throw error;
        }
    }

    async findEmailServicesByHost(host: string): Promise<EmailServiceEntity[]> {
        try {
            return await this.emailServiceModel.findByHost(host);
        } catch (error) {
            console.error('Error finding email services by host:', error);
            throw error;
        }
    }

    async getActiveEmailServices(): Promise<EmailServiceEntity[]> {
        try {
            const allServices = await this.emailServiceModel.listEmailServices(0, 1000);
            return allServices.filter(service => service.status === 1);
        } catch (error) {
            console.error('Error getting active email services:', error);
            throw error;
        }
    }

    async validateEmailService(service: EmailServiceEntity): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];

        if (!service.name || service.name.trim().length === 0) {
            errors.push('Service name is required');
        }

        if (!service.from || service.from.trim().length === 0) {
            errors.push('From email is required');
        } else if (!this.isValidEmail(service.from)) {
            errors.push('From email format is invalid');
        }

        if (!service.password || service.password.trim().length === 0) {
            errors.push('Password is required');
        }

        if (!service.host || service.host.trim().length === 0) {
            errors.push('Host is required');
        }

        if (!service.port || service.port.trim().length === 0) {
            errors.push('Port is required');
        } else if (isNaN(Number(service.port))) {
            errors.push('Port must be a valid number');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    private isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
} 