#!/usr/bin/env node

// import { readFileSync } from 'fs';
import { stdin, stdout } from 'process';
import { GoogleSearchSchema, BingSearchSchema } from './schemas/searchSchemas';
import { SearchResponseFormatter } from './utils/responseFormatter';
import { YellowPagesSearchSchema, BusinessDetailsSchema } from './schemas/yellowPagesSchemas';
import { YellowPagesResponseFormatter } from './utils/yellowPagesResponseFormatter';
import { EmailExtractionSchema, EmailValidationSchema } from './schemas/emailExtractionSchemas';
import { EmailExtractionResponseFormatter } from './utils/emailExtractionResponseFormatter';
import { CreateEmailTaskSchema, UpdateEmailTaskSchema, GetEmailTaskSchema, DeleteEmailTaskSchema, ListEmailTasksSchema } from './schemas/emailMarketingTaskSchemas';
import { EmailMarketingTaskResponseFormatter } from './utils/emailMarketingTaskResponseFormatter';
import { checkRateLimit } from './utils/rateLimiter';
import { auditLogger } from './utils/auditLogger';

interface LoginState {
    isLoggedIn: boolean;
    user?: any;
    timestamp: string;
}

/**
 * Basic MCP Server that responds to JSON-RPC requests
 */
class BasicMCPServer {
    private isRunning = false;
    private loginState: LoginState | null = null;
    
    constructor() {
        this.setupStdinHandler();
    }
    
    private setupStdinHandler() {
        let buffer = '';
        
        stdin.on('data', (chunk) => {
            buffer += chunk.toString();
            
            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (line.trim()) {
                    this.handleRequest(line.trim());
                }
            }
        });
        
