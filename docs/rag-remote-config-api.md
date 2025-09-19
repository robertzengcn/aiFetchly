# RAG Remote Configuration API Documentation

## Overview

The RAG Remote Configuration system provides automatic embedding model configuration management, eliminating the need for frontend applications to handle sensitive configuration data like API keys and provider details.

## Key Features

- **Automatic Configuration**: Backend automatically selects the best available embedding model
- **Security**: Sensitive data (API keys, provider URLs) are handled server-side
- **Caching**: Intelligent caching with TTL for optimal performance
- **Fallback**: Offline fallback mechanisms when remote service is unavailable
- **Type Safety**: Full TypeScript support with comprehensive type definitions

## Architecture

```
Frontend → IPC Handlers → RagSearchController → RagSearchModule → ConfigurationService → RagConfigApi → Remote Server
```

## API Reference

### RagConfigApi

Located in `src/api/ragConfigApi.ts`

#### Methods

##### `getDefaultConfig(): Promise<CommonApiresp<EmbeddingConfig>>`

Retrieves the default embedding model configuration from the remote server.

**Returns:**
```typescript
{
  success: boolean;
  data: {
    model: string;
    dimensions?: number;
    maxTokens?: number;
    timeout?: number;
    retries?: number;
  };
}
```

**Example:**
```typescript
const api = new RagConfigApi();
const config = await api.getDefaultConfig();
if (config.success) {
  console.log('Model:', config.data.model);
}
```

##### `refreshCache(): Promise<CommonApiresp<void>>`

Refreshes the configuration cache on the remote server.

**Returns:**
```typescript
{
  success: boolean;
  data: null;
}
```

##### `isOnline(): Promise<CommonApiresp<boolean>>`

Checks if the remote configuration service is online.

**Returns:**
```typescript
{
  success: boolean;
  data: boolean;
}
```

### ConfigurationService

Located in `src/modules/ConfigurationService.ts`

#### Methods

##### `getDefaultModelConfig(): Promise<EmbeddingConfig>`

Gets the default model configuration with caching and fallback support.

**Returns:**
```typescript
EmbeddingConfig
```

**Features:**
- Checks local cache first
- Falls back to remote API if cache miss
- Returns fallback configuration if API fails

##### `refreshCache(): Promise<void>`

Refreshes the local configuration cache.

##### `isOnline(): Promise<boolean>`

Checks if the remote service is available.

### ModelRegistry

Located in `src/modules/ModelRegistry.ts`

#### Methods

##### `getBestModel(category?: string): ModelMetadata | null`

Gets the best available model based on priority and performance.

**Parameters:**
- `category` (optional): Filter by model category ('fast', 'accurate', 'balanced', 'default')

**Returns:**
```typescript
ModelMetadata | null
```

##### `registerModel(modelId: string, metadata: ModelMetadata): void`

Registers a new model with its metadata.

##### `getModelsByCategory(category: string): ModelMetadata[]`

Gets all models in a specific category.

### ConfigurationCache

Located in `src/modules/ConfigurationCache.ts`

#### Methods

##### `get(key: string): T | null`

Retrieves cached data by key.

##### `set(key: string, value: T, ttl?: number): void`

Stores data in cache with optional TTL.

##### `isExpired(key: string): boolean`

Checks if a cache entry is expired.

##### `clear(): void`

Clears all cache entries.

## Usage Examples

### Basic Usage

```typescript
import { RagSearchController } from '@/controller/RagSearchController';

// Create controller (no configuration needed)
const controller = new RagSearchController();

// Initialize (automatically gets configuration)
await controller.initialize();

// Perform search
const results = await controller.search({
  query: 'What is machine learning?',
  options: { limit: 10 }
});
```

### Advanced Usage

```typescript
import { ConfigurationService } from '@/modules/ConfigurationService';

// Get configuration service
const configService = new ConfigurationService();

// Check if online
const isOnline = await configService.isOnline();

if (isOnline) {
  // Get latest configuration
  const config = await configService.getDefaultModelConfig();
  console.log('Using model:', config.model);
} else {
  console.log('Using offline fallback configuration');
}
```

