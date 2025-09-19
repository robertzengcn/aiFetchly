# RAG Remote Configuration Migration Guide

## Overview

This guide helps you migrate from the old manual configuration system to the new automatic remote configuration system for RAG (Retrieval-Augmented Generation) functionality.

## What Changed

### Before (Manual Configuration)
- Frontend had to provide complete embedding configuration
- API keys and sensitive data exposed to frontend
- Tight coupling between frontend and backend configuration
- Manual model selection and provider management

### After (Automatic Configuration)
- Frontend provides no configuration
- Backend automatically selects best model
- All sensitive data handled server-side
- Loose coupling with automatic fallback

## Step-by-Step Migration

### 1. Update Frontend Code

#### Remove Configuration Parameters

**Before:**
```typescript
// Old way - manual configuration
const embeddingConfig = {
  model: 'text-embedding-3-small',
  provider: 'openai',
  apiKey: 'sk-...',
  url: 'https://api.openai.com/v1',
  dimensions: 1536,
  maxTokens: 8191,
  timeout: 30000,
  retries: 3
};

// Pass configuration to RAG functions
const result = await window.electronAPI.ragSearch({
  query: 'What is AI?',
  embedding: embeddingConfig
});
```

**After:**
```typescript
// New way - no configuration needed
const result = await window.electronAPI.ragSearch({
  query: 'What is AI?'
  // No embedding configuration needed!
});
```

#### Update IPC Calls

**Before:**
```typescript
// All RAG IPC calls required embedding configuration
const stats = await window.electronAPI.ragGetStats({
  embedding: embeddingConfig
});

const suggestions = await window.electronAPI.ragGetSuggestions({
  query: 'test',
  limit: 5,
  embedding: embeddingConfig
});
```

**After:**
```typescript
// All RAG IPC calls work without configuration
const stats = await window.electronAPI.ragGetStats();

const suggestions = await window.electronAPI.ragGetSuggestions({
  query: 'test',
  limit: 5
});
```

### 2. Update Backend Code

#### Controller Changes

**Before:**
```typescript
export class RagSearchController {
  async initialize(embeddingConfig: EmbeddingConfig): Promise<void> {
    // Manual configuration handling
    this.embeddingService = this.embeddingFactory.createEmbedding(
      embeddingConfig.provider,
      embeddingConfig
    );
  }
}
```

**After:**
```typescript
export class RagSearchController {
  async initialize(): Promise<void> {
    // Automatic configuration retrieval
    await this.ragSearchModule.initialize();
  }
}
```

#### IPC Handler Changes

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

### 3. Update Type Definitions

#### Remove EmbeddingConfig from Frontend

**Before:**
```typescript
// Frontend had access to full EmbeddingConfig
interface EmbeddingConfig {
  model: string;
  provider: string;
  apiKey?: string;
  url?: string;
  dimensions?: number;
  maxTokens?: number;
  temperature?: number;
  maxRetries?: number;
}
```

**After:**
```typescript
// Frontend no longer needs EmbeddingConfig
// All configuration is handled automatically
```

#### Update IPC Type Definitions

**Before:**
```typescript
// IPC calls included embedding configuration
interface RAGSearchRequest {
  query: string;
  options?: SearchOptions;
  embedding: EmbeddingConfig;
}
```

**After:**
```typescript
// IPC calls simplified
interface RAGSearchRequest {
  query: string;
  options?: SearchOptions;
  // No embedding configuration needed
}
```

### 4. Update Error Handling

#### Handle Configuration Errors

**Before:**
```typescript
try {
  const result = await ragSearch({
    query: 'test',
    embedding: config
  });
} catch (error) {
  if (error.message.includes('Invalid API key')) {
    // Handle API key errors
  }
}
```

**After:**
```typescript
try {
  const result = await ragSearch({
    query: 'test'
  });
} catch (error) {
  // System automatically handles configuration errors
  // Uses fallback configuration when needed
  console.error('Search failed:', error.message);
}
```

### 5. Update Testing

#### Update Test Cases

**Before:**
```typescript
describe('RAG Search', () => {
  test('should search with configuration', async () => {
    const config = {
      model: 'text-embedding-3-small',
      provider: 'openai',
      apiKey: 'test-key'
    };
    
    const result = await controller.search({
      query: 'test',
      embedding: config
    });
    
    expect(result).toBeDefined();
  });
});
```

**After:**
```typescript
describe('RAG Search', () => {
  test('should search without configuration', async () => {
    await controller.initialize(); // No config needed
    
    const result = await controller.search({
      query: 'test'
    });
    
    expect(result).toBeDefined();
  });
});
```

## Configuration Migration

### Environment Variables

**Before:**
```bash
# Required environment variables
OPENAI_API_KEY=sk-...
HUGGINGFACE_API_KEY=hf_...
OLLAMA_BASE_URL=http://localhost:11434
```

