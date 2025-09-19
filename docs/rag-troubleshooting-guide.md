# RAG Remote Configuration Troubleshooting Guide

## Overview

This guide helps you diagnose and resolve common issues with the RAG Remote Configuration system. The system is designed to be robust with automatic fallback mechanisms, but understanding potential issues will help you maintain optimal performance.

## Quick Diagnosis

### Check System Status

```typescript
import { ConfigurationService } from '@/modules/ConfigurationService';

const configService = new ConfigurationService();

// Check if remote service is online
const isOnline = await configService.isOnline();
console.log('Remote service online:', isOnline);

// Get current configuration
const config = await configService.getDefaultModelConfig();
console.log('Current model:', config.model);
```

## Common Issues and Solutions

### 1. Configuration Service Offline

#### Symptoms
- Slow response times
- Console messages about fallback configuration
- Using default model instead of optimal model

#### Diagnosis
```typescript
// Check service status
const isOnline = await configService.isOnline();
if (!isOnline) {
  console.log('Remote service is offline - using fallback configuration');
}
```

#### Solutions

**Network Issues:**
```bash
# Check network connectivity
ping your-config-server.com
curl -I https://your-config-server.com/api/rag/health
```

**Service Configuration:**
```typescript
// Verify service URL in RagConfigApi
const api = new RagConfigApi();
try {
  const response = await api.isOnline();
  console.log('Service response:', response);
} catch (error) {
  console.error('Service error:', error.message);
}
```

**Fallback Configuration:**
The system automatically uses fallback configuration when offline:
```typescript
// Fallback configuration (automatic)
{
  model: 'text-embedding-3-small',
  dimensions: 1536,
  maxTokens: 8191,
  timeout: 30000,
  retries: 3
}
```

### 2. Cache Issues

#### Symptoms
- Stale configuration being used
- Model not updating after changes
- Inconsistent behavior

#### Diagnosis
```typescript
// Check cache status
const config1 = await configService.getDefaultModelConfig();
console.log('First call model:', config1.model);

// Force refresh
await configService.refreshCache();
const config2 = await configService.getDefaultModelConfig();
console.log('After refresh model:', config2.model);
```

#### Solutions

**Clear Cache:**
```typescript
// Refresh configuration cache
await configService.refreshCache();
console.log('Cache refreshed');
```

**Check Cache TTL:**
```typescript
// Default TTL is 1 hour (3600000ms)
// Cache expires automatically after TTL
```

**Manual Cache Management:**
```typescript
// If using ConfigurationCache directly
import { ConfigurationCache } from '@/modules/ConfigurationCache';

const cache = new ConfigurationCache();
cache.clear(); // Clear all cached data
```

### 3. Model Selection Issues

#### Symptoms
- Suboptimal model being selected
- Wrong model category being used
- Performance not meeting expectations

#### Diagnosis
```typescript
import { ModelRegistry } from '@/modules/ModelRegistry';

const registry = new ModelRegistry();

// Check available models
const allModels = registry.getAllModels();
console.log('Available models:', allModels.map(m => m.model));

// Check best model
const bestModel = registry.getBestModel();
console.log('Best model:', bestModel?.model);

// Check models by category
const fastModels = registry.getModelsByCategory('fast');
const accurateModels = registry.getModelsByCategory('accurate');
console.log('Fast models:', fastModels.map(m => m.model));
console.log('Accurate models:', accurateModels.map(m => m.model));
```

#### Solutions

**Update Model Priorities:**
```typescript
// Register a model with higher priority
registry.registerModel('my-model', {
  model: 'my-model',
  category: 'accurate',
  priority: 10, // Higher priority
  status: 'active',
  performance: {
    latency: 100,
    accuracy: 0.95,
    cost: 0.5,
    lastUpdated: Date.now()
  },
  description: 'My custom model',
  capabilities: ['text-embedding'],
  requirements: { minMemory: 512, minCpu: 1 }
});
```

**Set Default Model:**
```typescript
// Set specific model as default
registry.setDefaultModel('my-preferred-model');
```

### 4. Performance Issues

#### Symptoms
- Slow configuration retrieval
- High memory usage
- Timeout errors

