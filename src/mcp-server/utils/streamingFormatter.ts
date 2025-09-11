import { ServerResponse } from 'http';
import { streamArrayInChunks, streamSearchResultsInChunks, createChunkedErrorResponse } from './chunkedResponse.js';
import { ChunkedResponseOptions } from './chunkedResponse.js';

/**
 * Streaming formatters for different types of MCP responses
 */

export interface StreamingFormatterOptions extends ChunkedResponseOptions {
  includeMetadata?: boolean;
  includeTimestamps?: boolean;
}

/**
 * Base streaming formatter
 */
export abstract class BaseStreamingFormatter {
  protected options: StreamingFormatterOptions;

  constructor(options: StreamingFormatterOptions) {
    this.options = options;
  }

  /**
   * Format and stream data
   */
  abstract formatAndStream(res: ServerResponse, data: any): Promise<void>;

  /**
   * Create progress callback
   */
  protected createProgressCallback(operation: string) {
    return (progress: number, chunk: any) => {
      if (this.options.progressCallback) {
        this.options.progressCallback(progress, chunk);
      }
      
      console.log(`${operation} progress: ${progress.toFixed(2)}%`);
    };
  }

  /**
   * Send error response
   */
  protected sendError(res: ServerResponse, error: Error, streamId?: string): void {
    const errorResponse = createChunkedErrorResponse(error, {
      includeStack: this.options.includeMetadata,
      streamId
    });
    
    res.write(errorResponse);
    res.end();
  }
}

/**
 * Search results streaming formatter
 */
export class SearchResultsStreamingFormatter extends BaseStreamingFormatter {
  constructor(options: StreamingFormatterOptions) {
    super(options);
  }

  async formatAndStream(res: ServerResponse, data: any): Promise<void> {
    try {
      const { results, metadata } = data;
      
      if (!Array.isArray(results)) {
        throw new Error('Search results must be an array');
      }

      const progressCallback = this.createProgressCallback('Search Results');
      
      await streamSearchResultsInChunks(res, results, {
        ...this.options,
        searchChunkSize: this.options.chunkSize,
        includeMetadata: this.options.includeMetadata,
        enableCompression: this.options.enableCompression ?? true,
        compressionLevel: this.options.compressionLevel ?? 6,
        progressCallback
      });
      
    } catch (error) {
      this.sendError(res, error as Error);
    }
  }
}

/**
 * Yellow pages results streaming formatter
 */
export class YellowPagesStreamingFormatter extends BaseStreamingFormatter {
  constructor(options: StreamingFormatterOptions) {
    super(options);
  }

  async formatAndStream(res: ServerResponse, data: any): Promise<void> {
    try {
      const { businesses, metadata } = data;
      
      if (!Array.isArray(businesses)) {
        throw new Error('Yellow pages results must be an array');
      }

      const progressCallback = this.createProgressCallback('Yellow Pages');
      
      await streamArrayInChunks(res, businesses, {
        ...this.options,
        arrayChunkSize: this.options.chunkSize,
        enableCompression: this.options.enableCompression ?? true,
        compressionLevel: this.options.compressionLevel ?? 6,
        progressCallback
      });
      
    } catch (error) {
      this.sendError(res, error as Error);
    }
  }
}

/**
 * Email extraction results streaming formatter
 */
export class EmailExtractionStreamingFormatter extends BaseStreamingFormatter {
  constructor(options: StreamingFormatterOptions) {
    super(options);
  }

  async formatAndStream(res: ServerResponse, data: any): Promise<void> {
    try {
      const { emails, metadata } = data;
      
      if (!Array.isArray(emails)) {
        throw new Error('Email extraction results must be an array');
      }

      const progressCallback = this.createProgressCallback('Email Extraction');
      
      await streamArrayInChunks(res, emails, {
        ...this.options,
        arrayChunkSize: this.options.chunkSize,
        enableCompression: this.options.enableCompression ?? true,
        compressionLevel: this.options.compressionLevel ?? 6,
        progressCallback
      });
      
    } catch (error) {
      this.sendError(res, error as Error);
    }
  }
}

/**
 * Website scraping results streaming formatter
 */
export class WebsiteScrapingStreamingFormatter extends BaseStreamingFormatter {
  constructor(options: StreamingFormatterOptions) {
    super(options);
  }

  async formatAndStream(res: ServerResponse, data: any): Promise<void> {
    try {
      const { pages, metadata } = data;
      
      if (!Array.isArray(pages)) {
        throw new Error('Website scraping results must be an array');
      }

      const progressCallback = this.createProgressCallback('Website Scraping');
      
      await streamArrayInChunks(res, pages, {
        ...this.options,
        arrayChunkSize: this.options.chunkSize,
        enableCompression: this.options.enableCompression ?? true,
        compressionLevel: this.options.compressionLevel ?? 6,
        progressCallback
      });
      
    } catch (error) {
      this.sendError(res, error as Error);
    }
  }
}

/**
 * Task statistics streaming formatter
 */
export class TaskStatisticsStreamingFormatter extends BaseStreamingFormatter {
  constructor(options: StreamingFormatterOptions) {
    super(options);
  }

