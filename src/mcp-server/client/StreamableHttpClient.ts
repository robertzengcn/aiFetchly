/**
 * Streamable HTTP Client for MCP Server
 * 
 * Provides client-side integration for the Streamable HTTP MCP server.
 * Supports both browser and Node.js environments.
 */

export interface StreamableHttpClientOptions {
  baseUrl: string;
  streamEndpoint?: string;
  requestEndpoint?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  enableProgress?: boolean;
  enableCompression?: boolean;
  chunkSize?: number;
}

export interface StreamableHttpResponse {
  type: string;
  data?: any;
  progress?: number;
  processed?: number;
  total?: number;
  timestamp: string;
  error?: string;
}

export interface StreamableHttpRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: any;
}

/**
 * Streamable HTTP Client
 * 
 * Handles communication with the Streamable HTTP MCP server.
 * Provides streaming capabilities and automatic reconnection.
 */
export class StreamableHttpClient {
  private options: Required<StreamableHttpClientOptions>;
  private streamId: string | null = null;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private eventListeners: Map<string, Function[]> = new Map();

  constructor(options: StreamableHttpClientOptions) {
    this.options = {
      streamEndpoint: '/stream',
      requestEndpoint: '/stream/request',
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      enableProgress: true,
      enableCompression: true,
      chunkSize: 8192,
      ...options
    };
  }

  /**
   * Connect to the MCP server
   */
  public async connect(): Promise<void> {
    try {
      const response = await fetch(`${this.options.baseUrl}${this.options.streamEndpoint}`);
      
      if (!response.ok) {
        throw new Error(`Failed to connect: ${response.status} ${response.statusText}`);
      }

      // Extract stream ID from response headers or body
      this.streamId = response.headers.get('X-Stream-ID') || this.generateStreamId();
      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Start reading the stream
      this.readStream(response);

      this.emit('connected', { streamId: this.streamId });
      
    } catch (error) {
      this.handleConnectionError(error as Error);
    }
  }

  /**
   * Disconnect from the MCP server
   */
  public async disconnect(): Promise<void> {
    this.isConnected = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.emit('disconnected');
  }

