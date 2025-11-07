# Navigation to Detail Pages

This document explains how to configure and use the navigation to detail pages feature in the Yellow Pages Scraper. This feature allows you to extract comprehensive business information by navigating from listing pages to individual business detail pages.

## Overview

Many business directories only show basic information on listing/search result pages. To get comprehensive data like:
- Full business descriptions
- Detailed business hours
- Complete contact information
- Business photos and galleries
- Services and specialties
- Payment methods
- Year established
- Number of employees

You need to navigate to individual business detail pages. The navigation feature automates this process.

## Configuration

### 1. Basic Navigation Setup

Add a `navigation` section to your platform's `selectors` configuration:

```typescript
selectors: {
  // ... existing selectors ...
  
  navigation: {
    detailLink: '.business-name a, .view-details',
    required: true,
    delayAfterNavigation: 2000,
    detailPage: {
      // Detail page selectors...
    }
  }
}
```

### 2. Required Properties

- **`detailLink`**: CSS selector for the link/button that navigates to the detail page
- **`required`**: Set to `true` to enable navigation for all businesses
- **`delayAfterNavigation`**: Milliseconds to wait after navigation (default: 2000)

### 3. Detail Page Selectors

Configure selectors for data extraction on detail pages:

```typescript
detailPage: {
  businessName: 'h1.business-title',
  fullAddress: '.full-address',
  businessHours: '.hours-detailed',
  description: '.business-description',
  contactInfo: '.contact-section',
  services: '.services-list',
  photos: '.business-gallery',
  map: '.business-map',
  additionalPhone: '.phone-additional',
  additionalEmail: '.email-additional',
  socialMedia: '.social-links',
  categories: '.categories-detailed',
  yearEstablished: '.year-established',
  numberOfEmployees: '.employee-count',
  paymentMethods: '.payment-accepted',
  specialties: '.business-specialties'
}
```

## How It Works

### 1. Listing Page Extraction
The scraper first extracts basic information from the listing page using your standard selectors.

### 2. Navigation to Detail Page
For each business, the scraper:
- Finds the detail page link using `detailLink` selector
- Navigates to the detail page
- Waits for the specified delay
- Extracts enhanced data using `detailPage` selectors

### 3. Return to Listing
After extraction, the scraper:
- Navigates back to the listing page
- Waits for the business list to reload
- Continues with the next business

### 4. Data Merging
The enhanced data from the detail page is merged with the basic listing data, with detail page data taking precedence.

## Example Configuration

Here's a complete example for a platform that requires detail page navigation:

```typescript
export const Platform_example: PlatformConfig = {
  // ... basic configuration ...
  
  selectors: {
    // Basic listing page selectors
    businessList: '.business-listing',
    businessName: '.business-name',
    phone: '.phone-number',
    address: '.business-address',
    
    // Navigation configuration
    navigation: {
      detailLink: '.business-name a',
      alternatives: [
        'a[href*="/business/"]',
        '.view-details'
      ],
      required: true,
      delayAfterNavigation: 3000,
      detailPage: {
        businessName: 'h1.business-title',
        fullAddress: '.full-address',
        businessHours: '.hours-detailed',
        description: '.business-description',
        services: '.services-list',
        photos: '.business-gallery'
      }
    }
  }
};
```

## Best Practices

### 1. Selector Specificity
- Use specific selectors to avoid conflicts
- Test selectors on actual detail pages
- Provide fallback alternatives

### 2. Performance Considerations
- Set appropriate `delayAfterNavigation` values
- Consider the impact on scraping speed
- Use navigation only when necessary

### 3. Error Handling
- The scraper gracefully falls back to basic data if navigation fails
- Navigation errors are logged but don't stop the process
- Each business is processed independently

### 4. Testing
- Test navigation on a small sample first
- Verify detail page selectors work correctly
- Check that navigation back to listing works

## Troubleshooting

### Common Issues

1. **Navigation Fails**
   - Check `detailLink` selector exists on listing page
   - Verify the link has a valid `href` attribute
   - Ensure the detail page URL is accessible

2. **Detail Page Data Not Extracted**
   - Verify `detailPage` selectors exist on detail pages
   - Check if detail page requires additional waiting
   - Increase `delayAfterNavigation` if needed

3. **Can't Return to Listing**
   - Verify `businessList` selector exists on listing page
   - Check if listing page requires re-authentication
   - Ensure navigation back doesn't trigger anti-bot measures

### Debug Tips

- Enable session recording to see navigation actions
- Check console logs for navigation status
- Verify selectors work in browser dev tools
- Test navigation manually before automation

## Performance Impact

Navigation to detail pages significantly increases scraping time:
- **Without navigation**: ~1-2 seconds per business
- **With navigation**: ~5-10 seconds per business (depending on delays)

Consider using navigation only for platforms where:
- Basic listing data is insufficient
- Detail pages contain valuable information
- The additional time investment is worthwhile

## Advanced Features

### 1. Conditional Navigation
You can implement conditional navigation based on business characteristics:

```typescript
// In your adapter class
async shouldNavigateToDetail(basicData: ScrapingResult): Promise<boolean> {
  // Only navigate if basic data is incomplete
  return !basicData.description || !basicData.business_hours;
}
```

### 2. Custom Navigation Logic
Override navigation behavior in platform adapters:

```typescript
class CustomPlatformAdapter extends BasePlatformAdapter {
  async navigateToDetailPage(element: any): Promise<string | null> {
    // Custom navigation logic
    const customLink = await element.$('.custom-detail-link');
    return customLink ? await customLink.evaluate(el => el.getAttribute('href')) : null;
  }
}
```

### 3. Batch Processing
Process multiple detail pages in parallel (advanced):

```typescript
// Process multiple businesses simultaneously
const detailPages = await Promise.all(
  businessElements.map(element => this.navigateToDetailPage(element))
);
```

## Conclusion

The navigation to detail pages feature provides a powerful way to extract comprehensive business information. By carefully configuring selectors and understanding the performance implications, you can significantly enhance the quality of your scraped data.

Remember to:
- Test thoroughly before production use
- Monitor performance and adjust delays as needed
- Handle errors gracefully
- Consider the trade-off between data quality and scraping speed


