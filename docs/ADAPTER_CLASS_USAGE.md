# Adapter Class Usage in Child Processes

This document explains how to use platform-specific adapter classes in child processes for enhanced scraping capabilities.

## Overview

The system now supports passing platform-specific adapter classes to child processes, allowing them to use custom methods and logic specific to each platform while maintaining process isolation.

## Architecture

### 1. Main Process (YellowPagesProcessManager)
- Detects platform configurations with `adapter_class` field
- Extracts adapter class information (class name and module path)
- Passes this information to child processes via IPC

### 2. Child Process Adapter Factory
- Dynamically imports adapter modules
- Instantiates adapter classes
- Provides error handling and validation

### 3. Child Process Scraper
- Uses the factory to create adapter instances
- Leverages platform-specific methods
- Falls back to configuration-based approach when needed

## Usage Example

### In Main Process

```typescript
// Platform configuration with adapter class
export const Platform_192_com: PlatformConfig = {
    id: '192-com',
    name: '192.com',
    type: 'class',
    adapter_class: ComAdapter192, // Direct class reference
    // ... other configuration
};

// The YellowPagesProcessManager automatically detects this and passes:
// - adapterClass.className: "ComAdapter192"
// - adapterClass.modulePath: "@/modules/platforms/192ComAdapter"
```

### In Child Process

```typescript
import { ChildProcessScraper } from './ChildProcessScraper';

const scraper = new ChildProcessScraper();

// Initialize with platform config and adapter class info
await scraper.initialize(platformConfig, adapterClassInfo);

// Execute scraping using platform-specific methods
const results = await scraper.executeScraping(taskData);

// Check adapter capabilities
const capabilities = scraper.getAdapterCapabilities();
console.log('Adapter supports:', capabilities);
```

## Benefits

1. **Platform-Specific Logic**: Each platform can implement custom scraping strategies
2. **Process Isolation**: Adapter classes run in separate processes for stability
3. **Dynamic Loading**: Adapters are loaded only when needed
4. **Fallback Support**: Configuration-based approach when no adapter is available
5. **Type Safety**: Full TypeScript support for adapter methods

## Supported Adapter Methods

The system automatically detects and uses these methods when available:

- `searchBusinesses(keywords, location)` - Custom search implementation
- `extractBusinessData(page)` - Custom data extraction
- `handlePagination(page, maxPages)` - Custom pagination handling
- `handleSiteSpecificFeatures(page)` - Platform-specific feature handling
- `applyCookies(page, cookies)` - Custom cookie management

## Error Handling

- If adapter class cannot be loaded, falls back to configuration-based approach
- Detailed error logging for debugging
- Graceful degradation when adapter methods fail

## Configuration vs Class-Based

| Feature | Configuration-Based | Class-Based |
|---------|-------------------|-------------|
| **Complexity** | Simple selector-based | Custom logic and methods |
| **Flexibility** | Limited to selectors | Full programmatic control |
| **Performance** | Good for simple sites | Optimized for complex sites |
| **Maintenance** | Easy to update | Requires code changes |
| **Use Case** | Standard business directories | Complex platforms with anti-bot measures |

## Best Practices

1. **Use Class-Based Adapters** for:
   - Complex platforms with anti-scraping measures
   - Sites requiring custom navigation logic
   - Platforms with dynamic content loading
   - Sites with complex authentication flows

2. **Use Configuration-Based** for:
   - Simple business directory sites
   - Sites with consistent HTML structure
   - Quick platform additions
   - Standard scraping requirements

3. **Hybrid Approach**:
   - Start with configuration-based
   - Add class-based adapter when complexity increases
   - Maintain both approaches for flexibility

## Example Platform Adapter

```typescript
export class ComAdapter192 extends BasePlatformAdapter {
    
    async searchBusinesses(keywords: string[], location: string): Promise<SearchResult[]> {
        // Custom search logic for 192.com
        const searchUrl = this.buildSearchUrl(keywords, location, 1);
        // ... custom implementation
        return results;
    }
    
    async handleSiteSpecificFeatures(page: Page): Promise<void> {
        // Handle 192.com specific popups, cookies, etc.
        await this.handleCookieConsent(page);
        await this.handleLocationPopup(page);
    }
}
```

## Troubleshooting

### Common Issues

1. **Module Not Found**: Check that the module path is correct
2. **Class Not Exported**: Ensure the adapter class is properly exported
3. **Import Errors**: Verify that all dependencies are available in child process
4. **Type Mismatches**: Check that adapter extends BasePlatformAdapter

### Debug Steps

1. Check console logs for adapter creation messages
2. Verify adapter class information is passed correctly
3. Test adapter loading in isolation
4. Check child process environment and dependencies

## Future Enhancements

- Hot-reloading of adapter classes
- Adapter versioning and compatibility checking
- Performance metrics for different adapter approaches
- Automated adapter testing and validation

