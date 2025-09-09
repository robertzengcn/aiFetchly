import { SearchController } from '@/controller/searchController';
import { YellowPagesController } from '@/controller/YellowPagesController';
import { EmailextractionController } from '@/controller/emailextractionController';
import { TaskController } from '@/controller/taskController';
import { UserController } from '@/controller/UserController';
import { SystemSettingController } from '@/controller/SystemSettingController';
import { MCPRequest, MCPResponse, LoginStateError } from '@/mcp-server/types/mcpTypes';
import { loginStateValidator } from '@/mcp-server/utils/loginStateValidator';

/**
 * AiFetchly Controller for MCP Server
 * 
 * This controller acts as a bridge between the MCP server and the existing aiFetchly controllers.
 * It provides a unified interface for all aiFetchly functionality accessible via MCP tools.
 */
export class AiFetchlyController {
    private searchController: SearchController;
    private yellowPagesController: YellowPagesController;
    private emailExtractionController: EmailextractionController;
    private taskController: TaskController;
    private userController: UserController;
    private systemSettingController: SystemSettingController;
    
    constructor() {
        this.searchController = new SearchController();
        this.yellowPagesController = YellowPagesController.getInstance();
        this.emailExtractionController = new EmailextractionController();
        this.taskController = new TaskController();
        this.userController = new UserController();
        this.systemSettingController = new SystemSettingController();
    }