  /**
   * Send a request to the MCP server
   */
  public async sendRequest(request: StreamableHttpRequest): Promise<StreamableHttpResponse> {
    if (!this.isConnected || !this.streamId) {
      throw new Error('Not connected to server');
    }

    try {
      const response = await fetch(
        `${this.options.baseUrl}${this.options.requestEndpoint}?streamId=${this.streamId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.options.timeout)
        }
      );

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Send a streaming request with progress tracking
   */
  public async sendStreamingRequest(
    request: StreamableHttpRequest,
    progressCallback?: (progress: number, data: any) => void
  ): Promise<StreamableHttpResponse[]> {
    if (!this.isConnected || !this.streamId) {
      throw new Error('Not connected to server');
    }

    const responses: StreamableHttpResponse[] = [];
    
    try {
      const response = await fetch(
        `${this.options.baseUrl}${this.options.requestEndpoint}?streamId=${this.streamId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.options.timeout)
        }
      );

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`);
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process complete JSON objects
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const responseData = JSON.parse(line);
              responses.push(responseData);

              // Handle progress updates
              if (responseData.type === 'progress' && progressCallback) {
                progressCallback(responseData.progress || 0, responseData.data);
              }

              // Emit response event
              this.emit('response', responseData);

            } catch (parseError) {
              console.warn('Failed to parse response line:', line, parseError);
            }
          }
        }
      }

      return responses;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Read the stream for server-initiated messages
   */
  private async readStream(response: Response): Promise<void> {
    try {
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (this.isConnected) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process complete JSON objects
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              this.emit('message', data);
            } catch (parseError) {
              console.warn('Failed to parse stream message:', line, parseError);
            }
          }
        }
      }

    } catch (error) {
      if (this.isConnected) {
        this.handleConnectionError(error as Error);
      }
    }
  }

  /**
   * Handle connection errors and attempt reconnection
   */
  private handleConnectionError(error: Error): void {
    this.isConnected = false;
    this.emit('error', error);

    if (this.reconnectAttempts < this.options.retryAttempts) {
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch(console.error);
      }, this.options.retryDelay * this.reconnectAttempts);
    } else {
      this.emit('connectionFailed', error);
    }
  }

  /**
   * Generate a unique stream ID
   */
  private generateStreamId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add event listener
   */
  public on(event: string, listener: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  /**
   * Remove event listener
   */
  public off(event: string, listener: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to listeners
   */
  private emit(event: string, data?: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      });
    }
  }

  /**
   * Get connection status
   */
  public getConnectionStatus(): { connected: boolean; streamId: string | null; reconnectAttempts: number } {
    return {
      connected: this.isConnected,
      streamId: this.streamId,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Get client options
   */
  public getOptions(): Required<StreamableHttpClientOptions> {
    return { ...this.options };
  }

  /**
   * Update client options
   */
  public updateOptions(options: Partial<StreamableHttpClientOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

/**
 * MCP Tool Client
 * 
 * High-level client for interacting with MCP tools
 */
export class MCPToolClient {
  private client: StreamableHttpClient;

  constructor(client: StreamableHttpClient) {
    this.client = client;
  }

  /**
   * List available tools
   */
  public async listTools(): Promise<any[]> {
    const response = await this.client.sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    });

    return response.data?.tools || [];
  }

  /**
   * Call a tool
   */
  public async callTool(name: string, args: any = {}): Promise<any> {
    const response = await this.client.sendRequest({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    });

    return response.data;
  }

  /**
   * Call a tool with streaming response
   */
  public async callToolStreaming(
    name: string, 
    args: any = {},
    progressCallback?: (progress: number, data: any) => void
  ): Promise<any[]> {
    const responses = await this.client.sendStreamingRequest({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    }, progressCallback);

    return responses;
  }

  /**
   * Search engine tools
   */
  public search = {
    createTask: (args: any) => this.callTool('create_search_task', args),
    listTasks: () => this.callTool('list_search_tasks'),
    getTask: (id: string) => this.callTool('get_search_task', { id }),
    getResults: (id: string, progressCallback?: (progress: number, data: any) => void) => 
      this.callToolStreaming('get_search_results', { id }, progressCallback),
    updateTask: (id: string, args: any) => this.callTool('update_search_task', { id, ...args }),
    deleteTask: (id: string) => this.callTool('delete_search_task', { id })
  };

  /**
   * Yellow pages tools
   */
  public yellowPages = {
    createTask: (args: any) => this.callTool('create_yellow_pages_task', args),
    listTasks: () => this.callTool('list_yellow_pages_tasks'),
    getTask: (id: string) => this.callTool('get_yellow_pages_task', { id }),
    getResults: (id: string, progressCallback?: (progress: number, data: any) => void) => 
      this.callToolStreaming('get_yellow_pages_results', { id }, progressCallback),
    updateTask: (id: string, args: any) => this.callTool('update_yellow_pages_task', { id, ...args }),
    deleteTask: (id: string) => this.callTool('delete_yellow_pages_task', { id })
  };

  /**
   * Website scraping tools
   */
  public websiteScraping = {
    createTask: (args: any) => this.callTool('create_website_scraping_task', args),
    listTasks: () => this.callTool('list_website_scraping_tasks'),
    getTask: (id: string) => this.callTool('get_website_scraping_task', { id }),
    getResults: (id: string, progressCallback?: (progress: number, data: any) => void) => 
      this.callToolStreaming('get_website_scraping_results', { id }, progressCallback),
    updateTask: (id: string, args: any) => this.callTool('update_website_scraping_task', { id, ...args }),
    deleteTask: (id: string) => this.callTool('delete_website_scraping_task', { id })
  };

  /**
   * Email extraction tools
   */
  public emailExtraction = {
    createTask: (args: any) => this.callTool('create_email_extraction_task', args),
    listTasks: () => this.callTool('list_email_extraction_tasks'),
    getTask: (id: string) => this.callTool('get_email_extraction_task', { id }),
    getResults: (id: string, progressCallback?: (progress: number, data: any) => void) => 
      this.callToolStreaming('get_email_extraction_results', { id }, progressCallback),
    updateTask: (id: string, args: any) => this.callTool('update_email_extraction_task', { id, ...args }),
    deleteTask: (id: string) => this.callTool('delete_email_extraction_task', { id })
  };

  /**
   * General tools
   */
  public general = {
    getSystemStatus: () => this.callTool('get_system_status'),
    getTaskStatistics: (args: any = {}) => this.callTool('get_task_statistics', args),
    exportResults: (args: any) => this.callTool('export_results', args),
    getUserProfile: () => this.callTool('get_user_profile')
  };
}

/**
 * Create a new MCP client
 */
export function createMCPClient(options: StreamableHttpClientOptions): MCPToolClient {
  const client = new StreamableHttpClient(options);
  return new MCPToolClient(client);
}

/**
 * Browser-specific client factory
 */
export function createBrowserMCPClient(baseUrl: string): MCPToolClient {
  return createMCPClient({
    baseUrl,
    enableCompression: true,
    enableProgress: true
  });
}

/**
 * Node.js-specific client factory
 */
export function createNodeMCPClient(baseUrl: string): MCPToolClient {
  return createMCPClient({
    baseUrl,
    enableCompression: true,
    enableProgress: true,
    timeout: 60000
  });
}
