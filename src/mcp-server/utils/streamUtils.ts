import { Transform, Readable } from 'stream';
import { ServerResponse } from 'http';

/**
 * Utility functions for streaming operations
 */

/**
 * Create a readable stream from data
 */
export function createReadableStream(data: any): Readable {
  const jsonString = JSON.stringify(data);
  return Readable.from([jsonString]);
}

/**
 * Create a transform stream for JSON chunking
 */
export function createJsonChunkTransform(chunkSize: number = 8192): Transform {
  let buffer = '';
  
  return new Transform({
    transform(chunk, encoding, callback) {
      buffer += chunk.toString();
      
      // Process complete JSON objects
      let start = 0;
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      
      for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i];
        
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        
        if (char === '\\') {
          escapeNext = true;
          continue;
        }
        
        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }
        
        if (!inString) {
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              // Complete JSON object found
              const jsonObject = buffer.slice(start, i + 1);
              this.push(jsonObject);
              start = i + 1;
            }
          }
        }
      }
      
      // Keep incomplete JSON in buffer
      buffer = buffer.slice(start);
      callback();
    },
    
    flush(callback) {
      // Send any remaining data
      if (buffer.trim()) {
        this.push(buffer);
      }
      callback();
    }
  });
}

/**
 * Create a progress stream that emits progress events
 */
export function createProgressStream(
  totalSize: number,
  progressCallback: (progress: number) => void
): Transform {
  let processedSize = 0;
  
  return new Transform({
    transform(chunk, encoding, callback) {
      processedSize += chunk.length;
      const progress = Math.min((processedSize / totalSize) * 100, 100);
      progressCallback(progress);
      this.push(chunk);
      callback();
    }
  });
}

/**
 * Create a compression stream
 */
export function createCompressionStream(level: number = 6): Transform {
  const zlib = require('zlib');
  return zlib.createGzip({ level });
}

/**
 * Create a chunked response stream
 */
export function createChunkedResponseStream(chunkSize: number = 8192): Transform {
  return new Transform({
    transform(chunk, encoding, callback) {
      const data = chunk.toString();
      const chunks: string[] = [];
      
      for (let i = 0; i < data.length; i += chunkSize) {
        const dataChunk = data.slice(i, i + chunkSize);
        const chunkSizeHex = dataChunk.length.toString(16);
        chunks.push(`${chunkSizeHex}\r\n${dataChunk}\r\n`);
      }
      
      this.push(chunks.join(''));
      callback();
    },
    
    flush(callback) {
      // Send final chunk
      this.push('0\r\n\r\n');
      callback();
    }
  });
}

/**
 * Create a streaming response with proper headers
 */
export function setupStreamingResponse(
  res: ServerResponse,
  options: {
    contentType?: string;
    compression?: boolean;
    chunked?: boolean;
    cors?: boolean;
  } = {}
): void {
  const {
    contentType = 'application/json',
    compression = true,
    chunked = true,
    cors = true
  } = options;
  
  // Set basic headers
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Enable CORS if requested
  if (cors) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  
  // Set streaming headers
  if (chunked) {
    res.setHeader('Transfer-Encoding', 'chunked');
  }
  
  // Set compression headers if enabled
  if (compression) {
    res.setHeader('Content-Encoding', 'gzip');
  }
}

/**
 * Stream data to response with progress tracking
 */
