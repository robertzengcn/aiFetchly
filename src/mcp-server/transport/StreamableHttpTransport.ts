import { ServerResponse } from 'http';
import { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';

/**
 * Transport interface for MCP communication
 */
export interface Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  send(message: JSONRPCMessage): Promise<void>;
  close(): Promise<void>;
  get closed(): boolean;
}

/**
 * Configuration options for StreamableHttpTransport
 */
export interface StreamableHttpTransportOptions {
  /**
   * Chunk size for streaming responses (in bytes)
   * Default: 8192
   */
  chunkSize?: number;
  
  /**
   * Enable compression for responses
   * Default: true
   */
  compression?: boolean;
  
  /**
   * Buffer size for streaming operations
   * Default: 65536
   */
  bufferSize?: number;
  
  /**
   * Enable progress indicators for long-running operations
   * Default: true
   */
  enableProgress?: boolean;
  
  /**
   * Timeout for streaming operations (in milliseconds)
   * Default: 300000 (5 minutes)
   */
  streamTimeout?: number;
  
  /**
   * Enable chunked transfer encoding
   * Default: true
   */
  chunkedTransfer?: boolean;
}

/**
 * Streamable HTTP Transport for MCP Server
 * 
 * Provides HTTP streaming capabilities for MCP responses with support for:
 * - Chunked transfer encoding
 * - Progressive response building
 * - Error handling and cleanup
 * - Both streaming and non-streaming modes
 */
export class StreamableHttpTransport implements Transport {
  private response: ServerResponse;
  private options: Required<StreamableHttpTransportOptions>;
  private isStreaming: boolean = false;
  private isClosed: boolean = false;
  private streamBuffer: Buffer[] = [];
  private currentChunk: Buffer = Buffer.alloc(0);
  
  // Event handlers
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;

  constructor(response: ServerResponse, options: StreamableHttpTransportOptions = {}) {
    this.response = response;
    this.options = {
      chunkSize: 8192,
      compression: true,
      bufferSize: 65536,
      enableProgress: true,
      streamTimeout: 300000,
      chunkedTransfer: true,
      ...options
    };
    
    this.setupResponse();
  }

  /**
   * Setup HTTP response headers and streaming configuration
   */
  private setupResponse(): void {
    // Set basic headers
    this.response.setHeader('Content-Type', 'application/json');
    this.response.setHeader('Cache-Control', 'no-cache');
    this.response.setHeader('Connection', 'keep-alive');
    
    // Enable CORS
    this.response.setHeader('Access-Control-Allow-Origin', '*');
    this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    this.response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    
    // Set streaming headers
    if (this.options.chunkedTransfer) {
      this.response.setHeader('Transfer-Encoding', 'chunked');
    }
    
    // Set compression headers if enabled
    if (this.options.compression) {
      this.response.setHeader('Content-Encoding', 'gzip');
    }
    
    // Set timeout
    this.response.setTimeout(this.options.streamTimeout);
    
    // Handle client disconnect
    this.response.on('close', () => {
      this.handleClose();
    });
    
    this.response.on('error', (error) => {
      this.handleError(error);
    });
  }

  /**
   * Start streaming response
   */
  public async start(): Promise<void> {
    if (this.isClosed) {
      throw new Error('Transport is closed');
    }
    
    this.isStreaming = true;
    
    // Send initial response headers
    this.response.writeHead(200);
    
    // Send initial connection event
    await this.sendConnectionEvent();
  }

  /**
   * Send initial connection event
   */
  private async sendConnectionEvent(): Promise<void> {
    const connectionEvent = {
      type: 'connected',
      timestamp: new Date().toISOString(),
      transport: 'streamable-http',
      config: {
        chunkSize: this.options.chunkSize,
        compression: this.options.compression,
        enableProgress: this.options.enableProgress
      }
    };
    
    await this.sendChunk(JSON.stringify(connectionEvent));
  }

