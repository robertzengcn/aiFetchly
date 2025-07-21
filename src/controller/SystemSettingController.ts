// import {SystemSettingGroup} from '@/model/SystemSettingGroup.model'; 
import { SystemSettingGroupDisplay,SetttingUpdate,SystemSettingDisplay } from '@/entityTypes/systemsettingType';

import { SystemSettingGroupModule } from "@/modules/SystemSettingGroupModule"
import { SystemSettingModule } from "@/modules/SystemSettingModule"
// import {SystemSetting,SystemSettingGroup,SystemSettingDetail} from '@/model/modelIndex';  
import { SystemSettingOptionModule } from "@/modules/SystemSettingOptionModule"
export class SystemSettingController {
    private systemSettingModule: SystemSettingModule
    private systemSettingGroupModule: SystemSettingGroupModule
    private systemSettingOptionModule: SystemSettingOptionModule

    constructor() {
        this.systemSettingModule = new SystemSettingModule()
        this.systemSettingGroupModule = new SystemSettingGroupModule()
        this.systemSettingOptionModule = new SystemSettingOptionModule()
    }
    public async selectAllSystemSettings(): Promise<SystemSettingGroupDisplay[]> {
        const grouplist = await this.systemSettingGroupModule.listall()
        const result: SystemSettingGroupDisplay[] = [];
        if (grouplist) {
            for (const group of grouplist) {
                const systemSettingDisplayList: SystemSettingGroupDisplay = {
                    id: group.id,
                    name: group.name,
                    description: group.description,
                    items: []
                };

                if (group.settings) {
                    for (const setting of group.settings) {
                        const item: SystemSettingDisplay = {
                            id: setting.id,
                            key: setting.key,
                            value: setting.value,
                            description: setting.description,
                            type: (setting.type as "input" | "select" | "radio" | "checkbox"),
                            // options: setting.options || []
                        };
                        if (setting.type == 'select' || setting.type == 'radio' || setting.type == 'checkbox') {
                            const optionList = await this.systemSettingOptionModule.findOptionBySetting(setting)
                            item.options = optionList.map(option => ({
                                id: option.id,
                                optionValue: option.value,
                                optionLabel: option.label || option.value
                            }))
                        }
                        systemSettingDisplayList.items.push(item);
                    }
                }

                result.push(systemSettingDisplayList);
            }
        }
        return result;
    }

    //update system setting
    public async updateSystemSettings(settingsId: number, value: string | null): Promise<boolean> {
        const res = await this.systemSettingModule.updateSystemSetting(settingsId, value)
        if (res) {
            return true
        } else {
            return false
        }
    }
}