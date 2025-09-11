/**
 * Streamable HTTP Server Configuration
 * 
 * Manages configuration options for the MCP server when using StreamableHttpTransport.
 * Provides default values and validation for streaming server settings.
 */
export interface StreamableHttpConfigOptions {
  port: number;
  streamEndpoint: string;
  requestEndpoint: string;
  chunkSize: number;
  compression: boolean;
  maxConcurrentStreams: number;
  streamTimeout: number;
  bufferSize: number;
  enableProgress: boolean;
  corsEnabled: boolean;
  corsOrigins: string[];
  enableLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableHealthCheck: boolean;
  healthCheckEndpoint: string;
  enableServerInfo: boolean;
  serverInfoEndpoint: string;
  chunkedTransfer: boolean;
  compressionLevel: number;
  maxChunkSize: number;
  minChunkSize: number;
  enableMetrics: boolean;
  metricsEndpoint: string;
}

/**
 * Default configuration values for Streamable HTTP Server
 */
export const DEFAULT_STREAMABLE_HTTP_CONFIG: StreamableHttpConfigOptions = {
  port: 3000,
  streamEndpoint: '/stream',
  requestEndpoint: '/stream/request',
  chunkSize: 8192,
  compression: true,
  maxConcurrentStreams: 100,
  streamTimeout: 300000, // 5 minutes
  bufferSize: 65536,
  enableProgress: true,
  corsEnabled: true,
  corsOrigins: ['*'],
  enableLogging: true,
  logLevel: 'info',
  enableHealthCheck: true,
  healthCheckEndpoint: '/health',
  enableServerInfo: true,
  serverInfoEndpoint: '/info',
  chunkedTransfer: true,
  compressionLevel: 6,
  maxChunkSize: 16384,
  minChunkSize: 1024,
  enableMetrics: true,
  metricsEndpoint: '/metrics'
};

/**
 * Streamable HTTP Server Configuration Manager
 */
export class StreamableHttpConfig {
  private config: StreamableHttpConfigOptions;

  constructor(options: Partial<StreamableHttpConfigOptions> = {}) {
    this.config = { ...DEFAULT_STREAMABLE_HTTP_CONFIG, ...options };
    this.validateConfig();
  }

  /**
   * Validate configuration options
   */
  private validateConfig(): void {
    if (this.config.port < 1 || this.config.port > 65535) {
      throw new Error('Port must be between 1 and 65535');
    }

    if (!this.config.streamEndpoint.startsWith('/')) {
      throw new Error('Stream endpoint must start with "/"');
    }

    if (!this.config.requestEndpoint.startsWith('/')) {
      throw new Error('Request endpoint must start with "/"');
    }

    if (this.config.chunkSize < 1024 || this.config.chunkSize > 65536) {
      throw new Error('Chunk size must be between 1024 and 65536 bytes');
    }

    if (this.config.maxConcurrentStreams < 1 || this.config.maxConcurrentStreams > 1000) {
      throw new Error('Max concurrent streams must be between 1 and 1000');
    }

    if (this.config.streamTimeout < 1000) {
      throw new Error('Stream timeout must be at least 1000ms');
    }

    if (this.config.bufferSize < 4096 || this.config.bufferSize > 1048576) {
      throw new Error('Buffer size must be between 4096 and 1048576 bytes');
    }

    if (this.config.compressionLevel < 1 || this.config.compressionLevel > 9) {
      throw new Error('Compression level must be between 1 and 9');
    }

    if (this.config.maxChunkSize < this.config.minChunkSize) {
      throw new Error('Max chunk size must be greater than or equal to min chunk size');
    }

    const validLogLevels = ['debug', 'info', 'warn', 'error'];
    if (!validLogLevels.includes(this.config.logLevel)) {
      throw new Error(`Log level must be one of: ${validLogLevels.join(', ')}`);
    }
  }