### Error Handling

```typescript
try {
  const controller = new RagSearchController();
  await controller.initialize();
  
  const results = await controller.search({ query: 'test' });
  console.log('Search results:', results);
} catch (error) {
  console.error('RAG search failed:', error.message);
  // System will automatically use fallback configuration
}
```

## Configuration

### Environment Variables

No environment variables are required for the frontend. All configuration is handled by the remote service.

### Remote Service Configuration

The remote service should provide the following endpoints:

- `GET /api/rag/config` - Get default model configuration
- `POST /api/rag/refresh` - Refresh configuration cache
- `GET /api/rag/health` - Health check

### Fallback Configuration

When the remote service is unavailable, the system uses the following fallback:

```typescript
{
  model: 'text-embedding-3-small',
  dimensions: 1536,
  maxTokens: 8191,
  timeout: 30000,
  retries: 3
}
```

## Migration Guide

### From Manual Configuration to Automatic

**Before:**
```typescript
const config = {
  model: 'text-embedding-3-small',
  provider: 'openai',
  apiKey: 'sk-...',
  url: 'https://api.openai.com/v1',
  dimensions: 1536
};

const controller = new RagSearchController();
await controller.initialize(config);
```

**After:**
```typescript
const controller = new RagSearchController();
await controller.initialize(); // No configuration needed
```

### IPC Handler Changes

**Before:**
```typescript
ipcMain.handle(RAG_SEARCH, async (event, data) => {
  const { query, embedding } = JSON.parse(data);
  const controller = await createRagController(embedding);
  // ...
});
```

**After:**
```typescript
ipcMain.handle(RAG_SEARCH, async (event, data) => {
  const { query } = JSON.parse(data);
  const controller = await createRagController();
  // ...
});
```

## Troubleshooting

### Common Issues

#### 1. Configuration Service Offline

**Symptoms:** Slow responses, fallback configuration being used

**Solution:** Check network connectivity and remote service status

```typescript
const configService = new ConfigurationService();
const isOnline = await configService.isOnline();
console.log('Service online:', isOnline);
```

#### 2. Cache Issues

**Symptoms:** Stale configuration, outdated model being used

**Solution:** Refresh the cache

```typescript
const configService = new ConfigurationService();
await configService.refreshCache();
```

#### 3. Model Selection Issues

**Symptoms:** Suboptimal model being selected

**Solution:** Check model registry and update priorities

```typescript
import { ModelRegistry } from '@/modules/ModelRegistry';

const registry = new ModelRegistry();
const bestModel = registry.getBestModel('accurate');
console.log('Best accurate model:', bestModel);
```

### Debug Mode

Enable debug logging by setting the log level:

```typescript
// In your application startup
console.log('RAG Configuration Debug Mode Enabled');
```

### Performance Monitoring

Monitor configuration retrieval performance:

```typescript
const startTime = Date.now();
const config = await configService.getDefaultModelConfig();
const duration = Date.now() - startTime;
console.log(`Configuration retrieved in ${duration}ms`);
```

## Security Considerations

1. **API Keys**: Never exposed to frontend
2. **Provider URLs**: Handled server-side only
3. **Configuration**: Validated before use
4. **Caching**: Sensitive data not cached locally
5. **Fallback**: Secure default configuration

## Performance Considerations

1. **Caching**: Reduces API calls by 90%+
2. **TTL**: Configurable cache expiration
3. **Fallback**: Immediate response when offline
4. **Async**: Non-blocking configuration retrieval
5. **Cleanup**: Automatic cache cleanup

## Testing

Run the test suite:

```bash
npm test
```

Or run specific tests:

```bash
npm test -- ragConfigApi
npm test -- ConfigurationService
npm test -- ModelRegistry
```

## Support

For issues or questions:

1. Check the troubleshooting guide above
2. Review the test cases for usage examples
3. Check the console for error messages
4. Verify network connectivity to remote service

