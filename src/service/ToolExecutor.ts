import { SearchModule } from '@/modules/SearchModule';
import { SearchTaskStatus } from '@/model/SearchTask.model';
import { YellowPagesController } from '@/controller/YellowPagesController';
import { TaskStatus } from '@/modules/interface/ITaskManager';
import { ToolExecutionService } from '@/service/ToolExecutionService';
import { formatYellowPagesResultsForLLM } from '@/main-process/communication/ai-chat-ipc';
import { MCPToolService } from '@/service/MCPToolService';

/**
 * Execute tools called by the AI
 */
export class ToolExecutor {
    /**
     * Execute a tool by name
     */
    static async execute(
        toolName: string,
        toolParams: Record<string, unknown>,
        conversationId: string
    ): Promise<Record<string, unknown>> {
        // Check if this is an MCP tool (format: mcp_<serverId>_<toolName>)
        if (toolName.startsWith('mcp_')) {
            return await this.executeMCPTool(toolName, toolParams);
        }

        switch (toolName) {
            case 'scrape_urls_from_google':
            case 'scrape_urls_from_bing':
            case 'scrape_urls_from_yandex':
                return await this.executeSearchEngineTool(toolName, toolParams);

            case 'search_yellow_pages':
                return await this.executeYellowPagesSearch(toolParams);

            case 'get_available_yellow_pages_platforms':
                return await this.executeGetYellowPagesPlatforms();

            case 'extract_emails_from_results':
                return await this.executeEmailExtraction(toolParams);

            default:
                return {
                    success: false,
                    error: `Unknown tool: ${toolName}`
                };
        }
    }

    /**
     * Execute MCP tool
     * Tool name format: mcp_<serverId>_<toolName>
     */
    private static async executeMCPTool(
        toolName: string,
        toolParams: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        try {
            // Parse tool name: mcp_<serverId>_<toolName>
            const parts = toolName.split('_');
            if (parts.length < 3 || parts[0] !== 'mcp') {
                return {
                    success: false,
                    error: `Invalid MCP tool name format: ${toolName}`
                };
            }

            const serverId = parseInt(parts[1], 10);
            const actualToolName = parts.slice(2).join('_'); // Handle tool names with underscores

            if (isNaN(serverId)) {
                return {
                    success: false,
                    error: `Invalid server ID in tool name: ${toolName}`
                };
            }

            const mcpService = new MCPToolService();
            const result = await mcpService.executeMCPTool(serverId, actualToolName, toolParams);

            return {
                success: true,
                result
            };
        } catch (error) {
            console.error('MCP tool execution error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error executing MCP tool'
            };
        }
    }

    /**
     * Execute search engine tool (Google, Bing, Yandex)
     */
    private static async executeSearchEngineTool(
        toolName: string,
        toolParams: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        const searchModule = new SearchModule();
        const query = typeof toolParams.query === 'string' ? toolParams.query : '';
        const numResults = typeof toolParams.num_results === 'number' ? toolParams.num_results : 10;
        
        if (!query) {
            throw new Error('parameter of Query is required');
        }

        // Map tool name to engine name
        const engineName = toolName === 'scrape_urls_from_google' ? 'Google' : 
                         toolName === 'scrape_urls_from_bing' ? 'Bing' : 
                         'Yandex';

        // Calculate num_pages based on num_results (assuming ~10 results per page)
        const numPages = Math.ceil(numResults / 10);

        // Execute search
        const taskId = await searchModule.searchByKeywordAndEngine(
            [query],
            engineName,
            {
                num_pages: numPages,
                concurrency: 1,
                notShowBrowser: false
            }
        );

        // Poll task status until complete or error (max 10 minutes)
        let taskStatus: SearchTaskStatus | null = null;
        const maxWaitTime = 600000; // 10 minutes
        const pollInterval = 1000; // 1 second
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            taskStatus = await searchModule.getTaskStatus(taskId);
            if (taskStatus === null) {
                throw new Error(`Task ${taskId} not found`);
            }
            if (taskStatus === SearchTaskStatus.Complete || taskStatus === SearchTaskStatus.Error) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Check if task completed successfully
        if (taskStatus !== SearchTaskStatus.Complete) {
            throw new Error(`Search task ${taskId} did not complete successfully. Status: ${taskStatus}`);
        }

        // Get search results
        const results = await searchModule.listSearchResult(taskId, 1, numResults);

        // Extract clean results using service
        const cleanResults = ToolExecutionService.extractCleanResults(results);

        // Format results for LLM consumption (readable list format)
        const formattedResults = ToolExecutionService.formatSearchResultsForLLM(cleanResults);

        // Create comprehensive tool result
        return {
            success: true,
            taskId: taskId,
            query: query,
            engine: engineName,
            totalResults: results.length,
            // Formatted summary for LLM
            summary: formattedResults,
            // Clean structured data (no HTML blobs or messy metadata)
            results: cleanResults
        };
    }

