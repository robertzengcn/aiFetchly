# Gelbeseiten.de Platform Adapter

## Overview

The `AdapterGelbeseiten` is a specialized platform adapter for scraping business data from [gelbeseiten.de](https://www.gelbeseiten.de), a popular German business directory website. This adapter extends the `BasePlatformAdapter` class and implements custom logic for handling German business directory site-specific features.

## Features

### 🍪 Cookie Consent Handling
- Automatically detects and accepts cookie consent dialogs
- Supports multiple German cookie consent selectors
- Handles GDPR compliance popups common on German sites

### 📍 Location Services
- Automatically accepts location permission requests
- Handles location popups that are common on German business sites
- Supports multiple location acceptance selector patterns

### 🇩🇪 German Language Support
- Handles German language selection if present
- Supports German-specific UI elements and text patterns
- Optimized for German business directory structure

### 🏢 Business Data Extraction
- **Business Names**: Extracts company names with multiple selector fallbacks
- **Phone Numbers**: Handles German phone number formats
- **Addresses**: Parses German address format (Street, Postal Code City, State)
- **Categories**: Extracts business categories and sectors
- **Ratings**: Handles German rating system (e.g., "4,5 Sterne")
- **Reviews**: Extracts review counts and ratings
- **Website URLs**: Finds company websites and homepages
- **Email Addresses**: Extracts contact email addresses
- **Business Hours**: Captures opening hours (Öffnungszeiten)
- **Descriptions**: Extracts business descriptions and summaries

### 📄 Pagination Support
- Handles German pagination controls
- Supports multiple pagination selector patterns
- Automatic page navigation with configurable limits

## Usage

### Basic Configuration

```typescript
import { AdapterGelbeseiten } from '@/modules/platforms/GelbeseitenAdapter';
import { PlatformConfig } from '@/interfaces/IPlatformConfig';

const config: PlatformConfig = {
    baseUrl: 'https://www.gelbeseiten.de',
    searchEndpoint: '/suche',
    maxPages: 5,
    delayBetweenRequests: 1000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

const adapter = new AdapterGelbeseiten(config);
```

### Using with PlatformAdapterFactory

```typescript
import { PlatformAdapterFactory } from '@/modules/platforms/PlatformAdapterFactory';

const adapter = PlatformAdapterFactory.createAdapter('AdapterGelbeseiten', config);
```

### Available Methods

#### `onPageLoad(page: Page): Promise<void>`
Handles initial page setup including cookie consent and location popups.

#### `extractBusinessData(page: Page): Promise<BusinessData>`
Extracts business information from search results pages.

#### `handlePagination(page: Page, maxPages: number): Promise<void>`
Manages pagination through search results.

#### `applyCookies(page: Page, cookies: any): Promise<void>`
Applies stored cookies to maintain session state.

#### `handleSiteSpecificFeatures(page: Page): Promise<void>`
Handles gelbeseiten.de specific features like language selection.

## German-Specific Features

### Address Parsing
The adapter is optimized for German address formats:
- **Format**: Street, Postal Code City, State
- **Postal Code**: 5-digit German postal codes
- **Country**: Automatically set to "Germany"

### Rating System
Supports German rating formats:
- **German**: "4,5 Sterne" (comma as decimal separator)
- **International**: "4.5/5" (dot as decimal separator)
- **Range**: 0-5 scale

### Business Categories
Extracts German business terminology:
- **Branche**: Business sector/industry
- **Kategorie**: Business category
- **Geschäftsbereich**: Business area

## Selector Strategy

The adapter uses a robust selector strategy with multiple fallbacks:

1. **Primary Selectors**: Site-specific selectors for gelbeseiten.de
2. **Generic Selectors**: Common business directory patterns
3. **German Selectors**: German language-specific patterns
4. **Fallback Selectors**: Universal patterns as last resort

This ensures maximum compatibility even if the site structure changes.

## Error Handling

- **Graceful Degradation**: Continues operation even if some elements aren't found
- **Selector Fallbacks**: Multiple selector attempts for each data type
- **Timeout Handling**: Configurable timeouts with fallback behavior
- **Logging**: Comprehensive logging for debugging and monitoring

## Testing

The adapter includes comprehensive tests covering:
- Instance creation and inheritance
- German address parsing
- German rating parsing
- Error handling scenarios

Run tests with:
```bash
npm test -- src/modules/platforms/GelbeseitenAdapter.test.ts
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | string | - | Base URL for gelbeseiten.de |
| `searchEndpoint` | string | - | Search endpoint path |
| `maxPages` | number | 5 | Maximum pages to scrape |
| `delayBetweenRequests` | number | 1000 | Delay between requests (ms) |
| `userAgent` | string | - | User agent string for requests |

## Dependencies

- **BasePlatformAdapter**: Core platform adapter functionality
- **Puppeteer**: Web scraping and automation
- **TypeScript**: Type safety and development experience

## Browser Compatibility

The adapter is designed to work with:
- Modern web browsers
- German language websites
- GDPR-compliant cookie handling
- Location-aware business services

## Troubleshooting

### Common Issues

1. **Cookie Consent Not Found**: Check if the site structure has changed
2. **Location Popup Not Handled**: Verify location selector patterns
3. **Data Extraction Fails**: Review selector fallbacks and site structure
4. **Pagination Issues**: Check pagination selector patterns

### Debug Mode

Enable detailed logging by setting log level to debug in your configuration.

## Contributing

When contributing to this adapter:

1. **Test with Real Data**: Always test with actual gelbeseiten.de pages
2. **Update Selectors**: Keep selectors current with site changes
3. **German Localization**: Maintain German language support
4. **Error Handling**: Add robust error handling for new features

## License

This adapter is part of the aiFetchly project and follows the same licensing terms.
