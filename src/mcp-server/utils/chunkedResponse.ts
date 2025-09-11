import { Transform, Readable } from 'stream';
import { ServerResponse } from 'http';

/**
 * Chunked Response utilities for streaming large data
 */

export interface ChunkedResponseOptions {
  chunkSize: number;
  maxChunkSize: number;
  minChunkSize: number;
  enableCompression: boolean;
  compressionLevel: number;
  enableProgress: boolean;
  progressCallback?: (progress: number, chunk: any) => void;
}

/**
 * Chunked Response Handler
 * Manages streaming of large responses in chunks with progress tracking
 */
export class ChunkedResponseHandler {
  private options: ChunkedResponseOptions;
  private totalSize: number = 0;
  private processedSize: number = 0;

  constructor(options: ChunkedResponseOptions) {
    this.options = options;
  }

  /**
   * Create a chunked response stream
   */
  public createChunkedStream(data: any): Readable {
    const jsonString = JSON.stringify(data);
    this.totalSize = jsonString.length;
    this.processedSize = 0;

    return new Readable({
      read() {
        // This will be handled by the transform stream
      }
    });
  }

  /**
   * Create a chunking transform stream
   */
  public createChunkingTransform(): Transform {
    return new Transform({
      objectMode: false,
      transform: (chunk, encoding, callback) => {
        this.processChunk(chunk, callback);
      },
      flush: (callback) => {
        this.finalizeChunking(callback);
      }
    });
  }

  /**
   * Process a chunk of data
   */
  private processChunk(chunk: Buffer, callback: (error?: Error | null, data?: any) => void): void {
    const data = chunk.toString();
    const chunks = this.splitIntoChunks(data);
    
    for (const chunkData of chunks) {
      this.push(chunkData);
      this.processedSize += chunkData.length;
      
      // Report progress
      if (this.options.enableProgress && this.options.progressCallback) {
        const progress = (this.processedSize / this.totalSize) * 100;
        this.options.progressCallback(progress, chunkData);
      }
    }
    
    callback();
  }

  /**
   * Split data into appropriately sized chunks
   */
  private splitIntoChunks(data: string): string[] {
    const chunks: string[] = [];
    let offset = 0;
    
    while (offset < data.length) {
      let chunkSize = this.options.chunkSize;
      
      // Adjust chunk size based on content
      const remaining = data.length - offset;
      if (remaining < this.options.minChunkSize) {
        chunkSize = remaining;
      } else if (remaining < this.options.maxChunkSize) {
        chunkSize = remaining;
      }
      
      // Try to break at natural boundaries (JSON objects, lines, etc.)
      const chunk = this.findOptimalChunkBreak(data, offset, chunkSize);
      chunks.push(chunk);
      offset += chunk.length;
    }
    
    return chunks;
  }

  /**
   * Find optimal chunk break point
   */
  private findOptimalChunkBreak(data: string, offset: number, maxSize: number): string {
    if (offset + maxSize >= data.length) {
      return data.slice(offset);
    }
    
    // Look for natural break points
    const searchEnd = Math.min(offset + maxSize, data.length);
    const searchData = data.slice(offset, searchEnd);
    
    // Try to break at JSON object boundaries
    let lastBrace = searchData.lastIndexOf('}');
    if (lastBrace > 0 && lastBrace < maxSize * 0.8) {
      return data.slice(offset, offset + lastBrace + 1);
    }
    
    // Try to break at line boundaries
    let lastNewline = searchData.lastIndexOf('\n');
    if (lastNewline > 0 && lastNewline < maxSize * 0.8) {
      return data.slice(offset, offset + lastNewline + 1);
    }
    
    // Try to break at word boundaries
    let lastSpace = searchData.lastIndexOf(' ');
    if (lastSpace > 0 && lastSpace < maxSize * 0.8) {
      return data.slice(offset, offset + lastSpace + 1);
    }
    
    // Fall back to exact size
    return data.slice(offset, offset + maxSize);
  }

  /**
   * Finalize chunking process
   */
  private finalizeChunking(callback: (error?: Error | null, data?: any) => void): void {
    // Send final progress update
    if (this.options.enableProgress && this.options.progressCallback) {
      this.options.progressCallback(100, null);
    }
    
    callback();
  }

  /**
   * Push data to the stream
   */
  private push(data: string): void {
    // This will be implemented by the transform stream
  }
}

/**
 * Create a chunked JSON response
 */
export function createChunkedJsonResponse(
  data: any,
  options: ChunkedResponseOptions
): Readable {
  const handler = new ChunkedResponseHandler(options);
  const jsonString = JSON.stringify(data);
  
  return Readable.from([jsonString]).pipe(handler.createChunkingTransform());
}

/**
 * Create a chunked array response for large datasets
 */
export function createChunkedArrayResponse<T>(
  data: T[],
  options: ChunkedResponseOptions & { arrayChunkSize?: number }
): Readable {
  const { arrayChunkSize = 100, ...chunkOptions } = options;
  const handler = new ChunkedResponseHandler(chunkOptions);
  
  return new Readable({
    objectMode: true,
    read() {
      // This will be handled by the array processing
    }
  });
}

/**
 * Stream array data in chunks
 */
