import { InstalledSkillModel } from "@/model/InstalledSkill.model";
import { InstalledSkillEntity } from "@/entity/InstalledSkill.entity";
import { BaseModule } from "@/modules/baseModule";

export class SkillManagementModule extends BaseModule {
    private skillModel: InstalledSkillModel;

    constructor() {
        super();
        this.skillModel = new InstalledSkillModel(this.dbpath);
    }

    public async listInstalledSkills(): Promise<InstalledSkillEntity[]> {
        return this.skillModel.findAll();
    }

    public async listEnabledSkills(): Promise<InstalledSkillEntity[]> {
        return this.skillModel.findEnabled();
    }

    public async getSkillByName(
        name: string,
    ): Promise<InstalledSkillEntity | null> {
        return this.skillModel.findByName(name);
    }

    public async installSkill(
        skill: Partial<InstalledSkillEntity>,
    ): Promise<number> {
        return this.skillModel.create(skill);
    }

    public async toggleSkill(name: string, enabled: boolean): Promise<boolean> {
        return this.skillModel.toggle(name, enabled);
    }

    public async uninstallSkill(name: string): Promise<boolean> {
        return this.skillModel.remove(name);
    }
}