  /**
   * Send a chunk of data
   */
  private async sendChunk(data: string | Buffer): Promise<void> {
    if (this.isClosed || !this.isStreaming) {
      return;
    }
    
    try {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      
      if (this.options.chunkedTransfer) {
        // Send chunked data
        const chunkSize = chunk.length.toString(16);
        this.response.write(`${chunkSize}\r\n`);
        this.response.write(chunk);
        this.response.write('\r\n');
      } else {
        // Send regular data
        this.response.write(chunk);
      }
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Send a JSON-RPC message
   */
  public async send(message: JSONRPCMessage): Promise<void> {
    if (this.isClosed) {
      throw new Error('Transport is closed');
    }
    
    try {
      const jsonMessage = JSON.stringify(message);
      await this.sendChunk(jsonMessage);
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Send a streaming response with progress updates
   */
  public async sendStreamingResponse(
    data: any, 
    progressCallback?: (progress: number) => void
  ): Promise<void> {
    if (this.isClosed) {
      throw new Error('Transport is closed');
    }
    
    try {
      // If data is small, send it directly
      if (JSON.stringify(data).length <= this.options.chunkSize) {
        await this.sendChunk(JSON.stringify(data));
        return;
      }
      
      // For large data, stream it in chunks
      const jsonString = JSON.stringify(data);
      const totalLength = jsonString.length;
      let offset = 0;
      
      while (offset < totalLength && !this.isClosed) {
        const chunkSize = Math.min(this.options.chunkSize, totalLength - offset);
        const chunk = jsonString.slice(offset, offset + chunkSize);
        
        await this.sendChunk(chunk);
        
        offset += chunkSize;
        
        // Report progress if callback provided
        if (progressCallback && this.options.enableProgress) {
          const progress = (offset / totalLength) * 100;
          progressCallback(progress);
        }
      }
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Send progress update
   */
  public async sendProgress(progress: number, message?: string): Promise<void> {
    if (!this.options.enableProgress || this.isClosed) {
      return;
    }
    
    const progressUpdate = {
      type: 'progress',
      progress,
      message: message || 'Processing...',
      timestamp: new Date().toISOString()
    };
    
    await this.sendChunk(JSON.stringify(progressUpdate));
  }

  /**
   * Send error message
   */
  public async sendError(error: Error | string, code?: number): Promise<void> {
    const errorMessage = {
      type: 'error',
      error: error instanceof Error ? error.message : error,
      code: code || -1,
      timestamp: new Date().toISOString()
    };
    
    await this.sendChunk(JSON.stringify(errorMessage));
  }

  /**
   * Handle incoming message
   */
  public async handleMessage(message: unknown, extra?: MessageExtraInfo): Promise<void> {
    if (this.onmessage) {
      try {
        const jsonMessage = typeof message === 'string' ? JSON.parse(message) : message;
        this.onmessage(jsonMessage as JSONRPCMessage, extra);
      } catch (error) {
        this.handleError(error as Error);
      }
    }
  }

  /**
   * Close the transport
   */
  public async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    
    this.isClosed = true;
    this.isStreaming = false;
    
    try {
      if (this.options.chunkedTransfer) {
        // Send final chunk
        this.response.write('0\r\n\r\n');
      }
      
      this.response.end();
    } catch (error) {
      // Ignore errors during close
    }
    
    if (this.onclose) {
      this.onclose();
    }
  }

  /**
   * Handle close event
   */
  private handleClose(): void {
    this.isClosed = true;
    this.isStreaming = false;
    
    if (this.onclose) {
      this.onclose();
    }
  }

  /**
   * Handle error event
   */
  private handleError(error: Error): void {
    this.isClosed = true;
    this.isStreaming = false;
    
    if (this.onerror) {
      this.onerror(error);
    }
  }

  /**
   * Check if transport is closed
   */
  public get closed(): boolean {
    return this.isClosed;
  }

  /**
   * Check if transport is streaming
   */
  public get streaming(): boolean {
    return this.isStreaming && !this.isClosed;
  }

  /**
   * Get transport options
   */
  public getOptions(): Required<StreamableHttpTransportOptions> {
    return { ...this.options };
  }

  /**
   * Update transport options
   */
  public updateOptions(options: Partial<StreamableHttpTransportOptions>): void {
    this.options = { ...this.options, ...options };
  }
}