#### Diagnosis
```typescript
// Measure configuration retrieval time
const startTime = Date.now();
const config = await configService.getDefaultModelConfig();
const duration = Date.now() - startTime;
console.log(`Configuration retrieved in ${duration}ms`);

// Check cache hit rate
const cache = new ConfigurationCache();
const stats = cache.getStats();
console.log('Cache stats:', stats);
```

#### Solutions

**Optimize Cache Settings:**
```typescript
// Use smaller cache with shorter TTL for testing
const cache = new ConfigurationCache(50, 300000); // 50 items, 5 min TTL
```

**Monitor Performance:**
```typescript
// Add performance monitoring
const performanceMonitor = {
  configRetrievals: 0,
  totalTime: 0,
  
  async getConfig() {
    const start = Date.now();
    const config = await configService.getDefaultModelConfig();
    const duration = Date.now() - start;
    
    this.configRetrievals++;
    this.totalTime += duration;
    
    console.log(`Config retrieval ${this.configRetrievals}: ${duration}ms`);
    console.log(`Average: ${this.totalTime / this.configRetrievals}ms`);
    
    return config;
  }
};
```

### 5. TypeScript Errors

#### Symptoms
- Compilation errors
- Type mismatches
- Interface not found errors

#### Common Errors

**"Property 'embedding' does not exist":**
```typescript
// Before (old interface)
const result = await ragSearch({
  query: 'test',
  embedding: config // Remove this
});

// After (new interface)
const result = await ragSearch({
  query: 'test'
});
```

**"Cannot find module '@/api/ragConfigApi'":**
```typescript
// Check import path
import { RagConfigApi } from '@/api/ragConfigApi';
// Make sure file exists at correct location
```

**"Type 'EmbeddingConfig' is not assignable":**
```typescript
// Check interface compatibility
import { EmbeddingConfig } from '@/modules/llm/EmbeddingFactory';
// Ensure using correct interface version
```

#### Solutions

**Update Type Definitions:**
```typescript
// Remove old interface references
// interface OldEmbeddingConfig { ... } // Remove

// Use new simplified interface
interface EmbeddingConfig {
  model: string;
  dimensions?: number;
  maxTokens?: number;
  timeout?: number;
  retries?: number;
}
```

**Check Import Paths:**
```typescript
// Verify all imports are correct
import { RagConfigApi } from '@/api/ragConfigApi';
import { ConfigurationService } from '@/modules/ConfigurationService';
import { ModelRegistry } from '@/modules/ModelRegistry';
```

### 6. IPC Handler Issues

#### Symptoms
- IPC calls failing
- "Cannot destructure property" errors
- Handler not responding

#### Diagnosis
```typescript
// Check IPC handler registration
console.log('RAG IPC handlers registered');

// Test individual handlers
const result = await window.electronAPI.ragInitialize();
console.log('Initialize result:', result);
```

#### Solutions

**Update IPC Handlers:**
```typescript
// Before (old handler)
ipcMain.handle(RAG_SEARCH, async (event, data) => {
  const { query, embedding } = JSON.parse(data); // Remove embedding
  // ...
});

// After (new handler)
ipcMain.handle(RAG_SEARCH, async (event, data) => {
  const { query } = JSON.parse(data);
  // ...
});
```

**Test IPC Communication:**
```typescript
// Test from renderer process
try {
  const result = await window.electronAPI.ragSearch({
    query: 'test query'
  });
  console.log('Search successful:', result);
} catch (error) {
  console.error('Search failed:', error);
}
```

### 7. Memory Issues

#### Symptoms
- High memory usage
- Memory leaks
- Application slowdown

#### Diagnosis
```typescript
// Monitor memory usage
const memoryUsage = process.memoryUsage();
console.log('Memory usage:', {
  rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
  heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
  heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB'
});
```

#### Solutions

**Clear Caches:**
```typescript
// Clear configuration cache
await configService.refreshCache();

// Clear model registry if needed
const registry = new ModelRegistry();
// Unregister unused models
registry.unregisterModel('unused-model');
```

**Optimize Cache Settings:**
```typescript
// Use smaller cache size
const cache = new ConfigurationCache(100, 1800000); // 100 items, 30 min TTL
```