        stdin.on('end', () => {
            this.isRunning = false;
        });
    }
    
    private handleRequest(line: string) {
        try {
            const request = JSON.parse(line);
            console.error('Received request:', JSON.stringify(request, null, 2));
            
            if (request.method === 'initialize') {
                this.sendResponse(request.id, {
                    protocolVersion: "2024-11-05",
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: {
                        name: "aifetchly-mcp-server",
                        version: "1.0.0"
                    }
                });
            } else if (request.method === 'tools/list') {
                this.sendResponse(request.id, {
                    tools: [
                        {
                            name: "get_system_status",
                            description: "Get system status and health information",
                            inputSchema: {
                                type: "object",
                                properties: {}
                            }
                        },
                        {
                            name: "test_connection",
                            description: "Test the MCP server connection",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    message: {
                                        type: "string",
                                        description: "Test message to echo back"
                                    }
                                }
                            }
                        },
                        {
                            name: "search_google",
                            description: "Search Google and return results",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    query: {
                                        type: "string",
                                        description: "Search query"
                                    },
                                    pages: {
                                        type: "number",
                                        description: "Number of pages to scrape (1-10)",
                                        minimum: 1,
                                        maximum: 10
                                    },
                                    language: {
                                        type: "string",
                                        description: "Search language (default: en)"
                                    },
                                    result_type: {
                                        type: "string",
                                        enum: ["organic", "ads", "all"],
                                        description: "Type of results to return"
                                    }
                                },
                                required: ["query"]
                            }
                        },
                        {
                            name: "search_bing",
                            description: "Search Bing and return results",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    query: {
                                        type: "string",
                                        description: "Search query"
                                    },
                                    pages: {
                                        type: "number",
                                        description: "Number of pages to scrape (1-10)",
                                        minimum: 1,
                                        maximum: 10
                                    },
                                    language: {
                                        type: "string",
                                        description: "Search language (default: en)"
                                    },
                                    result_type: {
                                        type: "string",
                                        enum: ["organic", "ads", "all"],
                                        description: "Type of results to return"
                                    }
                                },
                                required: ["query"]
                            }
                        },
                        {
                            name: "scrape_yellow_pages",
                            description: "Scrape yellow pages for business listings",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    query: {
                                        type: "string",
                                        description: "Search query for businesses"
                                    },
                                    location: {
                                        type: "string",
                                        description: "Location to search in (city, state, or coordinates)"
                                    },
                                    platform: {
                                        type: "string",
                                        enum: ["yelp", "yellowpages", "google_business"],
                                        description: "Platform to search on"
                                    },
                                    maxResults: {
                                        type: "number",
                                        description: "Maximum number of results to return (1-100)",
                                        minimum: 1,
                                        maximum: 100
                                    },
                                    radius: {
                                        type: "number",
                                        description: "Search radius in miles (1-100)",
                                        minimum: 1,
                                        maximum: 100
                                    },
                                    sortBy: {
                                        type: "string",
                                        enum: ["relevance", "distance", "rating"],
                                        description: "How to sort the results"
                                    }
                                },
                                required: ["query", "location", "platform"]
                            }
                        },
                        {
                            name: "get_business_details",
                            description: "Get detailed information about a specific business",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    businessId: {
                                        type: "string",
                                        description: "Business ID to get details for"
                                    },
                                    businessUrl: {
                                        type: "string",
                                        description: "Business URL to get details for"
                                    },
                                    platform: {
                                        type: "string",
                                        enum: ["yelp", "yellowpages", "google_business"],
                                        description: "Platform the business is on"
                                    }
                                },
                                required: ["platform"]
                            }
                        },
                        {
                            name: "extract_emails_from_website",
                            description: "Extract email addresses from a list of websites",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    websites: {
                                        type: "array",
                                        items: { type: "string" },
                                        description: "Array of website URLs to extract emails from"
                                    },
                                    maxDepth: {
                                        type: "number",
                                        description: "Maximum depth to crawl (1-5)",
                                        minimum: 1,
                                        maximum: 5
                                    },
                                    includeSubdomains: {
                                        type: "boolean",
                                        description: "Whether to include subdomains in crawling"
                                    },
                                    excludePatterns: {
                                        type: "array",
                                        items: { type: "string" },
                                        description: "URL patterns to exclude from crawling"
                                    },
                                    timeout: {
                                        type: "number",
                                        description: "Timeout in milliseconds (1000-30000)",
                                        minimum: 1000,
                                        maximum: 30000
                                    }
                                },
                                required: ["websites"]
                            }
                        },
                        {
                            name: "validate_email_list",
                            description: "Validate a list of email addresses for validity and check against disposable email services",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    emails: {
                                        type: "array",
                                        items: { type: "string" },
                                        description: "Array of email addresses to validate"
                                    },
                                    checkDisposable: {
                                        type: "boolean",
                                        description: "Whether to check against disposable email services"
                                    },
                                    checkMX: {
                                        type: "boolean",
                                        description: "Whether to check MX records"
                                    },
                                    checkSMTP: {
                                        type: "boolean",
                                        description: "Whether to check SMTP connectivity"
                                    }
                                },
                                required: ["emails"]
                            }
                        },
                        {
                            name: "create_email_task",
                            description: "Create a new email marketing task",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    name: {
                                        type: "string",
                                        description: "Task name"
                                    },
                                    description: {
                                        type: "string",
                                        description: "Task description"
                                    },
                                    type: {
                                        type: "string",
                                        enum: ["email_campaign", "email_sequence", "email_blast", "email_newsletter"],
                                        description: "Type of email marketing task"
                                    },
                                    priority: {
                                        type: "string",
                                        enum: ["low", "medium", "high"],
                                        description: "Task priority"
                                    },
                                    scheduledAt: {
                                        type: "string",
                                        description: "Scheduled execution time (ISO datetime)"
                                    },
                                    targetAudience: {
                                        type: "string",
                                        description: "Target audience for the email"
                                    },
                                    subjectLine: {
                                        type: "string",
                                        description: "Email subject line"
                                    },
                                    templateId: {
                                        type: "string",
                                        description: "Email template ID"
                                    }
                                },
                                required: ["name", "type"]
                            }
                        },
                        {
                            name: "get_email_task",
                            description: "Get email marketing task details by ID",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    taskId: {
                                        type: "string",
                                        description: "Task ID to retrieve"
                                    }
                                },
                                required: ["taskId"]
                            }
                        },
                        {
                            name: "update_email_task",
                            description: "Update an existing email marketing task",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    taskId: {
                                        type: "string",
                                        description: "Task ID to update"
                                    },
                                    name: {
                                        type: "string",
                                        description: "Updated task name"
                                    },
                                    description: {
                                        type: "string",
                                        description: "Updated task description"
                                    },
                                    status: {
                                        type: "string",
                                        enum: ["pending", "running", "completed", "failed", "cancelled"],
                                        description: "Updated task status"
                                    },
                                    priority: {
                                        type: "string",
                                        enum: ["low", "medium", "high"],
                                        description: "Updated task priority"
                                    },
                                    scheduledAt: {
                                        type: "string",
                                        description: "Updated scheduled execution time"
                                    },
                                    targetAudience: {
                                        type: "string",
                                        description: "Updated target audience"
                                    },
                                    subjectLine: {
                                        type: "string",
                                        description: "Updated subject line"
                                    },
                                    templateId: {
                                        type: "string",
                                        description: "Updated template ID"
                                    }
                                },
                                required: ["taskId"]
                            }
                        },
                        {
                            name: "delete_email_task",
                            description: "Delete an email marketing task",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    taskId: {
                                        type: "string",
                                        description: "Task ID to delete"
                                    }
                                },
                                required: ["taskId"]
                            }
                        },
                        {
                            name: "list_email_tasks",
                            description: "List email marketing tasks with filtering and pagination",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    page: {
                                        type: "number",
                                        description: "Page number for pagination"
                                    },
                                    size: {
                                        type: "number",
                                        description: "Number of tasks per page"
                                    },
                                    sortBy: {
                                        type: "string",
                                        description: "Field to sort by"
                                    },
                                    sortOrder: {
                                        type: "string",
                                        enum: ["asc", "desc"],
                                        description: "Sort order"
                                    },
                                    status: {
                                        type: "string",
                                        enum: ["pending", "running", "completed", "failed", "cancelled"],
                                        description: "Filter by task status"
                                    },
                                    priority: {
                                        type: "string",
                                        enum: ["low", "medium", "high"],
                                        description: "Filter by task priority"
                                    },
                                    type: {
                                        type: "string",
                                        enum: ["email_campaign", "email_sequence", "email_blast", "email_newsletter"],
                                        description: "Filter by task type"
                                    }
                                }
                            }
                        }
                    ]
                });
            } else if (request.method === 'tools/call') {
                const toolName = request.params?.name;
                const startTime = Date.now();
                
                // Check login state for protected tools
                if (!this.validateLoginState()) {
                    auditLogger.logAuthFailure(request, 'User not logged in');
                    this.sendError(request.id, -32001, 'USER_NOT_LOGGED_IN');
                    return;
                }
                
                // Check rate limiting
                const rateLimitResult = checkRateLimit(request, toolName);
                if (!rateLimitResult.allowed) {
                    auditLogger.logRateLimitExceeded(request, toolName, rateLimitResult.error);
                    this.sendError(request.id, -32002, 'RATE_LIMIT_EXCEEDED', rateLimitResult.error);
                    return;
                }
                
                if (toolName === 'get_system_status') {
                    this.executeToolWithAudit(request, toolName, startTime, async () => {
                        this.sendResponse(request.id, {
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    data: {
                                        timestamp: new Date().toISOString(),
                                        status: 'healthy',
                                        version: '1.0.0',
                                        uptime: process.uptime(),
                                        memory: process.memoryUsage(),
                                        platform: process.platform,
                                        node_version: process.version
                                    }
                                })
                            }]
                        });
                    });
                } else if (toolName === 'test_connection') {
                    this.sendResponse(request.id, {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                data: {
                                    message: request.params?.arguments?.message || "Hello from MCP Server",
                                    timestamp: new Date().toISOString(),
                                    server: "AiFetchly MCP Server"
                                }
                            })
                        }]
                    });
                } else if (toolName === 'search_google') {
                    this.handleGoogleSearch(request);
                } else if (toolName === 'search_bing') {
                    this.handleBingSearch(request);
                } else if (toolName === 'scrape_yellow_pages') {
                    this.handleScrapeYellowPages(request);
                } else if (toolName === 'get_business_details') {
                    this.handleGetBusinessDetails(request);
                } else if (toolName === 'extract_emails_from_website') {
                    this.handleExtractEmailsFromWebsite(request);
                } else if (toolName === 'validate_email_list') {
                    this.handleValidateEmailList(request);
                } else if (toolName === 'create_email_task') {
                    this.handleCreateEmailTask(request);
                } else if (toolName === 'get_email_task') {
                    this.handleGetEmailTask(request);
                } else if (toolName === 'update_email_task') {
                    this.handleUpdateEmailTask(request);
                } else if (toolName === 'delete_email_task') {
                    this.handleDeleteEmailTask(request);
                } else if (toolName === 'list_email_tasks') {
                    this.handleListEmailTasks(request);
                } else {
                    this.sendError(request.id, -32601, `Unknown tool: ${toolName}`);
                }
            } else if (request.type === 'loginStateChange') {
                this.handleLoginStateChange(request);
            } else {
                this.sendError(request.id, -32601, `Unknown method: ${request.method}`);
            }
        } catch (error) {
            console.error('Error handling request:', error);
            this.sendError(null, -32700, 'Parse error');
        }
    }
    
    private sendResponse(id: any, result: any) {
        const response = {
            jsonrpc: "2.0",
            id,
            result
        };
        stdout.write(JSON.stringify(response) + '\n');
    }
    
    private handleLoginStateChange(request: any) {
        console.log('Login state changed:', request.data);
        this.loginState = request.data;
    }
    
    private validateLoginState(): boolean {
        return this.loginState?.isLoggedIn === true;
    }
    
    private async handleGoogleSearch(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = GoogleSearchSchema.parse(params);
            
            // For now, return mock data since we don't have the actual search implementation
            // In a real implementation, this would call the aiFetchlyController
            const mockData = {
                success: true,
                data: {
                    total_results: 1000,
                    results: [
                        {
                            title: `Search results for: ${validatedParams.query}`,
                            url: 'https://example.com/result1',
                            description: 'This is a mock search result for testing purposes.',
                            position: 1,
                            domain: 'example.com',
                            type: 'organic'
                        },
                        {
                            title: `Another result for: ${validatedParams.query}`,
                            url: 'https://example.com/result2',
                            description: 'Another mock search result.',
                            position: 2,
                            domain: 'example.com',
                            type: 'organic'
                        }
                    ],
                    related_searches: [
                        `${validatedParams.query} tutorial`,
                        `${validatedParams.query} guide`,
                        `${validatedParams.query} examples`
                    ]
                }
            };
            
            const formattedResponse = SearchResponseFormatter.formatGoogleResponse(
                mockData,
                validatedParams.query,
                100 // Mock processing time
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling Google search:', error);
            const errorResponse = SearchResponseFormatter.createErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private async handleBingSearch(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = BingSearchSchema.parse(params);
            
            // For now, return mock data since we don't have the actual search implementation
            // In a real implementation, this would call the aiFetchlyController
            const mockData = {
                success: true,
                data: {
                    total_results: 500,
                    results: [
                        {
                            title: `Bing search results for: ${validatedParams.query}`,
                            url: 'https://bing-example.com/result1',
                            description: 'This is a mock Bing search result for testing purposes.',
                            position: 1,
                            domain: 'bing-example.com',
                            type: 'organic'
                        },
                        {
                            title: `Another Bing result for: ${validatedParams.query}`,
                            url: 'https://bing-example.com/result2',
                            description: 'Another mock Bing search result.',
                            position: 2,
                            domain: 'bing-example.com',
                            type: 'organic'
                        }
                    ],
                    related_searches: [
                        `${validatedParams.query} bing search`,
                        `${validatedParams.query} microsoft`,
                        `${validatedParams.query} bing results`
                    ]
                }
            };
            
            const formattedResponse = SearchResponseFormatter.formatBingResponse(
                mockData,
                validatedParams.query,
                150 // Mock processing time
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling Bing search:', error);
            const errorResponse = SearchResponseFormatter.createErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private async handleScrapeYellowPages(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = YellowPagesSearchSchema.parse(params);
            
            // For now, return mock data since we don't have the actual yellow pages implementation
            // In a real implementation, this would call the YellowPagesController
            const mockData = {
                success: true,
                message: 'Yellow pages search completed successfully',
                data: {
                    businesses: [
                        {
                            name: `Mock Business 1 for ${validatedParams.query}`,
                            address: `123 Main St, ${validatedParams.location}`,
                            phone: '(555) 123-4567',
                            website: 'https://example-business1.com',
                            email: 'contact@example-business1.com',
                            rating: 4.5,
                            reviewCount: 25,
                            categories: ['Restaurant', 'Food'],
                            hours: {
                                'Monday': '9:00 AM - 9:00 PM',
                                'Tuesday': '9:00 AM - 9:00 PM',
                                'Wednesday': '9:00 AM - 9:00 PM',
                                'Thursday': '9:00 AM - 9:00 PM',
                                'Friday': '9:00 AM - 10:00 PM',
                                'Saturday': '10:00 AM - 10:00 PM',
                                'Sunday': '10:00 AM - 8:00 PM'
                            },
                            coordinates: {
                                latitude: 40.7128,
                                longitude: -74.0060
                            },
                            platform: validatedParams.platform,
                            listingUrl: `https://${validatedParams.platform}.com/business1`
                        },
                        {
                            name: `Mock Business 2 for ${validatedParams.query}`,
                            address: `456 Oak Ave, ${validatedParams.location}`,
                            phone: '(555) 987-6543',
                            website: 'https://example-business2.com',
                            email: 'info@example-business2.com',
                            rating: 4.2,
                            reviewCount: 18,
                            categories: ['Service', 'Professional'],
                            hours: {
                                'Monday': '8:00 AM - 6:00 PM',
                                'Tuesday': '8:00 AM - 6:00 PM',
                                'Wednesday': '8:00 AM - 6:00 PM',
                                'Thursday': '8:00 AM - 6:00 PM',
                                'Friday': '8:00 AM - 5:00 PM',
                                'Saturday': 'Closed',
                                'Sunday': 'Closed'
                            },
                            coordinates: {
                                latitude: 40.7589,
                                longitude: -73.9851
                            },
                            platform: validatedParams.platform,
                            listingUrl: `https://${validatedParams.platform}.com/business2`
                        }
                    ],
                    totalFound: 2,
                    platform: validatedParams.platform,
                    location: validatedParams.location,
                    searchQuery: validatedParams.query,
                    processingTime: 0
                },
                timestamp: new Date().toISOString()
            };
            
            const formattedResponse = YellowPagesResponseFormatter.formatYellowPagesResponse(
                mockData,
                validatedParams.query,
                validatedParams.location,
                validatedParams.platform,
                200 // Mock processing time
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling Yellow Pages search:', error);
            const errorResponse = YellowPagesResponseFormatter.createYellowPagesErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private async handleGetBusinessDetails(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = BusinessDetailsSchema.parse(params);
            
            // For now, return mock data since we don't have the actual business details implementation
            // In a real implementation, this would call the YellowPagesController
            const mockData = {
                success: true,
                message: 'Business details retrieved successfully',
                data: {
                    name: `Mock Business Details for ${validatedParams.businessId || 'URL'}`,
                    address: '123 Business St, City, State 12345',
                    phone: '(555) 123-4567',
                    website: 'https://example-business.com',
                    email: 'contact@example-business.com',
                    rating: 4.7,
                    reviewCount: 42,
                    categories: ['Professional Services', 'Consulting'],
                    hours: {
                        'Monday': '9:00 AM - 6:00 PM',
                        'Tuesday': '9:00 AM - 6:00 PM',
                        'Wednesday': '9:00 AM - 6:00 PM',
                        'Thursday': '9:00 AM - 6:00 PM',
                        'Friday': '9:00 AM - 5:00 PM',
                        'Saturday': '10:00 AM - 4:00 PM',
                        'Sunday': 'Closed'
                    },
                    coordinates: {
                        latitude: 40.7128,
                        longitude: -74.0060
                    },
                    platform: validatedParams.platform,
                    listingUrl: `https://${validatedParams.platform}.com/business/${validatedParams.businessId || 'url'}`
                },
                timestamp: new Date().toISOString()
            };
            
            const formattedResponse = YellowPagesResponseFormatter.formatBusinessDetailsResponse(
                mockData,
                validatedParams.businessId,
                validatedParams.businessUrl
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling business details:', error);
            const errorResponse = YellowPagesResponseFormatter.createBusinessDetailsErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private async handleExtractEmailsFromWebsite(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = EmailExtractionSchema.parse(params);
            
            // For now, return mock data since we don't have the actual email extraction implementation
            // In a real implementation, this would call the EmailExtractionController
            const mockData = {
                success: true,
                message: 'Email extraction completed successfully',
                data: {
                    emails: [
                        {
                            email: 'contact@example1.com',
                            website: validatedParams.websites[0],
                            context: 'Found in contact page footer',
                            confidence: 0.95,
                            source: 'footer',
                            foundAt: new Date().toISOString(),
                            pageTitle: 'Contact Us - Example1',
                            pageUrl: validatedParams.websites[0] + '/contact'
                        },
                        {
                            email: 'info@example1.com',
                            website: validatedParams.websites[0],
                            context: 'Found in about page',
                            confidence: 0.88,
                            source: 'about_page',
                            foundAt: new Date().toISOString(),
                            pageTitle: 'About Us - Example1',
                            pageUrl: validatedParams.websites[0] + '/about'
                        },
                        {
                            email: 'support@example2.com',
                            website: validatedParams.websites[1] || validatedParams.websites[0],
                            context: 'Found in support section',
                            confidence: 0.92,
                            source: 'page_content',
                            foundAt: new Date().toISOString(),
                            pageTitle: 'Support - Example2',
                            pageUrl: (validatedParams.websites[1] || validatedParams.websites[0]) + '/support'
                        }
                    ],
                    totalFound: 3,
                    processedWebsites: validatedParams.websites.length,
                    failedWebsites: [],
                    processingTime: 0,
                    totalPages: 5,
                    successfulExtractions: 3,
                    failedExtractions: 0
                },
                timestamp: new Date().toISOString()
            };
            
            const formattedResponse = EmailExtractionResponseFormatter.formatEmailExtractionResponse(
                mockData,
                validatedParams.websites,
                1500 // Mock processing time
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling email extraction:', error);
            const errorResponse = EmailExtractionResponseFormatter.createEmailExtractionErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private async handleValidateEmailList(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = EmailValidationSchema.parse(params);
            
            // For now, return mock data since we don't have the actual email validation implementation
            // In a real implementation, this would call the EmailValidationController
            const mockData = {
                success: true,
                message: 'Email validation completed successfully',
                data: {
                    results: validatedParams.emails.map((email, index) => ({
                        email: email,
                        isValid: index % 3 !== 2, // Mock: every 3rd email is invalid
                        isDisposable: email.includes('temp') || email.includes('disposable'),
                        isMXValid: index % 4 !== 3, // Mock: every 4th email has invalid MX
                        isSMTPValid: index % 5 !== 4, // Mock: every 5th email has SMTP issues
                        confidence: 0.7 + (Math.random() * 0.3), // Random confidence between 0.7-1.0
                        reasons: index % 3 === 2 ? ['Invalid email format'] : undefined,
                        suggestedCorrection: index % 3 === 2 ? email.replace('@', '@gmail.com') : undefined
                    })),
                    validEmails: Math.floor(validatedParams.emails.length * 0.7),
                    invalidEmails: Math.floor(validatedParams.emails.length * 0.2),
                    disposableEmails: Math.floor(validatedParams.emails.length * 0.1),
                    processingTime: 0
                },
                timestamp: new Date().toISOString()
            };
            
            const formattedResponse = EmailExtractionResponseFormatter.formatEmailValidationResponse(
                mockData,
                validatedParams.emails,
                800 // Mock processing time
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling email validation:', error);
            const errorResponse = EmailExtractionResponseFormatter.createEmailValidationErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private async handleCreateEmailTask(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = CreateEmailTaskSchema.parse(params);
            
            // For now, return mock data since we don't have the actual email marketing task implementation
            // In a real implementation, this would call the EmailMarketingController
            const mockData = {
                success: true,
                message: 'Email marketing task created successfully',
                data: {
                    id: `task_${Date.now()}`,
                    name: validatedParams.name,
                    description: validatedParams.description || '',
                    type: validatedParams.type,
                    status: 'pending' as const,
                    priority: validatedParams.priority,
                    parameters: {
                        ...validatedParams.parameters,
                        targetAudience: validatedParams.targetAudience,
                        subjectLine: validatedParams.subjectLine,
                        templateId: validatedParams.templateId
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    scheduledAt: validatedParams.scheduledAt,
                    progress: 0
                },
                timestamp: new Date().toISOString()
            };
            
            const formattedResponse = EmailMarketingTaskResponseFormatter.formatEmailMarketingTaskResponse(
                mockData,
                'Email marketing task created successfully'
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling create email task:', error);
            const errorResponse = EmailMarketingTaskResponseFormatter.createEmailMarketingTaskErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private async handleGetEmailTask(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = GetEmailTaskSchema.parse(params);
            
            // For now, return mock data since we don't have the actual email marketing task implementation
            // In a real implementation, this would call the EmailMarketingController
            const mockData = {
                success: true,
                message: 'Email marketing task retrieved successfully',
                data: {
                    id: validatedParams.taskId,
                    name: `Mock Email Task ${validatedParams.taskId}`,
                    description: 'This is a mock email marketing task',
                    type: 'email_campaign',
                    status: 'pending' as const,
                    priority: 'medium' as const,
                    parameters: {
                        targetAudience: 'All subscribers',
                        subjectLine: 'Welcome to our newsletter',
                        templateId: 'template_123'
                    },
                    createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
                    updatedAt: new Date().toISOString(),
                    progress: 0
                },
                timestamp: new Date().toISOString()
            };
            
            const formattedResponse = EmailMarketingTaskResponseFormatter.formatEmailMarketingTaskResponse(
                mockData,
                'Email marketing task retrieved successfully'
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling get email task:', error);
            const errorResponse = EmailMarketingTaskResponseFormatter.createEmailMarketingTaskErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private async handleUpdateEmailTask(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = UpdateEmailTaskSchema.parse(params);
            
            // For now, return mock data since we don't have the actual email marketing task implementation
            // In a real implementation, this would call the EmailMarketingController
            const mockData = {
                success: true,
                message: 'Email marketing task updated successfully',
                data: {
                    id: validatedParams.taskId,
                    name: validatedParams.name || `Updated Email Task ${validatedParams.taskId}`,
                    description: validatedParams.description || 'Updated description',
                    type: 'email_campaign',
                    status: (validatedParams.status || 'pending') as 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
                    priority: (validatedParams.priority || 'medium') as 'low' | 'medium' | 'high',
                    parameters: {
                        targetAudience: validatedParams.targetAudience || 'All subscribers',
                        subjectLine: validatedParams.subjectLine || 'Updated subject line',
                        templateId: validatedParams.templateId || 'template_123'
                    },
                    createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
                    updatedAt: new Date().toISOString(),
                    scheduledAt: validatedParams.scheduledAt,
                    progress: 0
                },
                timestamp: new Date().toISOString()
            };
            
            const formattedResponse = EmailMarketingTaskResponseFormatter.formatEmailMarketingTaskResponse(
                mockData,
                'Email marketing task updated successfully'
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling update email task:', error);
            const errorResponse = EmailMarketingTaskResponseFormatter.createEmailMarketingTaskErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private async handleDeleteEmailTask(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = DeleteEmailTaskSchema.parse(params);
            
            // For now, return mock data since we don't have the actual email marketing task implementation
            // In a real implementation, this would call the EmailMarketingController
            const mockData = {
                success: true,
                message: 'Email marketing task deleted successfully',
                data: {
                    id: validatedParams.taskId,
                    name: `Deleted Email Task ${validatedParams.taskId}`,
                    description: 'This task has been deleted',
                    type: 'email_campaign',
                    status: 'cancelled' as const,
                    priority: 'medium' as const,
                    parameters: {},
                    createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
                    updatedAt: new Date().toISOString(),
                    progress: 0
                },
                timestamp: new Date().toISOString()
            };
            
            const formattedResponse = EmailMarketingTaskResponseFormatter.formatEmailMarketingTaskResponse(
                mockData,
                'Email marketing task deleted successfully'
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling delete email task:', error);
            const errorResponse = EmailMarketingTaskResponseFormatter.createEmailMarketingTaskErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private async handleListEmailTasks(request: any): Promise<void> {
        try {
            const params = request.params?.arguments || {};
            const validatedParams = ListEmailTasksSchema.parse(params);
            
            // For now, return mock data since we don't have the actual email marketing task implementation
            // In a real implementation, this would call the EmailMarketingController
            const mockTasks = Array.from({ length: Math.min(validatedParams.size, 5) }, (_, index) => ({
                id: `task_${Date.now()}_${index}`,
                name: `Mock Email Task ${index + 1}`,
                description: `Description for task ${index + 1}`,
                type: ['email_campaign', 'email_sequence', 'email_blast', 'email_newsletter'][index % 4],
                status: ['pending', 'running', 'completed', 'failed'][index % 4],
                priority: ['low', 'medium', 'high'][index % 3],
                parameters: {
                    targetAudience: `Audience ${index + 1}`,
                    subjectLine: `Subject ${index + 1}`,
                    templateId: `template_${index + 1}`
                },
                createdAt: new Date(Date.now() - (index * 3600000)).toISOString(), // Each task 1 hour older
                updatedAt: new Date().toISOString(),
                progress: Math.floor(Math.random() * 100)
            }));
            
            const mockData = {
                success: true,
                message: 'Email marketing tasks retrieved successfully',
                data: {
                    tasks: mockTasks,
                    pagination: {
                        page: validatedParams.page,
                        size: validatedParams.size,
                        total: 25, // Mock total
                        totalPages: Math.ceil(25 / validatedParams.size)
                    }
                },
                timestamp: new Date().toISOString()
            };
            
            const formattedResponse = EmailMarketingTaskResponseFormatter.formatEmailMarketingTaskListResponse(
                mockData,
                'Email marketing tasks retrieved successfully'
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(formattedResponse)
                }]
            });
        } catch (error) {
            console.error('Error handling list email tasks:', error);
            const errorResponse = EmailMarketingTaskResponseFormatter.createEmailMarketingTaskListErrorResponse(
                `Invalid parameters: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            this.sendResponse(request.id, {
                content: [{
                    type: "text",
                    text: JSON.stringify(errorResponse)
                }]
            });
        }
    }
    
    private sendError(id: any, code: number, message: string, data?: any) {
        const response = {
            jsonrpc: "2.0",
            id,
            error: {
                code,
                message,
                ...(data && { data })
            }
        };
        stdout.write(JSON.stringify(response) + '\n');
    }

    private async executeToolWithAudit(request: any, toolName: string, startTime: number, toolHandler: () => Promise<void>): Promise<void> {
        try {
            await toolHandler();
            // Log successful execution
            auditLogger.logToolCall(request, toolName, startTime, { success: true });
        } catch (error) {
            // Log error
            auditLogger.logToolCall(request, toolName, startTime, undefined, error);
            throw error;
        }
    }
    
    public start() {
        this.isRunning = true;
        console.error('Basic MCP Server started successfully');
    }
}

// Start the server
const server = new BasicMCPServer();
server.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.error('Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.error('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});
