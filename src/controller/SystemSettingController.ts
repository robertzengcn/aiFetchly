// import {SystemSettingGroup} from '@/model/SystemSettingGroup.model'; 
import { SystemSettingGroupDisplay,SetttingUpdate,SystemSettingDisplay } from '@/entityTypes/systemsettingType';

import { SystemSettingGroupModule } from "@/modules/SystemSettingGroupModule"
import { SystemSettingModule } from "@/modules/SystemSettingModule"
// import {SystemSetting,SystemSettingGroup,SystemSettingDetail} from '@/model/modelIndex';  
import { SystemSettingOptionModule } from "@/modules/SystemSettingOptionModule"
import { 
    MCPRequest, 
    MCPResponse, 
    MCPSystemSettingGroup,
    MCPSystemSetting,
    MCPSystemSettingOption,
    MCPSystemSettingUpdateRequest,
    createMCPSuccessResponse,
    createMCPErrorResponse,
    createMCPError,
    MCPErrorCode
} from '@/mcp-server/types/mcpTypes';
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

    /**
     * Handle MCP requests for system settings functionality
     * This method acts as an adapter between MCP requests and the existing system settings business logic
     */
    public async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
        try {
            const { tool, parameters } = request;

            switch (tool) {
                case 'get_system_settings':
                    return await this.handleGetSystemSettingsRequest();
                
                case 'update_system_setting':
                    return await this.handleUpdateSystemSettingRequest(parameters as MCPSystemSettingUpdateRequest);
                
                default:
                    return createMCPErrorResponse(
                        createMCPError(MCPErrorCode.INVALID_PARAMETERS, `Unknown system settings tool: ${tool}`),
                        'Invalid system settings tool requested'
                    );
            }
        } catch (error) {
            console.error('Error in SystemSettingController.handleMCPRequest:', error);
            return createMCPErrorResponse(
                createMCPError(
                    MCPErrorCode.INTERNAL_ERROR,
                    'Internal error occurred while processing system settings request',
                    error instanceof Error ? error.message : String(error),
                    error instanceof Error ? error.stack : undefined
                ),
                'Failed to process system settings request'
            );
        }
    }

    /**
     * Handle get system settings requests
     */
    private async handleGetSystemSettingsRequest(): Promise<MCPResponse<MCPSystemSettingGroup[]>> {
        try {
            const systemSettings = await this.selectAllSystemSettings();

            // Convert to MCP format
            const mcpSystemSettings: MCPSystemSettingGroup[] = systemSettings.map(group => ({
                id: group.id,
                name: group.name,
                description: group.description || '',
                settings: group.items.map(setting => ({
                    id: setting.id,
                    key: setting.key,
                    value: setting.value || '',
                    description: setting.description || '',
                    type: setting.type as 'input' | 'select' | 'radio' | 'checkbox',
                    options: setting.options?.map(option => ({
                        id: option.id,
                        value: option.optionValue,
                        label: option.optionLabel
                    }))
                }))
            }));

            return createMCPSuccessResponse(mcpSystemSettings, 'System settings retrieved successfully');
        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle update system setting requests
     */
    private async handleUpdateSystemSettingRequest(params: MCPSystemSettingUpdateRequest): Promise<MCPResponse<MCPSystemSetting>> {
        try {
            const success = await this.updateSystemSettings(params.settingId, params.value);
            
            if (!success) {
                return createMCPErrorResponse(
                    createMCPError(MCPErrorCode.INTERNAL_ERROR, 'Failed to update system setting'),
                    'System setting update failed'
                );
            }

            // Get the updated setting details
            const allSettings = await this.selectAllSystemSettings();
            let updatedSetting: SystemSettingDisplay | null = null;

            // Find the updated setting
            for (const group of allSettings) {
                const setting = group.items.find(s => s.id === params.settingId);
                if (setting) {
                    updatedSetting = setting;
                    break;
                }
            }

            if (!updatedSetting) {
                return createMCPErrorResponse(
                    createMCPError(MCPErrorCode.INTERNAL_ERROR, 'Updated setting not found'),
                    'Updated setting could not be retrieved'
                );
            }

            // Convert to MCP format
            const mcpSetting: MCPSystemSetting = {
                id: updatedSetting.id,
                key: updatedSetting.key,
                value: updatedSetting.value || '',
                description: updatedSetting.description || '',
                type: updatedSetting.type as 'input' | 'select' | 'radio' | 'checkbox',
                options: updatedSetting.options?.map(option => ({
                    id: option.id,
                    value: option.optionValue,
                    label: option.optionLabel
                }))
            };

            return createMCPSuccessResponse(mcpSetting, 'System setting updated successfully');
        } catch (error) {
            throw error;
        }
    }
}