export async function streamArrayInChunks<T>(
  res: ServerResponse,
  data: T[],
  options: ChunkedResponseOptions & { arrayChunkSize?: number }
): Promise<void> {
  const { arrayChunkSize = 100, ...chunkOptions } = options;
  
  try {
    // Setup response headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    
    // Send initial metadata
    const metadata = {
      type: 'array_start',
      totalItems: data.length,
      chunkSize: arrayChunkSize,
      timestamp: new Date().toISOString()
    };
    
    res.write(JSON.stringify(metadata) + '\n');
    
    // Process array in chunks
    for (let i = 0; i < data.length; i += arrayChunkSize) {
      const chunk = data.slice(i, i + arrayChunkSize);
      const progress = ((i + chunk.length) / data.length) * 100;
      
      const chunkData = {
        type: 'array_chunk',
        data: chunk,
        progress,
        processed: i + chunk.length,
        total: data.length,
        timestamp: new Date().toISOString()
      };
      
      res.write(JSON.stringify(chunkData) + '\n');
      
      // Report progress
      if (chunkOptions.enableProgress && chunkOptions.progressCallback) {
        chunkOptions.progressCallback(progress, chunk);
      }
      
      // Allow other operations to run
      await new Promise(resolve => setImmediate(resolve));
    }
    
    // Send final metadata
    const finalMetadata = {
      type: 'array_end',
      totalProcessed: data.length,
      timestamp: new Date().toISOString()
    };
    
    res.write(JSON.stringify(finalMetadata) + '\n');
    res.end();
    
  } catch (error) {
    console.error('Error streaming array in chunks:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.write(JSON.stringify({ error: 'Failed to stream array data' }));
    res.end();
  }
}

/**
 * Create a chunked search results response
 */
export function createChunkedSearchResponse(
  results: any[],
  options: ChunkedResponseOptions & { 
    searchChunkSize?: number;
    includeMetadata?: boolean;
  }
): Readable {
  const { searchChunkSize = 50, includeMetadata = true, ...chunkOptions } = options;
  const handler = new ChunkedResponseHandler(chunkOptions);
  
  return new Readable({
    objectMode: true,
    read() {
      // This will be handled by the search processing
    }
  });
}

/**
 * Stream search results in chunks
 */
export async function streamSearchResultsInChunks(
  res: ServerResponse,
  results: any[],
  options: ChunkedResponseOptions & { 
    searchChunkSize?: number;
    includeMetadata?: boolean;
  }
): Promise<void> {
  const { searchChunkSize = 50, includeMetadata = true, ...chunkOptions } = options;
  
  try {
    // Setup response headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    
    // Send initial metadata
    if (includeMetadata) {
      const metadata = {
        type: 'search_start',
        totalResults: results.length,
        chunkSize: searchChunkSize,
        timestamp: new Date().toISOString()
      };
      
      res.write(JSON.stringify(metadata) + '\n');
    }
    
    // Process results in chunks
    for (let i = 0; i < results.length; i += searchChunkSize) {
      const chunk = results.slice(i, i + searchChunkSize);
      const progress = ((i + chunk.length) / results.length) * 100;
      
      const chunkData = {
        type: 'search_chunk',
        results: chunk,
        progress,
        processed: i + chunk.length,
        total: results.length,
        timestamp: new Date().toISOString()
      };
      
      res.write(JSON.stringify(chunkData) + '\n');
      
      // Report progress
      if (chunkOptions.enableProgress && chunkOptions.progressCallback) {
        chunkOptions.progressCallback(progress, chunk);
      }
      
      // Allow other operations to run
      await new Promise(resolve => setImmediate(resolve));
    }
    
    // Send final metadata
    if (includeMetadata) {
      const finalMetadata = {
        type: 'search_end',
        totalProcessed: results.length,
        timestamp: new Date().toISOString()
      };
      
      res.write(JSON.stringify(finalMetadata) + '\n');
    }
    
    res.end();
    
  } catch (error) {
    console.error('Error streaming search results in chunks:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.write(JSON.stringify({ error: 'Failed to stream search results' }));
    res.end();
  }
}

/**
 * Create a chunked error response
 */
export function createChunkedErrorResponse(
  error: Error,
  options: { includeStack?: boolean; streamId?: string }
): string {
  const { includeStack = false, streamId } = options;
  
  const errorData = {
    type: 'error',
    message: error.message,
    name: error.name,
    streamId,
    timestamp: new Date().toISOString(),
    ...(includeStack && { stack: error.stack })
  };
  
  return JSON.stringify(errorData) + '\n';
}

/**
 * Validate chunked response options
 */
export function validateChunkedResponseOptions(options: ChunkedResponseOptions): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (options.chunkSize < options.minChunkSize) {
    errors.push('Chunk size must be greater than or equal to min chunk size');
  }
  
  if (options.chunkSize > options.maxChunkSize) {
    errors.push('Chunk size must be less than or equal to max chunk size');
  }
  
  if (options.minChunkSize < 1) {
    errors.push('Min chunk size must be at least 1');
  }
  
  if (options.maxChunkSize > 65536) {
    errors.push('Max chunk size must be at most 65536');
  }
  
  if (options.compressionLevel < 1 || options.compressionLevel > 9) {
    errors.push('Compression level must be between 1 and 9');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
