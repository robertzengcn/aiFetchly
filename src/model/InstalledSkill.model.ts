import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { InstalledSkillEntity } from "@/entity/InstalledSkill.entity";

export class InstalledSkillModel extends BaseDb {
    private repository: Repository<InstalledSkillEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(InstalledSkillEntity);
    }

    async findAll(): Promise<InstalledSkillEntity[]> {
        return await this.repository.find({
            order: { createdAt: "DESC" },
        });
    }

    async findEnabled(): Promise<InstalledSkillEntity[]> {
        return await this.repository.find({
            where: { enabled: 1 },
        });
    }

    async findByName(name: string): Promise<InstalledSkillEntity | null> {
        return await this.repository.findOne({ where: { name } });
    }

    async create(skill: Partial<InstalledSkillEntity>): Promise<number> {
        const entity = this.repository.create(skill);
        const saved = await this.repository.save(entity);
        return saved.id;
    }

    async updateByName(
        name: string,
        data: Partial<InstalledSkillEntity>,
    ): Promise<boolean> {
        const result = await this.repository.update({ name }, data);
        return (result.affected ?? 0) > 0;
    }

    async remove(name: string): Promise<boolean> {
        const result = await this.repository.delete({ name });
        return (result.affected ?? 0) > 0;
    }

    async toggle(name: string, enabled: boolean): Promise<boolean> {
        const result = await this.repository.update(
            { name },
            { enabled: enabled ? 1 : 0 },
        );
        return (result.affected ?? 0) > 0;
    }
}