  async formatAndStream(res: ServerResponse, data: any): Promise<void> {
    try {
      // Task statistics are typically smaller, so we can send them directly
      const response = {
        type: 'task_statistics',
        data,
        timestamp: new Date().toISOString(),
        ...(this.options.includeMetadata && { metadata: { source: 'aifetchly-mcp-server' } })
      };

      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify(response));
      res.end();
      
    } catch (error) {
      this.sendError(res, error as Error);
    }
  }
}

/**
 * System status streaming formatter
 */
export class SystemStatusStreamingFormatter extends BaseStreamingFormatter {
  constructor(options: StreamingFormatterOptions) {
    super(options);
  }

  async formatAndStream(res: ServerResponse, data: any): Promise<void> {
    try {
      const response = {
        type: 'system_status',
        data: {
          ...data,
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          ...(this.options.includeMetadata && { 
            metadata: { 
              source: 'aifetchly-mcp-server',
              version: '1.0.0',
              transport: 'streamable-http'
            } 
          })
        }
      };

      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify(response));
      res.end();
      
    } catch (error) {
      this.sendError(res, error as Error);
    }
  }
}

/**
 * Export results streaming formatter
 */
export class ExportResultsStreamingFormatter extends BaseStreamingFormatter {
  constructor(options: StreamingFormatterOptions) {
    super(options);
  }

  async formatAndStream(res: ServerResponse, data: any): Promise<void> {
    try {
      const { results, format, metadata } = data;
      
      if (!Array.isArray(results)) {
        throw new Error('Export results must be an array');
      }

      const progressCallback = this.createProgressCallback('Export Results');
      
      // Set appropriate content type based on format
      switch (format?.toLowerCase()) {
        case 'csv':
          res.setHeader('Content-Type', 'text/csv');
          break;
        case 'json':
          res.setHeader('Content-Type', 'application/json');
          break;
        case 'xml':
          res.setHeader('Content-Type', 'application/xml');
          break;
        default:
          res.setHeader('Content-Type', 'application/json');
      }
      
      await streamArrayInChunks(res, results, {
        ...this.options,
        arrayChunkSize: this.options.chunkSize,
        enableCompression: this.options.enableCompression ?? true,
        compressionLevel: this.options.compressionLevel ?? 6,
        progressCallback
      });
      
    } catch (error) {
      this.sendError(res, error as Error);
    }
  }
}

/**
 * User profile streaming formatter
 */
export class UserProfileStreamingFormatter extends BaseStreamingFormatter {
  constructor(options: StreamingFormatterOptions) {
    super(options);
  }

  async formatAndStream(res: ServerResponse, data: any): Promise<void> {
    try {
      const response = {
        type: 'user_profile',
        data: {
          ...data,
          timestamp: new Date().toISOString(),
          ...(this.options.includeMetadata && { 
            metadata: { 
              source: 'aifetchly-mcp-server',
              retrievedAt: new Date().toISOString()
            } 
          })
        }
      };

      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify(response));
      res.end();
      
    } catch (error) {
      this.sendError(res, error as Error);
    }
  }
}

/**
 * Streaming formatter factory
 */
export class StreamingFormatterFactory {
  /**
   * Create formatter for specific tool type
   */
  static createFormatter(
    toolName: string, 
    options: StreamingFormatterOptions
  ): BaseStreamingFormatter {
    switch (toolName) {
      case 'get_search_results':
        return new SearchResultsStreamingFormatter(options);
      
      case 'get_yellow_pages_results':
        return new YellowPagesStreamingFormatter(options);
      
      case 'get_email_extraction_results':
        return new EmailExtractionStreamingFormatter(options);
      
      case 'get_website_scraping_results':
        return new WebsiteScrapingStreamingFormatter(options);
      
      case 'get_task_statistics':
        return new TaskStatisticsStreamingFormatter(options);
      
      case 'get_system_status':
        return new SystemStatusStreamingFormatter(options);
      
      case 'export_results':
        return new ExportResultsStreamingFormatter(options);
      
      case 'get_user_profile':
        return new UserProfileStreamingFormatter(options);
      
      default:
        // Default formatter for unknown tools
        return new (class extends BaseStreamingFormatter {
          async formatAndStream(res: ServerResponse, data: any): Promise<void> {
            res.setHeader('Content-Type', 'application/json');
            res.write(JSON.stringify({
              type: 'unknown_tool_response',
              data,
              timestamp: new Date().toISOString()
            }));
            res.end();
          }
        })(options);
    }
  }

  /**
   * Get all available formatters
   */
  static getAvailableFormatters(): string[] {
    return [
      'get_search_results',
      'get_yellow_pages_results',
      'get_email_extraction_results',
      'get_website_scraping_results',
      'get_task_statistics',
      'get_system_status',
      'export_results',
      'get_user_profile'
    ];
  }
}

/**
 * Create streaming formatter with default options
 */
export function createStreamingFormatter(
  toolName: string,
  options: Partial<StreamingFormatterOptions> = {}
): BaseStreamingFormatter {
  const defaultOptions: StreamingFormatterOptions = {
    chunkSize: 8192,
    maxChunkSize: 16384,
    minChunkSize: 1024,
    enableProgress: true,
    includeMetadata: true,
    includeTimestamps: true,
    enableCompression: true,
    compressionLevel: 6,
    ...options
  };

  return StreamingFormatterFactory.createFormatter(toolName, defaultOptions);
}