    /**
     * Execute Yellow Pages search
     */
    private static async executeYellowPagesSearch(
        toolParams: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        const yellowPagesController = YellowPagesController.getInstance();
        const platform = typeof toolParams.platform === 'string' ? toolParams.platform : '';
        const searchTerm = typeof toolParams.search_term === 'string' ? toolParams.search_term : '';
        const location = typeof toolParams.location === 'string' ? toolParams.location : '';
        const numResults = typeof toolParams.num_results === 'number' ? toolParams.num_results : 20;

        if (!platform || !searchTerm || !location) {
            throw new Error('Platform, search_term, and location are required parameters');
        }

        // Calculate max_pages based on num_results (assuming ~20 results per page)
        const maxPages = Math.max(1, Math.ceil(numResults / 20));

        // Create task
        const taskId = await yellowPagesController.createTask({
            name: `AI Chat Search: ${searchTerm} in ${location}`,
            platform: platform,
            keywords: [searchTerm],
            location: location,
            max_pages: maxPages,
            concurrency: 1,
            headless: true,
            delay_between_requests: 2000
        });

        // Start the task
        await yellowPagesController.startTask(taskId);

        // Poll task status until complete or error (max 10 minutes)
        let taskStatus: TaskStatus | null = null;
        const maxWaitTime = 600000; // 10 minutes
        const pollInterval = 2000; // 2 seconds
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            const taskInfo = await yellowPagesController.getTask(taskId);
            taskStatus = taskInfo.status;

            if (taskStatus === TaskStatus.Completed || taskStatus === TaskStatus.Failed) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Check if task completed successfully
        if (taskStatus !== TaskStatus.Completed) {
            const taskInfo = await yellowPagesController.getTask(taskId);
            const errorMsg = taskInfo.task.error_log || `Task ${taskId} did not complete successfully. Status: ${taskStatus}`;
            throw new Error(errorMsg);
        }

        // Get search results
        const taskResults = await yellowPagesController.getTaskResults(taskId, {
            page: 0,
            size: numResults
        });

        // Format results for LLM consumption
        const formattedResults = formatYellowPagesResultsForLLM(taskResults.data);
        const cleanResults = taskResults.data.slice(0, numResults).map(result => ({
            business_name: result.business_name,
            phone: result.phone,
            email: result.email,
            website: result.website,
            address: result.address,
            rating: result.rating,
            review_count: result.review_count,
            categories: result.categories,
            platform: result.platform
        }));

        // Create comprehensive tool result
        return {
            success: true,
            taskId: taskId,
            platform: platform,
            search_term: searchTerm,
            location: location,
            totalResults: taskResults.data.length,
            resultsReturned: Math.min(numResults, taskResults.data.length),
            // Formatted summary for LLM
            summary: formattedResults,
            // Clean structured data
            results: cleanResults
        };
    }

    /**
     * Get available Yellow Pages platforms
     */
    private static async executeGetYellowPagesPlatforms(): Promise<Record<string, unknown>> {
        const yellowPagesController = YellowPagesController.getInstance();
        const platforms = await yellowPagesController.getAvailablePlatforms();

        // Format platforms for LLM consumption
        const formattedPlatforms = platforms.map(platform => ({
            name: platform.name,
            display_name: platform.display_name,
            country: platform.country,
            language: platform.language,
            is_active: platform.is_active,
            location_required: platform.locationRequired || false,
            authentication_required: platform.authentication?.requiresAuthentication || false,
            requires_cookies: platform.authentication?.requiresCookies || false,
            rate_limit: platform.rate_limit
        }));

        // Create formatted summary for LLM
        const formattedSummary = platforms.length > 0
            ? `Available Yellow Pages Platforms (${platforms.length}):\n\n${platforms.map((p, idx) => 
                `${idx + 1}. **${p.display_name}** (${p.name})\n   Country: ${p.country}, Language: ${p.language}\n   ${p.is_active ? '✅ Active' : '❌ Inactive'}${p.locationRequired ? ' | Location Required' : ''}\n   Rate Limit: ${p.rate_limit} requests/hour${p.authentication?.requiresCookies ? ' | Requires Cookies/Authentication' : ''}`
            ).join('\n\n')}`
            : 'No Yellow Pages platforms are currently available.';

        return {
            success: true,
            totalPlatforms: platforms.length,
            summary: formattedSummary,
            platforms: formattedPlatforms
        };
    }

    /**
     * Execute email extraction (placeholder)
     */
    private static async executeEmailExtraction(
        toolParams: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        // TODO: Implement email extraction when module is available
        return {
            success: false,
            error: 'Email extraction not yet implemented'
        };
    }
}

