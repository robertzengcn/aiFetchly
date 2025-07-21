import { EmailFilterTaskRelationEntity } from "@/entity/EmailFilterTaskRelation.entity";
import { EmailFilterTaskRelationEntityType } from "@/model/EmailFilterTaskRelation.model";

export interface EmailFilterTaskRelationModuleInterface {
    /**
     * Create a new email filter task relation
     * @param relation The email filter task relation entity type
     * @returns The ID of the created relation
     */
    create(relation: EmailFilterTaskRelationEntityType): Promise<number>;

    /**
     * Get email filters by buckemail task ID
     * @param buckemailTaskId The buckemail task ID
     * @returns Array of email filter task relation entities
     */
    getEmailFiltersByBuckemailTaskId(buckemailTaskId: number): Promise<EmailFilterTaskRelationEntity[]>;

    /**
     * Update relations by buckemail task ID
     * @param buckemailTaskId The buckemail task ID
     * @param relations Array of email filter task relation entity types
     */
    updateByBuckemailTaskId(buckemailTaskId: number, relations: EmailFilterTaskRelationEntityType[]): Promise<void>;

    /**
     * Delete relations by buckemail task ID
     * @param buckemailTaskId The buckemail task ID
     */
    deleteByBuckemailTaskId(buckemailTaskId: number): Promise<void>;
} 