**After:**
```bash
# No frontend environment variables needed
# All configuration handled by remote service
```

### Application Configuration

**Before:**
```typescript
// Application had to manage configuration
const appConfig = {
  embedding: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY
  }
};
```

**After:**
```typescript
// No application configuration needed
// Configuration is retrieved automatically
```

## Backward Compatibility

### Gradual Migration

You can migrate gradually by:

1. **Phase 1**: Update backend to support both old and new interfaces
2. **Phase 2**: Update frontend to use new interface
3. **Phase 3**: Remove old interface support

### Temporary Compatibility Layer

```typescript
// Temporary compatibility for gradual migration
export class RagSearchController {
  async initialize(embeddingConfig?: EmbeddingConfig): Promise<void> {
    if (embeddingConfig) {
      // Old way - manual configuration
      await this.ragSearchModule.initialize(embeddingConfig);
    } else {
      // New way - automatic configuration
      await this.ragSearchModule.initialize();
    }
  }
}
```

## Common Migration Issues

### 1. Missing Configuration Parameters

**Error:** `TypeError: Cannot read property 'model' of undefined`

**Solution:** Remove embedding configuration from IPC calls

```typescript
// Before
const result = await window.electronAPI.ragSearch({
  query: 'test',
  embedding: config // Remove this
});

// After
const result = await window.electronAPI.ragSearch({
  query: 'test'
});
```

### 2. TypeScript Errors

**Error:** `Property 'embedding' does not exist on type 'RAGSearchRequest'`

**Solution:** Update type definitions

```typescript
// Remove embedding from interface
interface RAGSearchRequest {
  query: string;
  options?: SearchOptions;
  // embedding: EmbeddingConfig; // Remove this line
}
```

### 3. IPC Handler Errors

**Error:** `Cannot destructure property 'embedding' of 'undefined'`

**Solution:** Update IPC handlers

```typescript
// Before
const { query, embedding } = JSON.parse(data);

// After
const { query } = JSON.parse(data);
```

## Testing Migration

### 1. Unit Tests

Update all unit tests to remove configuration parameters:

```typescript
// Before
const controller = new RagSearchController();
await controller.initialize(mockConfig);

// After
const controller = new RagSearchController();
await controller.initialize();
```

### 2. Integration Tests

Update integration tests to work without configuration:

```typescript
// Before
const result = await ragSearch({
  query: 'test',
  embedding: testConfig
});

// After
const result = await ragSearch({
  query: 'test'
});
```

### 3. End-to-End Tests

Update E2E tests to verify automatic configuration:

```typescript
test('should work without configuration', async () => {
  const result = await page.evaluate(async () => {
    return await window.electronAPI.ragSearch({
      query: 'test query'
    });
  });
  
  expect(result).toBeDefined();
  expect(result.results).toBeDefined();
});
```

## Performance Considerations

### 1. Configuration Retrieval

The new system may have a slight delay on first use due to configuration retrieval:

```typescript
// Add loading state for first-time users
const [isInitializing, setIsInitializing] = useState(true);

useEffect(() => {
  const initializeRAG = async () => {
    try {
      await window.electronAPI.ragInitialize();
      setIsInitializing(false);
    } catch (error) {
      console.error('RAG initialization failed:', error);
      setIsInitializing(false);
    }
  };
  
  initializeRAG();
}, []);
```

### 2. Caching

The new system includes intelligent caching:

```typescript
// Configuration is cached automatically
// No need to manage cache manually
```

## Rollback Plan

If you need to rollback:

1. **Revert Code Changes**: Use git to revert to previous version
2. **Restore Configuration**: Add back embedding configuration parameters
3. **Update Frontend**: Restore manual configuration in frontend
4. **Test**: Verify all functionality works as before

## Support

For migration support:

1. **Check Logs**: Look for configuration-related errors in console
2. **Verify Network**: Ensure remote configuration service is accessible
3. **Test Fallback**: Verify fallback configuration works when offline
4. **Review Documentation**: Check API documentation for latest changes

## Migration Checklist

- [ ] Remove embedding configuration from frontend code
- [ ] Update IPC calls to remove configuration parameters
- [ ] Update backend controllers to use automatic configuration
- [ ] Update IPC handlers to work without configuration
- [ ] Update type definitions
- [ ] Update error handling
- [ ] Update unit tests
- [ ] Update integration tests
- [ ] Update end-to-end tests
- [ ] Test with remote service online
- [ ] Test with remote service offline (fallback)
- [ ] Verify performance is acceptable
- [ ] Update documentation
- [ ] Deploy and monitor

## Conclusion

The migration to automatic remote configuration provides:

- **Better Security**: No sensitive data in frontend
- **Simpler Code**: No configuration management needed
- **Better Performance**: Intelligent caching and fallback
- **Easier Maintenance**: Centralized configuration management

Follow this guide step by step to ensure a smooth migration.

