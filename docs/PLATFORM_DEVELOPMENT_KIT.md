# Platform Development Kit (PDK)

The Platform Development Kit (PDK) is a comprehensive toolkit designed to simplify the process of adding new scraping platforms to the aiFetchly system. It consists of two main components: the **Platform Template Generator** and the **Platform Testing Framework**.

## Table of Contents

1. [Overview](#overview)
2. [Platform Template Generator](#platform-template-generator)
3. [Platform Testing Framework](#platform-testing-framework)
4. [Quick Start Guide](#quick-start-guide)
5. [Advanced Usage](#advanced-usage)
6. [Troubleshooting](#troubleshooting)
7. [Best Practices](#best-practices)

## Overview

The PDK provides developers with tools to:
- **Generate boilerplate platform configurations** with all required fields
- **Validate platform configurations** against live URLs
- **Test selectors and data extraction** before deployment
- **Generate comprehensive test reports** with recommendations

## Platform Template Generator

The Platform Template Generator creates boilerplate platform configuration files with all required fields and placeholder values.

### Usage

#### Interactive Mode
```bash
npm run generate-platform
```

This will prompt you for:
- Platform ID (e.g., "myplatform-com")
- Platform Name (e.g., "MyPlatform.com")
- Base URL (e.g., "https://www.myplatform.com")
- Country (e.g., "USA")
- Language (e.g., "English")
- Platform Type (configuration/class/hybrid)
- Description (optional)
- Maintainer (optional)

#### Command Line Mode
```bash
# List existing platforms
npm run generate-platform list

# Generate simple template with command line args
npm run generate-platform simple myplatform-com "MyPlatform.com" "https://www.myplatform.com"
```

### Generated Configuration Structure

The generator creates a JSON file with the following structure:

```json
{
  "id": "myplatform-com",
  "name": "MyPlatform.com",
  "display_name": "MyPlatform.com",
  "base_url": "https://www.myplatform.com",
  "country": "USA",
  "language": "English",
  "is_active": true,
  "version": "1.0.0",
  "type": "configuration",
  "rate_limit": 100,
  "delay_between_requests": 2000,
  "max_concurrent_requests": 1,
  "selectors": {
    "businessList": "div.business-list",
    "businessName": "h2.business-name",
    "phone": ".phone",
    "email": ".email",
    "website": ".website",
    "address": ".address",
    "pagination": {
      "nextButton": ".next",
      "currentPage": ".current-page",
      "maxPages": ".total-pages"
    }
  },
  "settings": {
    "requiresAuthentication": false,
    "supportsProxy": true,
    "supportsCookies": true,
    "searchUrlPattern": "https://www.myplatform.com/search?q={keywords}&page={page}",
    "resultUrlPattern": "https://www.myplatform.com{path}",
    "supportedFeatures": ["search", "pagination"]
  },
  "metadata": {
    "lastUpdated": "2024-01-01T00:00:00.000Z",
    "version": "1.0.0",
    "category": "business-directory",
    "tags": ["usa", "business-directory"],
    "statistics": {
      "totalBusinesses": 0,
      "lastScraped": "2024-01-01T00:00:00.000Z",
      "successRate": 0
    }
  },
  "description": "Platform configuration for MyPlatform.com",
  "maintainer": "Platform Development Team"
}
```

## Platform Testing Framework

The Platform Testing Framework validates platform configurations by testing selectors, pagination, and data extraction against live URLs.

### Usage

#### Basic Testing
```bash
npm run test-platform <platform-id> <target-url>
```

#### Advanced Testing
```bash
# Verbose output with detailed results
npm run test-platform myplatform-com "https://www.myplatform.com/search?q=restaurants" --verbose

# Save test report to file
npm run test-platform myplatform-com "https://www.myplatform.com/search?q=restaurants" --save-report

# Custom output directory
npm run test-platform myplatform-com "https://www.myplatform.com/search?q=restaurants" --save-report --output ./custom-reports

# Non-headless mode for debugging
npm run test-platform myplatform-com "https://www.myplatform.com/search?q=restaurants" --no-headless

# Custom timeout
npm run test-platform myplatform-com "https://www.myplatform.com/search?q=restaurants" --timeout 60000
```

### Test Categories

The framework performs the following tests:

#### 1. Basic Tests
- **URL Accessibility**: Verifies the target URL is accessible
- **Page Load**: Confirms the page loads with a title
- **Basic Structure**: Checks for basic HTML structure

#### 2. Selector Tests
- **Business List Selector**: Validates the main container selector
- **Business Name Selector**: Tests business name extraction
- **Contact Information**: Tests phone, email, website selectors
- **Address Information**: Tests address-related selectors
- **Additional Data**: Tests categories, ratings, reviews selectors

#### 3. Pagination Tests
- **Pagination Selectors**: Validates next button, current page, max pages
- **Pagination Mechanism**: Tests actual pagination functionality

#### 4. Data Extraction Tests
- **Data Extraction**: Tests extraction of sample data from the page
- **Data Quality**: Validates extracted data structure and content

### Test Report

The framework generates comprehensive test reports including:

- **Summary Statistics**: Pass/fail counts and success rates
- **Detailed Results**: Individual test results with timing
- **Category Breakdown**: Results grouped by test category
- **Recommendations**: Actionable suggestions for improvement
- **Debug Information**: Selector details and sample data

## Quick Start Guide

### Step 1: Generate a Platform Template

```bash
# Generate a new platform configuration
npm run generate-platform

# Follow the prompts to create your platform
```

### Step 2: Customize the Configuration

Edit the generated JSON file:
1. Update selectors to match the target website
2. Adjust settings for your specific needs
3. Update metadata with relevant information

### Step 3: Test the Configuration

```bash
# Test your platform configuration
npm run test-platform myplatform-com "https://www.myplatform.com/search?q=restaurants" --verbose
```

### Step 4: Iterate and Improve

Based on test results:
1. Fix failed selectors
2. Adjust pagination configuration
3. Update data extraction selectors
4. Re-test until all tests pass

## Advanced Usage

### Custom Selector Testing

The framework supports testing custom selectors:

```typescript
// In your platform configuration
{
  "selectors": {
    "businessList": "div.search-results",
    "businessName": "h3.company-name",
    "customField": ".custom-selector" // Custom fields are also tested
  }
}
```

### Platform Types

The generator supports three platform types:

1. **Configuration**: JSON-based configuration (recommended for most cases)
2. **Class**: Custom TypeScript class implementation
3. **Hybrid**: Combination of configuration and custom class

### Testing Multiple URLs

For comprehensive testing, test multiple URLs:

```bash
# Test search results page
npm run test-platform myplatform-com "https://www.myplatform.com/search?q=restaurants"

# Test individual business page
npm run test-platform myplatform-com "https://www.myplatform.com/business/123"
```

## Troubleshooting

### Common Issues

#### 1. Selectors Not Found
**Problem**: Selectors return no elements
**Solution**: 
- Use browser developer tools to inspect the page
- Verify the selector syntax
- Check if the page structure has changed

#### 2. Pagination Not Working
**Problem**: Next button not found or not clickable
**Solution**:
- Verify the next button selector
- Check if the button is visible and enabled
- Test with `--no-headless` to see the browser

#### 3. Data Extraction Failing
**Problem**: No data extracted from page
**Solution**:
- Verify business list selector
- Check individual field selectors
- Ensure the page has loaded completely

#### 4. Timeout Errors
**Problem**: Tests timeout before completion
**Solution**:
- Increase timeout with `--timeout 60000`
- Check network connectivity
- Verify the target URL is accessible

### Debug Mode

Use the `--no-headless` flag to see the browser in action:

```bash
npm run test-platform myplatform-com "https://www.myplatform.com/search?q=restaurants" --no-headless
```

### Verbose Output

Use the `--verbose` flag for detailed test information:

```bash
npm run test-platform myplatform-com "https://www.myplatform.com/search?q=restaurants" --verbose
```

## Best Practices

### 1. Selector Design

- **Use specific selectors**: Avoid generic selectors like `div`
- **Test selectors manually**: Verify in browser developer tools
- **Handle dynamic content**: Use robust selectors that work with dynamic pages
- **Consider multiple selectors**: Provide fallback selectors when possible

### 2. Configuration Management

- **Version control**: Keep platform configurations in version control
- **Documentation**: Document any special requirements or quirks
- **Testing**: Always test configurations before deployment
- **Backup**: Keep backup configurations for rollback

### 3. Testing Strategy

- **Test multiple pages**: Test different types of pages (search, detail, etc.)
- **Test edge cases**: Test with various search terms and filters
- **Monitor changes**: Regularly test configurations as websites change
- **Automate testing**: Integrate testing into your development workflow

### 4. Performance Considerations

- **Rate limiting**: Set appropriate delays between requests
- **Concurrency**: Adjust concurrent request limits
- **Timeout settings**: Set reasonable timeouts for different operations
- **Resource cleanup**: Ensure proper cleanup of browser resources

### 5. Maintenance

- **Regular updates**: Keep platform configurations up to date
- **Monitor success rates**: Track extraction success rates over time
- **Handle website changes**: Update configurations when websites change
- **Community feedback**: Share improvements with the community

## Integration with Platform Registry

The PDK integrates seamlessly with the Platform Registry:

```typescript
import { PlatformRegistry } from '@/modules/PlatformRegistry'
import { PlatformTestingFramework } from '@/modules/PlatformTestingFramework'

// Register a new platform
const registry = new PlatformRegistry()
await registry.registerPlatform(platformConfig)

// Test the platform
const framework = new PlatformTestingFramework()
const report = await framework.runTests(platformId, targetUrl)
```

## Examples

### Example 1: Basic Platform Configuration

```json
{
  "id": "yellowpages-com",
  "name": "YellowPages.com",
  "base_url": "https://www.yellowpages.com",
  "country": "USA",
  "language": "English",
  "selectors": {
    "businessList": "div.search-results .result",
    "businessName": "h3.n a",
    "phone": ".phones .phone",
    "address": ".street-address"
  }
}
```

### Example 2: Advanced Platform Configuration

```json
{
  "id": "yelp-com",
  "name": "Yelp.com",
  "base_url": "https://www.yelp.com",
  "country": "USA",
  "language": "English",
  "selectors": {
    "businessList": "div[data-testid='serp-ia-card']",
    "businessName": "h3 a[data-testid='business-link']",
    "rating": ".five-stars",
    "reviewCount": ".review-count"
  },
  "settings": {
    "requiresAuthentication": false,
    "supportsProxy": true,
    "searchUrlPattern": "https://www.yelp.com/search?find_desc={keywords}&find_loc={location}"
  }
}
```

## Support

For issues and questions:

1. Check the troubleshooting section above
2. Review the test reports for specific error messages
3. Use verbose mode for detailed debugging information
4. Test with non-headless mode to see the browser behavior

## Contributing

To contribute to the PDK:

1. Test your changes thoroughly
2. Update documentation as needed
3. Follow the existing code patterns
4. Add tests for new functionality
5. Submit pull requests with detailed descriptions

---

The Platform Development Kit is designed to make platform development faster, more reliable, and more maintainable. By following these guidelines and using the provided tools, you can create robust platform configurations that work reliably in production.
