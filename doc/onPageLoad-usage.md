# onPageLoad Method Usage Guide

## Overview

The `onPageLoad` method is a new optional method in the `BasePlatformAdapter` class that allows platform-specific adapters to perform custom operations after a page is fully loaded. This method is called automatically by the child process when it exists in the adapter class.

## When is it called?

The `onPageLoad` method is called in two scenarios:

1. **After navigating to a search page** - When the scraper navigates to a search results page
2. **After navigating to a detail page** - When the scraper navigates to a business detail page

## Implementation

### 1. Extend BasePlatformAdapter

```typescript
import { Page } from 'puppeteer';
import { BasePlatformAdapter } from '@/modules/BasePlatformAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';

export class MyPlatformAdapter extends BasePlatformAdapter {
    constructor(config: PlatformConfig) {
        super(config);
    }

    // Implement other required methods...
    
    /**
     * Custom page load handling
     */
    async onPageLoad(page: Page): Promise<void> {
        // Your custom logic here
        console.log('Custom onPageLoad method called');
        
        // Example: Wait for dynamic content
        await page.waitForTimeout(2000);
        
        // Example: Handle overlays
        await this.handleOverlays(page);
        
        // Example: Wait for specific elements
        await page.waitForSelector('.business-list', { timeout: 10000 });
    }
    
    private async handleOverlays(page: Page): Promise<void> {
        // Handle cookie banners, popups, etc.
        const overlaySelectors = ['.cookie-banner', '.popup', '.modal'];
        
        for (const selector of overlaySelectors) {
            try {
                const overlay = await page.$(selector);
                if (overlay) {
                    const closeButton = await page.$(`${selector} .close`);
                    if (closeButton) {
                        await closeButton.click();
                        await page.waitForTimeout(500);
                    }
                }
            } catch (error) {
                // Ignore individual overlay errors
            }
        }
    }
}
```

### 2. Register the Adapter

Make sure your adapter class is properly registered in the `ChildProcessAdapterFactory`:

```typescript
// In ChildProcessAdapterFactory.ts
import { MyPlatformAdapter } from './MyPlatformAdapter';

export class ChildProcessAdapterFactory {
    static async createAdapter(adapterInfo: any, config: PlatformConfig): Promise<BasePlatformAdapter> {
        switch (adapterInfo.className) {
            case 'MyPlatformAdapter':
                return new MyPlatformAdapter(config);
            // ... other cases
            default:
                throw new Error(`Unknown adapter class: ${adapterInfo.className}`);
        }
    }
}
```

## Use Cases

### 1. Handling Dynamic Content

```typescript
async onPageLoad(page: Page): Promise<void> {
    // Wait for JavaScript to finish loading
    await page.waitForFunction(() => {
        return document.readyState === 'complete';
    });
    
    // Wait for specific dynamic elements
    await page.waitForSelector('.dynamic-content', { timeout: 15000 });
}
```

### 2. Managing Overlays and Popups

```typescript
async onPageLoad(page: Page): Promise<void> {
    // Handle cookie consent banners
    const cookieBanner = await page.$('.cookie-consent');
    if (cookieBanner) {
        const acceptButton = await page.$('.cookie-consent .accept');
        if (acceptButton) {
            await acceptButton.click();
            await page.waitForTimeout(1000);
        }
    }
    
    // Handle newsletter popups
    const newsletterPopup = await page.$('.newsletter-popup');
    if (newsletterPopup) {
        const closeButton = await page.$('.newsletter-popup .close');
        if (closeButton) {
            await closeButton.click();
        }
    }
}
```

### 3. Triggering Lazy Loading

```typescript
async onPageLoad(page: Page): Promise<void> {
    // Scroll to trigger lazy loading
    await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
    });
    
    // Wait for lazy-loaded content
    await page.waitForTimeout(2000);
}
```

### 4. Custom Authentication

```typescript
async onPageLoad(page: Page): Promise<void> {
    // Check if login is required
    const loginRequired = await page.$('.login-required');
    if (loginRequired) {
        // Perform custom login logic
        await this.performCustomLogin(page);
    }
}

private async performCustomLogin(page: Page): Promise<void> {
    // Your custom login implementation
    await page.type('#username', 'your-username');
    await page.type('#password', 'your-password');
    await page.click('#login-button');
    await page.waitForNavigation();
}
```

## Error Handling

The `onPageLoad` method should handle errors gracefully:

```typescript
async onPageLoad(page: Page): Promise<void> {
    try {
        // Your custom logic here
        await this.performCustomOperations(page);
    } catch (error) {
        console.warn('Error in onPageLoad method:', error);
        // Don't throw the error - this method should not fail the scraping process
        // The scraper will continue with the default flow
    }
}
```

## Best Practices

1. **Keep it lightweight** - Don't perform heavy operations that could slow down scraping
2. **Handle errors gracefully** - Use try-catch blocks and don't throw errors
3. **Use appropriate timeouts** - Don't wait indefinitely for elements
4. **Log operations** - Use console.log to track what your method is doing
5. **Be defensive** - Check if elements exist before interacting with them

## Example Implementation

See `src/modules/examples/ExamplePlatformAdapter.ts` for a complete example implementation that demonstrates all the features of the `onPageLoad` method.

## Testing

To test your `onPageLoad` implementation:

1. Create a test adapter class
2. Implement the `onPageLoad` method with console.log statements
3. Run a scraping task with your adapter
4. Check the console output for your custom logic execution

The method will be called automatically when pages are loaded, and you should see your custom logic being executed in the logs.
