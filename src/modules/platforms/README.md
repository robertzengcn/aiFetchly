# Platform Adapters Factory

This directory contains platform-specific adapters for different business directory websites and a factory class to create them without dynamic imports.

## Overview

The `PlatformAdapterFactory` provides a static factory method approach to create platform adapters, which is more suitable for child processes that are built into JavaScript files. This avoids the need for dynamic imports that can cause issues in bundled environments.

## Available Adapters

- `ExampleHybridAdapter` - Example hybrid platform adapter
- `ComAdapter192` - 192.com (UK) platform adapter
<!-- - `YellComAdapter` - Yell.com (UK) platform adapter -->
- `YellowPagesComAdapter` - YellowPages.com platform adapter
- `YelpComAdapter` - Yelp.com platform adapter
- `YellowPagesCaAdapter` - YellowPages.ca platform adapter
- `ExampleClassBasedAdapter` - Example class-based platform adapter

## Usage

### Basic Usage

```typescript
import { PlatformAdapterFactory } from '@/modules/platforms';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';

// Create an adapter instance
const config: PlatformConfig = {
    id: "yelp-example",
    name: "Yelp",
    // ... other config properties
};

const adapter = PlatformAdapterFactory.createAdapter('YelpComAdapter', config);
```

### Check Availability

```typescript
// Check if an adapter class is available
const isAvailable = PlatformAdapterFactory.isAdapterAvailable('YelpComAdapter');

// Get all available adapter class names
const availableAdapters = PlatformAdapterFactory.getAvailableAdapters();
```

### Get Adapter Class Constructor

```typescript
// Get the adapter class constructor
const AdapterClass = PlatformAdapterFactory.getAdapterClass('YelpComAdapter');
const adapter = new AdapterClass(config);
```

## Migration from Dynamic Imports

### Before (Dynamic Import)
```typescript
// Old approach - dynamic import
const module = await import(adapterClassInfo.modulePath);
const AdapterClass = module[adapterClassInfo.className];
const adapter = new AdapterClass(platformConfig);
```

### After (Factory Method)
```typescript
// New approach - factory method
const adapter = PlatformAdapterFactory.createAdapter(adapterClassInfo.className, platformConfig);
```

## Benefits

1. **No Dynamic Imports**: Avoids issues with bundlers and child processes
2. **Type Safety**: Full TypeScript support with proper type checking
3. **Performance**: Direct class instantiation without module loading overhead
4. **Maintainability**: Centralized adapter creation logic
5. **Bundling Friendly**: Works well with tools like Vite, Webpack, and Rollup

## Adding New Adapters

To add a new platform adapter:

1. Create your adapter class extending `BasePlatformAdapter`
2. Add the class to the `PlatformAdapterFactory.createAdapter()` method
3. Add the class name to the `isAdapterAvailable()` and `getAvailableAdapters()` methods
4. Add the class to the `getAdapterClass()` method
5. Export the class from `index.ts`

Example:
```typescript
// In PlatformAdapterFactory.ts
case 'NewPlatformAdapter':
    return new NewPlatformAdapter(platformConfig);

// In index.ts
export { NewPlatformAdapter } from './NewPlatformAdapter';
```