  /**
   * Get the current configuration
   */
  public getConfig(): StreamableHttpConfigOptions {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<StreamableHttpConfigOptions>): void {
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
   * Get stream endpoint
   */
  public getStreamEndpoint(): string {
    return this.config.streamEndpoint;
  }

  /**
   * Get request endpoint
   */
  public getRequestEndpoint(): string {
    return this.config.requestEndpoint;
  }

  /**
   * Get chunk size
   */
  public getChunkSize(): number {
    return this.config.chunkSize;
  }

  /**
   * Check if compression is enabled
   */
  public isCompressionEnabled(): boolean {
    return this.config.compression;
  }

  /**
   * Get compression level
   */
  public getCompressionLevel(): number {
    return this.config.compressionLevel;
  }

  /**
   * Get maximum concurrent streams
   */
  public getMaxConcurrentStreams(): number {
    return this.config.maxConcurrentStreams;
  }

  /**
   * Get stream timeout in milliseconds
   */
  public getStreamTimeout(): number {
    return this.config.streamTimeout;
  }

  /**
   * Get buffer size
   */
  public getBufferSize(): number {
    return this.config.bufferSize;
  }

  /**
   * Check if progress is enabled
   */
  public isProgressEnabled(): boolean {
    return this.config.enableProgress;
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
   * Check if chunked transfer is enabled
   */
  public isChunkedTransferEnabled(): boolean {
    return this.config.chunkedTransfer;
  }

  /**
   * Get maximum chunk size
   */
  public getMaxChunkSize(): number {
    return this.config.maxChunkSize;
  }

  /**
   * Get minimum chunk size
   */
  public getMinChunkSize(): number {
    return this.config.minChunkSize;
  }

  /**
   * Check if metrics are enabled
   */
  public isMetricsEnabled(): boolean {
    return this.config.enableMetrics;
  }

  /**
   * Get metrics endpoint
   */
  public getMetricsEndpoint(): string {
    return this.config.metricsEndpoint;
  }

  /**
   * Create configuration from environment variables
   */
  public static fromEnvironment(): StreamableHttpConfig {
    const envConfig: Partial<StreamableHttpConfigOptions> = {};

    if (process.env.MCP_HTTP_PORT) {
      envConfig.port = parseInt(process.env.MCP_HTTP_PORT, 10);
    }

    if (process.env.MCP_STREAM_ENDPOINT) {
      envConfig.streamEndpoint = process.env.MCP_STREAM_ENDPOINT;
    }

    if (process.env.MCP_REQUEST_ENDPOINT) {
      envConfig.requestEndpoint = process.env.MCP_REQUEST_ENDPOINT;
    }

    if (process.env.MCP_CHUNK_SIZE) {
      envConfig.chunkSize = parseInt(process.env.MCP_CHUNK_SIZE, 10);
    }

    if (process.env.MCP_COMPRESSION) {
      envConfig.compression = process.env.MCP_COMPRESSION.toLowerCase() === 'true';
    }

    if (process.env.MCP_MAX_CONCURRENT_STREAMS) {
      envConfig.maxConcurrentStreams = parseInt(process.env.MCP_MAX_CONCURRENT_STREAMS, 10);
    }

    if (process.env.MCP_STREAM_TIMEOUT) {
      envConfig.streamTimeout = parseInt(process.env.MCP_STREAM_TIMEOUT, 10);
    }

    if (process.env.MCP_BUFFER_SIZE) {
      envConfig.bufferSize = parseInt(process.env.MCP_BUFFER_SIZE, 10);
    }

    if (process.env.MCP_ENABLE_PROGRESS) {
      envConfig.enableProgress = process.env.MCP_ENABLE_PROGRESS.toLowerCase() === 'true';
    }

    if (process.env.MCP_CORS_ENABLED) {
      envConfig.corsEnabled = process.env.MCP_CORS_ENABLED.toLowerCase() === 'true';
    }

    if (process.env.MCP_CORS_ORIGINS) {
      envConfig.corsOrigins = process.env.MCP_CORS_ORIGINS.split(',').map(origin => origin.trim());
    }

    if (process.env.MCP_ENABLE_LOGGING) {
      envConfig.enableLogging = process.env.MCP_ENABLE_LOGGING.toLowerCase() === 'true';
    }

    if (process.env.MCP_LOG_LEVEL) {
      envConfig.logLevel = process.env.MCP_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error';
    }

    if (process.env.MCP_ENABLE_HEALTH_CHECK) {
      envConfig.enableHealthCheck = process.env.MCP_ENABLE_HEALTH_CHECK.toLowerCase() === 'true';
    }

    if (process.env.MCP_HEALTH_CHECK_ENDPOINT) {
      envConfig.healthCheckEndpoint = process.env.MCP_HEALTH_CHECK_ENDPOINT;
    }

    if (process.env.MCP_ENABLE_SERVER_INFO) {
      envConfig.enableServerInfo = process.env.MCP_ENABLE_SERVER_INFO.toLowerCase() === 'true';
    }

    if (process.env.MCP_SERVER_INFO_ENDPOINT) {
      envConfig.serverInfoEndpoint = process.env.MCP_SERVER_INFO_ENDPOINT;
    }

    if (process.env.MCP_CHUNKED_TRANSFER) {
      envConfig.chunkedTransfer = process.env.MCP_CHUNKED_TRANSFER.toLowerCase() === 'true';
    }

    if (process.env.MCP_COMPRESSION_LEVEL) {
      envConfig.compressionLevel = parseInt(process.env.MCP_COMPRESSION_LEVEL, 10);
    }

    if (process.env.MCP_MAX_CHUNK_SIZE) {
      envConfig.maxChunkSize = parseInt(process.env.MCP_MAX_CHUNK_SIZE, 10);
    }

    if (process.env.MCP_MIN_CHUNK_SIZE) {
      envConfig.minChunkSize = parseInt(process.env.MCP_MIN_CHUNK_SIZE, 10);
    }

    if (process.env.MCP_ENABLE_METRICS) {
      envConfig.enableMetrics = process.env.MCP_ENABLE_METRICS.toLowerCase() === 'true';
    }

    if (process.env.MCP_METRICS_ENDPOINT) {
      envConfig.metricsEndpoint = process.env.MCP_METRICS_ENDPOINT;
    }

    return new StreamableHttpConfig(envConfig);
  }

  /**
   * Create configuration from JSON object
   */
  public static fromJSON(json: Partial<StreamableHttpConfigOptions>): StreamableHttpConfig {
    return new StreamableHttpConfig(json);
  }

  /**
   * Convert configuration to JSON
   */
  public toJSON(): StreamableHttpConfigOptions {
    return this.getConfig();
  }

  /**
   * Get configuration summary for logging
   */
  public getSummary(): string {
    return `Streamable HTTP Server Config: Port=${this.config.port}, Stream=${this.config.streamEndpoint}, Request=${this.config.requestEndpoint}, ChunkSize=${this.config.chunkSize}, Compression=${this.config.compression}, MaxStreams=${this.config.maxConcurrentStreams}`;
  }

  /**
   * Get performance metrics configuration
   */
  public getPerformanceConfig() {
    return {
      chunkSize: this.config.chunkSize,
      bufferSize: this.config.bufferSize,
      maxChunkSize: this.config.maxChunkSize,
      minChunkSize: this.config.minChunkSize,
      compression: this.config.compression,
      compressionLevel: this.config.compressionLevel,
      chunkedTransfer: this.config.chunkedTransfer,
      enableProgress: this.config.enableProgress
    };
  }

  /**
   * Get security configuration
   */
  public getSecurityConfig() {
    return {
      corsEnabled: this.config.corsEnabled,
      corsOrigins: this.config.corsOrigins,
      maxConcurrentStreams: this.config.maxConcurrentStreams,
      streamTimeout: this.config.streamTimeout
    };
  }

  /**
   * Get monitoring configuration
   */
  public getMonitoringConfig() {
    return {
      enableLogging: this.config.enableLogging,
      logLevel: this.config.logLevel,
      enableHealthCheck: this.config.enableHealthCheck,
      healthCheckEndpoint: this.config.healthCheckEndpoint,
      enableServerInfo: this.config.enableServerInfo,
      serverInfoEndpoint: this.config.serverInfoEndpoint,
      enableMetrics: this.config.enableMetrics,
      metricsEndpoint: this.config.metricsEndpoint
    };
  }
}