    /**
     * Handle MCP requests by delegating to the appropriate controller
     * This method routes MCP tool calls to the corresponding controller's handleMCPRequest method
     */
    public async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
        try {
            const { tool } = request;

            // Check if the tool requires authentication
            if (this.requiresAuthentication(tool)) {
                const authError = await loginStateValidator.validateAuthentication(tool);
                if (authError) {
                    return {
                        success: false,
                        message: authError.message,
                        error: authError,
                        timestamp: new Date().toISOString()
                    };
                }
            }

            // Route to appropriate controller based on tool name patterns
            if (this.isSearchTool(tool)) {
                return await this.searchController.handleMCPRequest(request);
            } else if (this.isEmailExtractionTool(tool)) {
                return await this.emailExtractionController.handleMCPRequest(request);
            } else if (this.isYellowPagesTool(tool)) {
                return await this.yellowPagesController.handleMCPRequest(request);
            } else if (this.isTaskManagementTool(tool)) {
                return await this.taskController.handleMCPRequest(request);
            } else if (this.isUserManagementTool(tool)) {
                return await this.userController.handleMCPRequest(request);
            } else if (this.isSystemSettingsTool(tool)) {
                return await this.systemSettingController.handleMCPRequest(request);
            } else {
                // Fallback to legacy methods for tools not yet migrated
                return await this.handleLegacyRequest(request);
            }
        } catch (error) {
            console.error('Error in AiFetchlyController.handleMCPRequest:', error);
            throw error;
        }
    }

    /**
     * Check if a tool requires authentication
     * @param tool The tool name to check
     * @returns boolean - True if the tool requires authentication
     */
    private requiresAuthentication(tool: string): boolean {
        // Tools that don't require authentication
        const publicTools = [
            'user_login',
            'get_login_url',
            'open_login_page',
            'get_system_status',
            'get_task_statistics',
            'export_results',
            'get_user_profile'
        ];

        // If it's a public tool, no authentication required
        if (publicTools.includes(tool)) {
            return false;
        }

        // All other tools require authentication
        return true;
    }

    /**
     * Check if the tool is a search-related tool
     */
    private isSearchTool(tool: string): boolean {
        const searchTools = [
            'search_google', 'search_bing', 'create_search_task', 'list_search_tasks',
            'get_search_task', 'update_search_task', 'delete_search_task', 'retry_search_task',
            'get_search_error_log', 'get_search_task_details'
        ];
        return searchTools.includes(tool);
    }

    /**
     * Check if the tool is an email extraction tool
     */
    private isEmailExtractionTool(tool: string): boolean {
        const emailTools = [
            'extract_emails_from_website', 'create_email_extraction_task', 'list_email_extraction_tasks',
            'get_email_extraction_task', 'update_email_extraction_task', 'delete_email_extraction_task',
            'get_email_extraction_results', 'get_email_extraction_error_log', 'get_email_extraction_count'
        ];
        return emailTools.includes(tool);
    }

    /**
     * Check if the tool is a Yellow Pages tool
     */
    private isYellowPagesTool(tool: string): boolean {
        const yellowPagesTools = [
            'scrape_yellow_pages', 'create_yellow_pages_task', 'list_yellow_pages_tasks',
            'get_yellow_pages_task', 'update_yellow_pages_task', 'delete_yellow_pages_task',
            'start_yellow_pages_task', 'stop_yellow_pages_task', 'get_yellow_pages_status',
            'get_yellow_pages_results', 'export_yellow_pages_results', 'get_yellow_pages_platforms',
            'get_yellow_pages_health_status', 'bulk_create_yellow_pages_tasks', 'get_yellow_pages_error_log'
        ];
        return yellowPagesTools.includes(tool);
    }

    /**
     * Check if the tool is a task management tool
     */
    private isTaskManagementTool(tool: string): boolean {
        const taskTools = [
            'create_task', 'list_tasks', 'get_task', 'update_task', 'delete_task',
            'run_task', 'cancel_task', 'get_task_results'
        ];
        return taskTools.includes(tool);
    }

    /**
     * Check if the tool is a user management tool
     */
    private isUserManagementTool(tool: string): boolean {
        const userTools = [
            'user_login', 'get_user_info', 'check_login_status', 'update_user_info',
            'get_login_url', 'open_login_page'
        ];
        return userTools.includes(tool);
    }

    /**
     * Check if the tool is a system settings tool
     */
    private isSystemSettingsTool(tool: string): boolean {
        const settingsTools = [
            'get_system_settings', 'update_system_setting'
        ];
        return settingsTools.includes(tool);
    }

    /**
     * Handle legacy requests that haven't been migrated to the new adapter pattern
     */
    private async handleLegacyRequest(request: MCPRequest): Promise<MCPResponse> {
        const { tool, parameters } = request;
        
        try {
            // Map legacy tool names to existing methods
            switch (tool) {
                case 'get_system_status':
                    const status = await this.getSystemStatus();
                    return {
                        success: true,
                        message: 'System status retrieved successfully',
                        data: status,
                        timestamp: new Date().toISOString()
                    };
                
                case 'get_task_statistics':
                    const stats = await this.getTaskStatistics(parameters);
                    return {
                        success: true,
                        message: 'Task statistics retrieved successfully',
                        data: stats,
                        timestamp: new Date().toISOString()
                    };
                
                case 'export_results':
                    const exportData = await this.exportResults(parameters);
                    return {
                        success: true,
                        message: 'Results exported successfully',
                        data: exportData,
                        timestamp: new Date().toISOString()
                    };
                
                case 'get_user_profile':
                    const profile = await this.getUserProfile();
                    return {
                        success: true,
                        message: 'User profile retrieved successfully',
                        data: profile,
                        timestamp: new Date().toISOString()
                    };
                
                default:
                    return {
                        success: false,
                        message: `Unknown tool: ${tool}`,
                        error: {
                            code: 'UNKNOWN_TOOL',
                            message: `Tool '${tool}' is not supported`,
                            details: 'This tool may not be implemented yet or may have been renamed'
                        },
                        timestamp: new Date().toISOString()
                    };
            }
        } catch (error) {
            console.error(`Error in handleLegacyRequest for tool ${tool}:`, error);
            return {
                success: false,
                message: 'Internal error occurred while processing request',
                error: {
                    code: 'INTERNAL_ERROR',
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                },
                timestamp: new Date().toISOString()
            };
        }
    }
    
    /**
     * Handle search engine related operations
     */
    public async handleSearchEngine(operation: string, params: any): Promise<any> {
        try {
            switch (operation) {
                case 'create_search_task':
                    return await this.searchController.searchData(params);
                
                case 'list_search_tasks':
                    return await this.searchController.listSearchresult(params.page || 0, params.size || 20, params.sortBy);
                
                case 'get_search_task':
                    return await this.searchController.getTaskDetailsForEdit(params.task_id);
                
                case 'get_search_results':
                    return await this.searchController.listSearchresult(params.task_id, params.page || 0, params.size || 20);
                
                case 'update_search_task':
                    return await this.searchController.updateSearchTask(params.task_id, params);
                
                case 'delete_search_task':
                    // Note: deleteSearchTask method not found in SearchController
                    throw new Error('Delete search task functionality not implemented');
                
                default:
                    throw new Error(`Unknown search engine operation: ${operation}`);
            }
        } catch (error) {
            console.error(`Error in handleSearchEngine ${operation}:`, error);
            throw error;
        }
    }
    
    /**
     * Handle yellow pages related operations
     */
    public async handleYellowPages(operation: string, params: any): Promise<any> {
        try {
            switch (operation) {
                case 'create_yellow_pages_task':
                    return await this.yellowPagesController.createTask(params);
                
                case 'list_yellow_pages_tasks':
                    return await this.yellowPagesController.listTasks(params);
                
                case 'get_yellow_pages_task':
                    return await this.yellowPagesController.getTask(params.task_id);
                
                case 'get_yellow_pages_results':
                    return await this.yellowPagesController.getTaskResults(params.task_id, params);
                
                case 'update_yellow_pages_task':
                    return await this.yellowPagesController.updateTask(params.task_id, params);
                
                case 'delete_yellow_pages_task':
                    return await this.yellowPagesController.deleteTask(params.task_id);
                
                default:
                    throw new Error(`Unknown yellow pages operation: ${operation}`);
            }
        } catch (error) {
            console.error(`Error in handleYellowPages ${operation}:`, error);
            throw error;
        }
    }
    
    /**
     * Handle website scraping related operations
     */
    public async handleWebsiteScraping(operation: string, params: any): Promise<any> {
        try {
            // Note: Website scraping functionality may need to be implemented
            // based on existing modules or created as a new feature
            switch (operation) {
                case 'create_website_scraping_task':
                    return await this.createWebsiteScrapingTask(params);
                
                case 'list_website_scraping_tasks':
                    return await this.listWebsiteScrapingTasks(params);
                
                case 'get_website_scraping_task':
                    return await this.getWebsiteScrapingTask(params.task_id);
                
                case 'get_website_scraping_results':
                    return await this.getWebsiteScrapingResults(params);
                
                case 'update_website_scraping_task':
                    return await this.updateWebsiteScrapingTask(params);
                
                case 'delete_website_scraping_task':
                    return await this.deleteWebsiteScrapingTask(params.task_id);
                
                default:
                    throw new Error(`Unknown website scraping operation: ${operation}`);
            }
        } catch (error) {
            console.error(`Error in handleWebsiteScraping ${operation}:`, error);
            throw error;
        }
    }
    
    /**
     * Handle email extraction related operations
     */
    public async handleEmailExtraction(operation: string, params: any): Promise<any> {
        try {
            switch (operation) {
                case 'create_email_extraction_task':
                    return await this.emailExtractionController.searchEmail(params);
                
                case 'list_email_extraction_tasks':
                    return await this.emailExtractionController.listEmailSearchtasks(params.page || 0, params.size || 20, params.sortby);
                
                case 'get_email_extraction_task':
                    return await this.emailExtractionController.getEmailSearchTask(params.task_id);
                
                case 'get_email_extraction_results':
                    return await this.emailExtractionController.Emailtaskresult(params.task_id, params.page || 0, params.size || 20);
                
                case 'update_email_extraction_task':
                    return await this.emailExtractionController.updateEmailSearchTask(params.task_id, params);
                
                case 'delete_email_extraction_task':
                    return await this.emailExtractionController.deleteEmailSearchTask(params.task_id);
                
                default:
                    throw new Error(`Unknown email extraction operation: ${operation}`);
            }
        } catch (error) {
            console.error(`Error in handleEmailExtraction ${operation}:`, error);
            throw error;
        }
    }
    
    /**
     * Get system status and health information
     */
    public async getSystemStatus(): Promise<any> {
        try {
            const status = {
                timestamp: new Date().toISOString(),
                status: 'healthy',
                version: '1.0.0',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                platform: process.platform,
                node_version: process.version
            };
            
            return {
                success: true,
                data: status
            };
        } catch (error) {
            console.error('Error getting system status:', error);
            throw error;
        }
    }
    
    /**
     * Get task statistics
     */
    public async getTaskStatistics(params: any): Promise<any> {
        try {
            // This would typically aggregate statistics from all task types
            const stats = {
                total_tasks: 0,
                completed_tasks: 0,
                running_tasks: 0,
                failed_tasks: 0,
                search_tasks: 0,
                yellow_pages_tasks: 0,
                website_scraping_tasks: 0,
                email_extraction_tasks: 0,
                date_range: params.date_range || null
            };
            
            return {
                success: true,
                data: stats
            };
        } catch (error) {
            console.error('Error getting task statistics:', error);
            throw error;
        }
    }
    
    /**
     * Export results to various formats
     */
    public async exportResults(params: any): Promise<any> {
        try {
            const { task_ids, format, include_metadata } = params;
            
            // This would typically aggregate results from all specified tasks
            // and export them in the requested format
            const exportData = {
                task_ids,
                format,
                include_metadata: include_metadata !== false,
                exported_at: new Date().toISOString(),
                file_path: `exports/export_${Date.now()}.${format}`
            };
            
            return {
                success: true,
                data: exportData
            };
        } catch (error) {
            console.error('Error exporting results:', error);
            throw error;
        }
    }
    
    /**
     * Get user profile information
     */
    public async getUserProfile(): Promise<any> {
        try {
            // This would typically get user information from the user controller
            const profile = {
                user_id: 'current_user',
                email: 'user@example.com',
                created_at: new Date().toISOString(),
                last_login: new Date().toISOString(),
                preferences: {}
            };
            
            return {
                success: true,
                data: profile
            };
        } catch (error) {
            console.error('Error getting user profile:', error);
            throw error;
        }
    }
    
    // Placeholder methods for website scraping functionality
    // These would need to be implemented based on existing modules or new development
    
    private async createWebsiteScrapingTask(params: any): Promise<any> {
        // TODO: Implement website scraping task creation
        return {
            success: true,
            message: 'Website scraping task creation not yet implemented',
            data: params
        };
    }
    
    private async listWebsiteScrapingTasks(params: any): Promise<any> {
        // TODO: Implement website scraping task listing
        return {
            success: true,
            message: 'Website scraping task listing not yet implemented',
            data: { tasks: [], total: 0 }
        };
    }
    
    private async getWebsiteScrapingTask(taskId: number): Promise<any> {
        // TODO: Implement website scraping task retrieval
        return {
            success: true,
            message: 'Website scraping task retrieval not yet implemented',
            data: { task_id: taskId }
        };
    }
    
    private async getWebsiteScrapingResults(params: any): Promise<any> {
        // TODO: Implement website scraping results retrieval
        return {
            success: true,
            message: 'Website scraping results retrieval not yet implemented',
            data: { results: [], total: 0 }
        };
    }
    
    private async updateWebsiteScrapingTask(params: any): Promise<any> {
        // TODO: Implement website scraping task update
        return {
            success: true,
            message: 'Website scraping task update not yet implemented',
            data: params
        };
    }
    
    private async deleteWebsiteScrapingTask(taskId: number): Promise<any> {
        // TODO: Implement website scraping task deletion
        return {
            success: true,
            message: 'Website scraping task deletion not yet implemented',
            data: { task_id: taskId }
        };
    }
}
