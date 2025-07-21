# Browser Manager

A utility module for managing Puppeteer browser detection, installation, and configuration.

## Quick Start

```typescript
import { browserManager } from './browserManager';
import * as puppeteer from 'puppeteer';

// Get browser info and launch options
const browserInfo = await browserManager.getBrowserInfo();
const launchOptions = await browserManager.createLaunchOptions({
    headless: false
});

// Launch browser
const browser = await puppeteer.launch(launchOptions);
const page = await browser.newPage();
await browser.close();
```

## Features

- **Automatic Browser Detection**: Finds Chrome in cache, system, or downloads if needed
- **Fallback Strategy**: Multiple fallback mechanisms for robust operation
- **Cross-Platform**: Works on macOS, Linux, and Windows
- **Reusable**: Can be used across different parts of your application

## API

### Default Instance
```typescript
import { browserManager } from './browserManager';

// Get browser information
const info = await browserManager.getBrowserInfo();

// Create launch options
const options = await browserManager.createLaunchOptions(customOptions);
```

### Custom Instance
```typescript
import { BrowserManager } from './browserManager';

const manager = new BrowserManager({
    chromeBuildId: '120.0.6099.109',
    localBrowserPath: '/path/to/chrome'
});

const options = await manager.createLaunchOptions();
```

## Environment Variables

- `LOCAL_BROWSER_EXCUTE_PATH`: Path to local Chrome installation

## Fallback Strategy

1. Local browser path (from environment)
2. Cached Chrome installation
3. Download and install Chrome
4. System Chrome installation
5. Puppeteer bundled Chrome

## Examples

See `browserManagerExample.ts` for detailed usage examples. 