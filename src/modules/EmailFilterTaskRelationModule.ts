import { BaseModule } from "@/modules/baseModule";
import { EmailFilterTaskRelationModel, EmailFilterTaskRelationEntityType } from "@/model/EmailFilterTaskRelation.model";
import { EmailFilterTaskRelationEntity } from "@/entity/EmailFilterTaskRelation.entity";
import { EmailFilterTaskRelationModuleInterface } from "@/modules/interface/EmailFilterTaskRelationModuleInterface";

export class EmailFilterTaskRelationModule extends BaseModule implements EmailFilterTaskRelationModuleInterface{
    private model: EmailFilterTaskRelationModel;

    constructor() {
        super();
        this.model = new EmailFilterTaskRelationModel(this.dbpath);
    }

    async create(relation: EmailFilterTaskRelationEntityType): Promise<number> {
        return await this.model.create(relation);
    }

    async getEmailFiltersByBuckemailTaskId(buckemailTaskId: number): Promise<EmailFilterTaskRelationEntity[]> {
        return await this.model.getEmailFiltersByBuckemailTaskId(buckemailTaskId);
    }

    async updateByBuckemailTaskId(buckemailTaskId: number, relations: EmailFilterTaskRelationEntityType[]): Promise<void> {
        return await this.model.updateByBuckemailTaskId(buckemailTaskId, relations);
    }

    async deleteByBuckemailTaskId(buckemailTaskId: number): Promise<void> {
        return await this.model.deleteByBuckemailTaskId(buckemailTaskId);
    }
} 