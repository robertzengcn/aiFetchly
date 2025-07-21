// import {SystemSettingGroup,SystemSetting} from '@/model/modelIndex';
import {InputTypeEnum} from "@/entityTypes/commonType"
export const deepseeklocal='Deepseek-local'
export const deepseeklocaldescription='Deepseek-local-description'
export const deepseeklocalurl='Deepseek-url'
export const deepseeklocalurldesc='Deepseek-url-description'
export async function runAfterTableCreate(): Promise<void> {
    await createDeepseekitem()

}
//create deepseek config
export async function createDeepseekitem():Promise<void>{
   // Execute any logic needed right after the table is created
//    console.log("Table creation complete. Running post-creation tasks...");

//    // Add deepseek local data
//    await SystemSettingGroup.findOne({ where: { name: deepseeklocal } }).then(async (group) => {
//        if (!group) {
//            const depgroup=await SystemSettingGroup.create({
//                name: deepseeklocal,
//                description: deepseeklocaldescription
//            });

//            SystemSetting.findOne({ where: { key: deepseeklocalurl } }).then(async (setting) => {
//              if(!setting){
//                await SystemSetting.create({
//                    key: deepseeklocalurl,
//                    value: deepseeklocalurldesc,
//                    description: 'Deepseek local url',
//                    type: InputTypeEnum.INPUT,
//                    group_id: depgroup.id
//                })
//              }
//            })
//        }
//    })
}