### 8. Network Issues

#### Symptoms
- Connection timeouts
- Network errors
- Intermittent failures

#### Diagnosis
```typescript
// Test network connectivity
const testConnection = async () => {
  try {
    const response = await fetch('https://your-config-server.com/api/rag/health');
    console.log('Network test:', response.status);
  } catch (error) {
    console.error('Network error:', error.message);
  }
};
```

#### Solutions

**Implement Retry Logic:**
```typescript
// Add retry mechanism
const retryWithBackoff = async (fn, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
};
```

**Use Fallback Configuration:**
```typescript
// The system automatically uses fallback when network fails
// No additional configuration needed
```

## Debug Mode

### Enable Debug Logging

```typescript
// Add debug logging to ConfigurationService
const configService = new ConfigurationService();
console.log('Debug mode enabled');

// Monitor all configuration retrievals
const originalGetConfig = configService.getDefaultModelConfig.bind(configService);
configService.getDefaultModelConfig = async () => {
  console.log('Getting configuration...');
  const config = await originalGetConfig();
  console.log('Configuration retrieved:', config);
  return config;
};
```

### Performance Monitoring

```typescript
// Monitor performance metrics
const performanceMonitor = {
  startTime: Date.now(),
  configRetrievals: 0,
  cacheHits: 0,
  cacheMisses: 0,
  
  logConfigRetrieval(fromCache: boolean) {
    this.configRetrievals++;
    if (fromCache) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
    
    const hitRate = this.cacheHits / this.configRetrievals;
    console.log(`Cache hit rate: ${(hitRate * 100).toFixed(2)}%`);
  }
};
```

## Testing and Validation

### Unit Tests

```typescript
// Test configuration service
describe('ConfigurationService', () => {
  test('should return fallback config when offline', async () => {
    const configService = new ConfigurationService();
    const config = await configService.getDefaultModelConfig();
    expect(config.model).toBe('text-embedding-3-small');
  });
});
```

### Integration Tests

```typescript
// Test complete workflow
describe('RAG Integration', () => {
  test('should work without configuration', async () => {
    const controller = new RagSearchController();
    await controller.initialize();
    
    const result = await controller.search({ query: 'test' });
    expect(result).toBeDefined();
  });
});
```

## Best Practices

### 1. Error Handling

```typescript
// Always handle errors gracefully
try {
  const config = await configService.getDefaultModelConfig();
  // Use config
} catch (error) {
  console.error('Configuration error:', error);
  // System will use fallback automatically
}
```

### 2. Performance Optimization

```typescript
// Initialize early to warm up cache
const configService = new ConfigurationService();
await configService.getDefaultModelConfig(); // Warm up cache
```

### 3. Monitoring

```typescript
// Monitor system health
const healthCheck = async () => {
  const isOnline = await configService.isOnline();
  const config = await configService.getDefaultModelConfig();
  
  console.log('System health:', {
    online: isOnline,
    model: config.model,
    timestamp: new Date().toISOString()
  });
};
```

## Getting Help

### 1. Check Logs

Look for error messages in the console:
```bash
# Check application logs
tail -f /path/to/your/app.log | grep -i "rag\|config"
```

### 2. Verify Configuration

```typescript
// Verify system configuration
console.log('RAG Configuration Status:', {
  serviceOnline: await configService.isOnline(),
  currentModel: (await configService.getDefaultModelConfig()).model,
  cacheSize: cache.size()
});
```

### 3. Test Components

```typescript
// Test individual components
const api = new RagConfigApi();
const configService = new ConfigurationService();
const registry = new ModelRegistry();

// Test each component
console.log('API test:', await api.isOnline());
console.log('Config test:', await configService.getDefaultModelConfig());
console.log('Registry test:', registry.getBestModel());
```

## Conclusion

The RAG Remote Configuration system is designed to be robust and self-healing. Most issues resolve automatically through fallback mechanisms. When issues persist, use this guide to diagnose and resolve them systematically.

Remember:
- The system always provides a working configuration
- Fallback mechanisms ensure reliability
- Performance can be optimized through caching
- Monitoring helps identify issues early

