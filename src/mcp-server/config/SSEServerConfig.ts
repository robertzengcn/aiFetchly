/**
 * MCP SSE Server Configuration
 * 
 * Manages configuration options for the MCP server when using SSEServerTransport.
 * Provides default values and validation for server settings.
 */
export interface SSEServerConfigOptions {
    port: number;
    sseEndpoint: string;
    messagesEndpoint: string;
    corsEnabled: boolean;
    corsOrigins: string[];
    sessionTimeout: number;
    maxConnections: number;
    enableLogging: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    enableHealthCheck: boolean;
    healthCheckEndpoint: string;
    enableServerInfo: boolean;
    serverInfoEndpoint: string;
}

/**
 * Default configuration values for MCP SSE Server
 */
export const DEFAULT_SSE_SERVER_CONFIG: SSEServerConfigOptions = {
    port: 3000,
    sseEndpoint: '/sse',
    messagesEndpoint: '/messages',
    corsEnabled: true,
    corsOrigins: ['*'],
    sessionTimeout: 300000, // 5 minutes
    maxConnections: 100,
    enableLogging: true,
    logLevel: 'info',
    enableHealthCheck: true,
    healthCheckEndpoint: '/health',
    enableServerInfo: true,
    serverInfoEndpoint: '/info'
};

/**
 * MCP SSE Server Configuration Manager
 */
export class SSEServerConfig {
    private config: SSEServerConfigOptions;

    constructor(options: Partial<SSEServerConfigOptions> = {}) {
        this.config = { ...DEFAULT_SSE_SERVER_CONFIG, ...options };
        this.validateConfig();
    }

    /**
     * Validate configuration options
     */
    private validateConfig(): void {
        if (this.config.port < 1 || this.config.port > 65535) {
            throw new Error('Port must be between 1 and 65535');
        }

        if (!this.config.sseEndpoint.startsWith('/')) {
            throw new Error('SSE endpoint must start with "/"');
        }

        if (!this.config.messagesEndpoint.startsWith('/')) {
            throw new Error('Messages endpoint must start with "/"');
        }

        if (this.config.sessionTimeout < 1000) {
            throw new Error('Session timeout must be at least 1000ms');
        }

        if (this.config.maxConnections < 1) {
            throw new Error('Max connections must be at least 1');
        }

        const validLogLevels = ['debug', 'info', 'warn', 'error'];
        if (!validLogLevels.includes(this.config.logLevel)) {
            throw new Error(`Log level must be one of: ${validLogLevels.join(', ')}`);
        }
    }

    /**
     * Get the current configuration
     */
    public getConfig(): SSEServerConfigOptions {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    public updateConfig(updates: Partial<SSEServerConfigOptions>): void {
        this.config = { ...this.config, ...updates };
        this.validateConfig();
    }

    /**
     * Get port number
     */
    public getPort(): number {
        return this.config.port;
    }

    /**
     * Get SSE endpoint
     */
    public getSSEEndpoint(): string {
        return this.config.sseEndpoint;
    }

    /**
     * Get messages endpoint
     */
    public getMessagesEndpoint(): string {
        return this.config.messagesEndpoint;
    }

    /**
     * Check if CORS is enabled
     */
    public isCORSEnabled(): boolean {
        return this.config.corsEnabled;
    }

    /**
     * Get CORS origins
     */
    public getCORSOrigins(): string[] {
        return [...this.config.corsOrigins];
    }

    /**
     * Get session timeout in milliseconds
     */
    public getSessionTimeout(): number {
        return this.config.sessionTimeout;
    }

    /**
     * Get maximum connections
     */
    public getMaxConnections(): number {
        return this.config.maxConnections;
    }

    /**
     * Check if logging is enabled
     */
    public isLoggingEnabled(): boolean {
        return this.config.enableLogging;
    }

    /**
     * Get log level
     */
    public getLogLevel(): string {
        return this.config.logLevel;
    }

    /**
     * Check if health check is enabled
     */
    public isHealthCheckEnabled(): boolean {
        return this.config.enableHealthCheck;
    }

    /**
     * Get health check endpoint
     */
    public getHealthCheckEndpoint(): string {
        return this.config.healthCheckEndpoint;
    }

    /**
     * Check if server info is enabled
     */
    public isServerInfoEnabled(): boolean {
        return this.config.enableServerInfo;
    }

    /**
     * Get server info endpoint
     */
    public getServerInfoEndpoint(): string {
        return this.config.serverInfoEndpoint;
    }

    /**
     * Create configuration from environment variables
     */
    public static fromEnvironment(): SSEServerConfig {
        const envConfig: Partial<SSEServerConfigOptions> = {};

        if (process.env.MCP_SSE_PORT) {
            envConfig.port = parseInt(process.env.MCP_SSE_PORT, 10);
        }

        if (process.env.MCP_SSE_ENDPOINT) {
            envConfig.sseEndpoint = process.env.MCP_SSE_ENDPOINT;
        }

        if (process.env.MCP_MESSAGES_ENDPOINT) {
            envConfig.messagesEndpoint = process.env.MCP_MESSAGES_ENDPOINT;
        }

        if (process.env.MCP_CORS_ENABLED) {
            envConfig.corsEnabled = process.env.MCP_CORS_ENABLED.toLowerCase() === 'true';
        }

        if (process.env.MCP_CORS_ORIGINS) {
            envConfig.corsOrigins = process.env.MCP_CORS_ORIGINS.split(',').map(origin => origin.trim());
        }

        if (process.env.MCP_SESSION_TIMEOUT) {
            envConfig.sessionTimeout = parseInt(process.env.MCP_SESSION_TIMEOUT, 10);
        }

        if (process.env.MCP_MAX_CONNECTIONS) {
            envConfig.maxConnections = parseInt(process.env.MCP_MAX_CONNECTIONS, 10);
        }

        if (process.env.MCP_ENABLE_LOGGING) {
            envConfig.enableLogging = process.env.MCP_ENABLE_LOGGING.toLowerCase() === 'true';
        }

        if (process.env.MCP_LOG_LEVEL) {
            envConfig.logLevel = process.env.MCP_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error';
        }

        return new SSEServerConfig(envConfig);
    }

    /**
     * Create configuration from JSON object
     */
    public static fromJSON(json: Partial<SSEServerConfigOptions>): SSEServerConfig {
        return new SSEServerConfig(json);
    }

    /**
     * Convert configuration to JSON
     */
    public toJSON(): SSEServerConfigOptions {
        return this.getConfig();
    }

    /**
     * Get configuration summary for logging
     */
    public getSummary(): string {
        return `MCP SSE Server Config: Port=${this.config.port}, SSE=${this.config.sseEndpoint}, Messages=${this.config.messagesEndpoint}, CORS=${this.config.corsEnabled}, MaxConnections=${this.config.maxConnections}`;
    }
}