export async function streamDataToResponse(
  res: ServerResponse,
  data: any,
  options: {
    chunkSize?: number;
    progressCallback?: (progress: number) => void;
    compression?: boolean;
  } = {}
): Promise<void> {
  const {
    chunkSize = 8192,
    progressCallback,
    compression = true
  } = options;
  
  try {
    // Setup response headers
    setupStreamingResponse(res, { compression });
    
    // Create readable stream from data
    const dataStream = createReadableStream(data);
    
    // Create transform streams
    const jsonTransform = createJsonChunkTransform(chunkSize);
    const progressStream = progressCallback ? 
      createProgressStream(JSON.stringify(data).length, progressCallback) : 
      new Transform({ transform(chunk, encoding, callback) { this.push(chunk); callback(); } });
    
    // Create compression stream if enabled
    const compressionStream = compression ? createCompressionStream() : 
      new Transform({ transform(chunk, encoding, callback) { this.push(chunk); callback(); } });
    
    // Create chunked response stream
    const chunkedStream = createChunkedResponseStream(chunkSize);
    
    // Pipe streams together
    dataStream
      .pipe(jsonTransform)
      .pipe(progressStream)
      .pipe(compressionStream)
      .pipe(chunkedStream)
      .pipe(res);
      
  } catch (error) {
    console.error('Error streaming data to response:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.write(JSON.stringify({ error: 'Failed to stream data' }));
    res.end();
  }
}

/**
 * Create a streaming iterator for large datasets
 */
export async function* createStreamingIterator<T>(
  data: T[],
  chunkSize: number = 100
): AsyncGenerator<T[], void, unknown> {
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    yield chunk;
    
    // Allow other operations to run
    await new Promise(resolve => setImmediate(resolve));
  }
}

/**
 * Stream large array data with progress updates
 */
export async function streamArrayData<T>(
  res: ServerResponse,
  data: T[],
  options: {
    chunkSize?: number;
    progressCallback?: (progress: number, currentChunk: T[]) => void;
    compression?: boolean;
  } = {}
): Promise<void> {
  const {
    chunkSize = 100,
    progressCallback,
    compression = true
  } = options;
  
  try {
    setupStreamingResponse(res, { compression });
    
    let processedCount = 0;
    const totalCount = data.length;
    
    // Send initial response
    res.write(JSON.stringify({ type: 'start', total: totalCount }) + '\n');
    
    // Stream data in chunks
    for await (const chunk of createStreamingIterator(data, chunkSize)) {
      const chunkData = {
        type: 'chunk',
        data: chunk,
        progress: (processedCount / totalCount) * 100,
        processed: processedCount,
        total: totalCount
      };
      
      res.write(JSON.stringify(chunkData) + '\n');
      
      if (progressCallback) {
        progressCallback((processedCount / totalCount) * 100, chunk);
      }
      
      processedCount += chunk.length;
    }
    
    // Send final response
    res.write(JSON.stringify({ type: 'end', total: processedCount }) + '\n');
    res.end();
    
  } catch (error) {
    console.error('Error streaming array data:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.write(JSON.stringify({ error: 'Failed to stream array data' }));
    res.end();
  }
}

/**
 * Create a streaming search results formatter
 */
export function createStreamingSearchFormatter() {
  return {
    formatResults: async function* (results: any[], chunkSize: number = 10) {
      let processed = 0;
      const total = results.length;
      
      for (let i = 0; i < results.length; i += chunkSize) {
        const chunk = results.slice(i, i + chunkSize);
        const progress = (processed / total) * 100;
        
        yield {
          type: 'search_results',
          data: chunk,
          progress,
          processed,
          total,
          timestamp: new Date().toISOString()
        };
        
        processed += chunk.length;
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  };
}

/**
 * Create a streaming error handler
 */
export function createStreamingErrorHandler(res: ServerResponse) {
  return (error: Error, streamId?: string) => {
    const errorResponse = {
      type: 'error',
      error: error.message,
      streamId,
      timestamp: new Date().toISOString()
    };
    
    try {
      res.write(JSON.stringify(errorResponse) + '\n');
    } catch (writeError) {
      console.error('Failed to write error to stream:', writeError);
    }
  };
}

/**
 * Validate streaming configuration
 */
export function validateStreamingConfig(config: {
  chunkSize?: number;
  bufferSize?: number;
  maxChunkSize?: number;
  minChunkSize?: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (config.chunkSize && (config.chunkSize < 1024 || config.chunkSize > 65536)) {
    errors.push('Chunk size must be between 1024 and 65536 bytes');
  }
  
  if (config.bufferSize && (config.bufferSize < 4096 || config.bufferSize > 1048576)) {
    errors.push('Buffer size must be between 4096 and 1048576 bytes');
  }
  
  if (config.maxChunkSize && config.minChunkSize && config.maxChunkSize < config.minChunkSize) {
    errors.push('Max chunk size must be greater than or equal to min chunk size');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
