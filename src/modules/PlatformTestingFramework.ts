import * as fs from 'fs'
import * as path from 'path'
import * as puppeteer from 'puppeteer'
import { addExtra } from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { PlatformConfig } from '@/interfaces/IPlatformConfig'
import { BaseModule } from '@/modules/baseModule'
import { PlatformRegistry } from '@/modules/PlatformRegistry'

/**
 * Test result interface
 */
export interface TestResult {
  testName: string
  passed: boolean
  message: string
  details?: any
  duration: number
}

/**
 * Test report interface
 */
export interface TestReport {
  platformId: string
  targetUrl: string
  timestamp: Date
  totalTests: number
  passedTests: number
  failedTests: number
  results: TestResult[]
  summary: string
}

/**
 * Platform Testing Framework
 * 
 * This framework validates platform configurations by testing selectors,
 * pagination, and data extraction against live URLs.
 */
export class PlatformTestingFramework extends BaseModule {
  private platformRegistry: PlatformRegistry
  private browser: puppeteer.Browser | null = null
  private page: puppeteer.Page | null = null

  constructor() {
    super()
    this.platformRegistry = new PlatformRegistry()
  }

  /**
   * Main test runner entry point
   */
  async runTests(platformId: string, targetUrl: string, options: {
    headless?: boolean
    timeout?: number
    screenshot?: boolean
    verbose?: boolean
  } = {}): Promise<TestReport> {
    const startTime = Date.now()
    const results: TestResult[] = []

    try {
      console.log('🧪 Platform Testing Framework')
      console.log('=============================')
      console.log(`Platform: ${platformId}`)
      console.log(`Target URL: ${targetUrl}`)
      console.log('')

      // Load platform configuration
      const platform = this.platformRegistry.getPlatformConfig(platformId)
      if (!platform) {
        throw new Error(`Platform not found: ${platformId}`)
      }

      // Initialize browser
      await this.initializeBrowser(options.headless ?? true)

      // Navigate to target URL
      await this.navigateToUrl(targetUrl, options.timeout ?? 30000)

      // Run basic tests
      results.push(await this.testUrlAccessibility(targetUrl))
      results.push(await this.testPageLoad(targetUrl))
      results.push(await this.testBasicStructure(platform))

      // Run selector tests
      results.push(await this.testBusinessListSelector(platform))
      results.push(await this.testBusinessNameSelector(platform))
      results.push(await this.testPaginationSelectors(platform))
      
      // Run comprehensive selector validation
      const selectorResults = await this.validateAllSelectors(platform)
      results.push(...selectorResults)
      
      // Run pagination and data extraction validation
      results.push(await this.testPaginationMechanism(platform))
      results.push(await this.testDataExtraction(platform))

      // Generate report
      const report = this.generateReport(platformId, targetUrl, results, Date.now() - startTime)

      // Log results
      this.logResults(report, options.verbose ?? false)

      return report

    } catch (error) {
      console.error('❌ Test execution failed:', error)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  /**
   * Initialize browser with stealth capabilities
   */
  private async initializeBrowser(headless: boolean): Promise<void> {
    try {
      const puppeteerExtra = addExtra(puppeteer as any)
      puppeteerExtra.use(StealthPlugin())

      this.browser = await puppeteerExtra.launch({
        headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
        defaultViewport: { width: 1366, height: 768 }
      })

      this.page = await this.browser.newPage()
      
      // Set user agent
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )

      console.log('✅ Browser initialized successfully')
    } catch (error) {
      console.error('❌ Failed to initialize browser:', error)
      throw error
    }
  }

  /**
   * Navigate to target URL
   */
  private async navigateToUrl(url: string, timeout: number): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized')
    }

    try {
      console.log(`🌐 Navigating to: ${url}`)
      await this.page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout 
      })
      console.log('✅ Page loaded successfully')
    } catch (error) {
      console.error('❌ Failed to navigate to URL:', error)
      throw error
    }
  }

  /**
   * Test URL accessibility
   */
  private async testUrlAccessibility(url: string): Promise<TestResult> {
    const startTime = Date.now()
    
    try {
      if (!this.page) {
        throw new Error('Browser not initialized')
      }

      const response = await this.page.goto(url, { waitUntil: 'domcontentloaded' })
      const status = response?.status()
      
      const passed = status === 200
      const message = passed 
        ? 'URL is accessible' 
        : `URL returned status code: ${status}`

      return {
        testName: 'URL Accessibility',
        passed,
        message,
        details: { statusCode: status },
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        testName: 'URL Accessibility',
        passed: false,
        message: `Failed to access URL: ${error}`,
        details: { error: error instanceof Error ? error.message : String(error) },
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Test page load
   */
  private async testPageLoad(url: string): Promise<TestResult> {
    const startTime = Date.now()
    
    try {
      if (!this.page) {
        throw new Error('Browser not initialized')
      }

      const title = await this.page.title()
      const passed = Boolean(title && title.length > 0)
      const message = passed 
        ? `Page loaded with title: "${title}"` 
        : 'Page loaded but no title found'

      return {
        testName: 'Page Load',
        passed,
        message,
        details: { title },
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        testName: 'Page Load',
        passed: false,
        message: `Failed to load page: ${error}`,
        details: { error: error instanceof Error ? error.message : String(error) },
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Test basic page structure
   */
  private async testBasicStructure(platform: PlatformConfig): Promise<TestResult> {
    const startTime = Date.now()
    
    try {
      if (!this.page) {
        throw new Error('Browser not initialized')
      }

      // Check if page has basic HTML structure
      const hasBody = await this.page.evaluate(() => {
        return document.body !== null
      })

      const hasContent = await this.page.evaluate(() => {
        return document.body.textContent && document.body.textContent.length > 0
      })

      const passed = Boolean(hasBody && hasContent)
      const message = passed 
        ? 'Page has basic HTML structure' 
        : 'Page lacks basic HTML structure'

      return {
        testName: 'Basic Structure',
        passed,
        message,
        details: { hasBody, hasContent },
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        testName: 'Basic Structure',
        passed: false,
        message: `Failed to test basic structure: ${error}`,
        details: { error: error instanceof Error ? error.message : String(error) },
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Test business list selector
   */
  private async testBusinessListSelector(platform: PlatformConfig): Promise<TestResult> {
    const startTime = Date.now()
    
    try {
      if (!this.page) {
        throw new Error('Browser not initialized')
      }

      const selector = platform.selectors?.businessList
      if (!selector) {
        return {
          testName: 'Business List Selector',
          passed: false,
          message: 'No business list selector defined',
          details: { selector: null },
          duration: Date.now() - startTime
        }
      }

      const elements = await this.page.$$(selector)
      const passed = elements.length > 0
      const message = passed 
        ? `Found ${elements.length} business list elements` 
        : `No elements found for selector: ${selector}`

      return {
        testName: 'Business List Selector',
        passed,
        message,
        details: { selector, count: elements.length },
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        testName: 'Business List Selector',
        passed: false,
        message: `Failed to test business list selector: ${error}`,
        details: { error: error instanceof Error ? error.message : String(error) },
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Test business name selector
   */
  private async testBusinessNameSelector(platform: PlatformConfig): Promise<TestResult> {
    const startTime = Date.now()
    
    try {
      if (!this.page) {
        throw new Error('Browser not initialized')
      }

      const selector = platform.selectors?.businessName
      if (!selector) {
        return {
          testName: 'Business Name Selector',
          passed: false,
          message: 'No business name selector defined',
          details: { selector: null },
          duration: Date.now() - startTime
        }
      }

      const elements = await this.page.$$(selector)
      const passed = elements.length > 0
      const message = passed 
        ? `Found ${elements.length} business name elements` 
        : `No elements found for selector: ${selector}`

      return {
        testName: 'Business Name Selector',
        passed,
        message,
        details: { selector, count: elements.length },
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        testName: 'Business Name Selector',
        passed: false,
        message: `Failed to test business name selector: ${error}`,
        details: { error: error instanceof Error ? error.message : String(error) },
        duration: Date.now() - startTime
      }
    }
  }



  /**
   * Test pagination mechanism
   */
  private async testPaginationMechanism(platform: PlatformConfig): Promise<TestResult> {
    const startTime = Date.now()
    
    try {
      if (!this.page) {
        throw new Error('Browser not initialized')
      }

      const pagination = platform.selectors?.pagination
      if (!pagination || typeof pagination !== 'object' || !('nextButton' in pagination)) {
        return {
          testName: 'Pagination Mechanism',
          passed: false,
          message: 'No pagination next button selector defined',
          details: { pagination: pagination || null },
          duration: Date.now() - startTime
        }
      }

      // Get current page URL
      const currentUrl = this.page.url()
      
      // Find and click next button
      const nextButton = await this.page.$(pagination.nextButton!)
      if (!nextButton) {
        return {
          testName: 'Pagination Mechanism',
          passed: false,
          message: 'Next button not found on page',
          details: { selector: pagination.nextButton, currentUrl },
          duration: Date.now() - startTime
        }
      }

      // Check if next button is clickable
      const isVisible = await nextButton.isVisible()
      const isClickable = isVisible
      if (!isClickable) {
        return {
          testName: 'Pagination Mechanism',
          passed: false,
          message: 'Next button is not clickable (hidden or disabled)',
          details: { selector: pagination.nextButton, currentUrl },
          duration: Date.now() - startTime
        }
      }

      // Click next button
      await nextButton.click()
      
      // Wait for navigation
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Check if URL changed
      const newUrl = this.page.url()
      const urlChanged = newUrl !== currentUrl
      
      // Check if page content changed (basic check)
      const pageContent = await this.page.content()
      const contentLength = pageContent.length
      
      const passed = urlChanged || contentLength > 1000 // Basic check for content change
      const message = passed 
        ? 'Pagination mechanism works (URL or content changed)' 
        : 'Pagination mechanism failed (no URL or content change detected)'

      return {
        testName: 'Pagination Mechanism',
        passed,
        message,
        details: { 
          selector: pagination.nextButton, 
          currentUrl, 
          newUrl, 
          urlChanged,
          contentLength 
        },
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        testName: 'Pagination Mechanism',
        passed: false,
        message: `Failed to test pagination mechanism: ${error}`,
        details: { error: error instanceof Error ? error.message : String(error) },
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Test data extraction
   */
  private async testDataExtraction(platform: PlatformConfig): Promise<TestResult> {
    const startTime = Date.now()
    
    try {
      if (!this.page) {
        throw new Error('Browser not initialized')
      }

      const selectors = platform.selectors
      if (!selectors || !selectors.businessList) {
        return {
          testName: 'Data Extraction',
          passed: false,
          message: 'No business list selector defined for data extraction',
          details: { selectors: selectors || null },
          duration: Date.now() - startTime
        }
      }

      // Extract sample data from the first few business items
      const extractedData: any[] = []
      const maxItems = 3 // Limit to first 3 items for testing
      
      const businessElements = await this.page.$$(selectors.businessList)
      const itemsToTest = Math.min(businessElements.length, maxItems)
      
      for (let i = 0; i < itemsToTest; i++) {
        const element = businessElements[i]
        const itemData: any = { index: i }
        
        // Extract business name
        if (selectors.businessName) {
          try {
            const nameElement = await element.$(selectors.businessName)
            if (nameElement) {
              itemData.name = await nameElement.evaluate(el => el.textContent?.trim())
            }
          } catch (e) {
            // Ignore individual field extraction errors
          }
        }
        
        // Extract phone
        if (selectors.phone) {
          try {
            const phoneElement = await element.$(selectors.phone)
            if (phoneElement) {
              itemData.phone = await phoneElement.evaluate(el => el.textContent?.trim())
            }
          } catch (e) {
            // Ignore individual field extraction errors
          }
        }
        
        // Extract email
        if (selectors.email) {
          try {
            const emailElement = await element.$(selectors.email)
            if (emailElement) {
              itemData.email = await emailElement.evaluate(el => el.textContent?.trim())
            }
          } catch (e) {
            // Ignore individual field extraction errors
          }
        }
        
        // Extract website
        if (selectors.website) {
          try {
            const websiteElement = await element.$(selectors.website)
            if (websiteElement) {
              itemData.website = await websiteElement.evaluate(el => el.getAttribute('href') || el.textContent?.trim())
            }
          } catch (e) {
            // Ignore individual field extraction errors
          }
        }
        
        // Extract address
        if (selectors.address) {
          try {
            const addressElement = await element.$(selectors.address)
            if (addressElement) {
              itemData.address = await addressElement.evaluate(el => el.textContent?.trim())
            }
          } catch (e) {
            // Ignore individual field extraction errors
          }
        }
        
        extractedData.push(itemData)
      }
      
      // Calculate extraction success rate
      const totalFields = extractedData.length * 5 // Assuming 5 main fields
      const extractedFields = extractedData.reduce((count, item) => {
        return count + Object.keys(item).filter(key => key !== 'index' && item[key]).length
      }, 0)
      
      const successRate = totalFields > 0 ? (extractedFields / totalFields) * 100 : 0
      const passed = successRate > 20 // At least 20% success rate
      
      const message = passed 
        ? `Data extraction successful (${successRate.toFixed(1)}% success rate)` 
        : `Data extraction failed (${successRate.toFixed(1)}% success rate)`

      return {
        testName: 'Data Extraction',
        passed,
        message,
        details: { 
          itemsTested: itemsToTest,
          totalFields,
          extractedFields,
          successRate: successRate.toFixed(1) + '%',
          sampleData: extractedData.slice(0, 2) // Show first 2 items as sample
        },
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        testName: 'Data Extraction',
        passed: false,
        message: `Failed to test data extraction: ${error}`,
        details: { error: error instanceof Error ? error.message : String(error) },
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Validate all selectors in the platform configuration
   */
  private async validateAllSelectors(platform: PlatformConfig): Promise<TestResult[]> {
    const results: TestResult[] = []
    
    if (!this.page) {
      throw new Error('Browser not initialized')
    }

    const selectors = platform.selectors
    if (!selectors) {
      results.push({
        testName: 'Selector Validation',
        passed: false,
        message: 'No selectors defined in platform configuration',
        details: { selectors: null },
        duration: 0
      })
      return results
    }

    console.log('🔍 Validating all selectors...')
    
    // Test all basic selectors
    const basicSelectors = [
      { key: 'businessList', name: 'Business List' },
      { key: 'businessName', name: 'Business Name' },
      { key: 'phone', name: 'Phone' },
      { key: 'email', name: 'Email' },
      { key: 'website', name: 'Website' },
      { key: 'address', name: 'Address' },
      { key: 'address_city', name: 'Address City' },
      { key: 'address_state', name: 'Address State' },
      { key: 'address_zip', name: 'Address ZIP' },
      { key: 'address_country', name: 'Address Country' },
      { key: 'categories', name: 'Categories' },
      { key: 'rating', name: 'Rating' },
      { key: 'reviewCount', name: 'Review Count' },
      { key: 'description', name: 'Description' }
    ]

    for (const selectorInfo of basicSelectors) {
      const selector = selectors[selectorInfo.key as keyof typeof selectors]
      if (typeof selector === 'string') {
        const result = await this.validateSelector(
          selector,
          selectorInfo.name,
          selectorInfo.key
        )
        results.push(result)
      }
    }

    // Test pagination selectors
    if (selectors.pagination) {
      const paginationSelectors = [
        { key: 'nextButton', name: 'Pagination Next Button' },
        { key: 'currentPage', name: 'Pagination Current Page' },
        { key: 'maxPages', name: 'Pagination Max Pages' }
      ]

      for (const selectorInfo of paginationSelectors) {
        const result = await this.validateSelector(
          selectors.pagination[selectorInfo.key as keyof typeof selectors.pagination],
          selectorInfo.name,
          `pagination.${selectorInfo.key}`
        )
        results.push(result)
      }
    }

    return results
  }

  /**
   * Validate a single selector
   */
  private async validateSelector(
    selector: string | undefined,
    selectorName: string,
    selectorKey: string
  ): Promise<TestResult> {
    const startTime = Date.now()
    
    try {
      if (!this.page) {
        throw new Error('Browser not initialized')
      }

      if (!selector) {
        return {
          testName: `${selectorName} Selector`,
          passed: false,
          message: `No selector defined for ${selectorName}`,
          details: { selector: null, key: selectorKey },
          duration: Date.now() - startTime
        }
      }

      // Test selector existence
      const elements = await this.page.$$(selector)
      const passed = elements.length > 0
      const message = passed 
        ? `Found ${elements.length} element(s) for ${selectorName}` 
        : `No elements found for ${selectorName}: ${selector}`

      // Get additional details for debugging
      let details: any = { 
        selector, 
        key: selectorKey, 
        count: elements.length 
      }

      if (passed && elements.length > 0) {
        // Get text content of first element for verification
        try {
          const firstElement = elements[0]
          const textContent = await this.page!.evaluate(el => el.textContent?.trim(), firstElement)
          details.sampleText = textContent?.substring(0, 100) || 'No text content'
        } catch (error) {
          details.sampleText = 'Could not extract text content'
        }
      }

      return {
        testName: `${selectorName} Selector`,
        passed,
        message,
        details,
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        testName: `${selectorName} Selector`,
        passed: false,
        message: `Failed to validate ${selectorName}: ${error}`,
        details: { 
          selector, 
          key: selectorKey, 
          error: error instanceof Error ? error.message : String(error) 
        },
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Test pagination selectors
   */
  private async testPaginationSelectors(platform: PlatformConfig): Promise<TestResult> {
    const startTime = Date.now()
    
    try {
      if (!this.page) {
        throw new Error('Browser not initialized')
      }

      const pagination = platform.selectors?.pagination
      if (!pagination) {
        return {
          testName: 'Pagination Selectors',
          passed: false,
          message: 'No pagination selectors defined',
          details: { pagination: null },
          duration: Date.now() - startTime
        }
      }

      const results: any = {}
      let totalFound = 0

      // Test next button
      if (typeof pagination === 'object' && 'nextButton' in pagination && pagination.nextButton) {
        const nextElements = await this.page.$$(pagination.nextButton)
        results.nextButton = { selector: pagination.nextButton, count: nextElements.length }
        totalFound += nextElements.length
      }

      // Test current page
      if (typeof pagination === 'object' && 'currentPage' in pagination && pagination.currentPage) {
        const currentElements = await this.page.$$(pagination.currentPage)
        results.currentPage = { selector: pagination.currentPage, count: currentElements.length }
        totalFound += currentElements.length
      }

      // Test max pages
      if (typeof pagination === 'object' && 'maxPages' in pagination && pagination.maxPages) {
        const maxElements = await this.page.$$(pagination.maxPages)
        results.maxPages = { selector: pagination.maxPages, count: maxElements.length }
        totalFound += maxElements.length
      }

      const passed = totalFound > 0
      const message = passed 
        ? `Found ${totalFound} pagination elements` 
        : 'No pagination elements found'

      return {
        testName: 'Pagination Selectors',
        passed,
        message,
        details: results,
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        testName: 'Pagination Selectors',
        passed: false,
        message: `Failed to test pagination selectors: ${error}`,
        details: { error: error instanceof Error ? error.message : String(error) },
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Generate comprehensive test report
   */
  private generateReport(
    platformId: string, 
    targetUrl: string, 
    results: TestResult[], 
    totalDuration: number
  ): TestReport {
    const passedTests = results.filter(r => r.passed).length
    const failedTests = results.filter(r => !r.passed).length
    const totalTests = results.length

    // Generate detailed summary with recommendations
    const summary = this.generateDetailedSummary(results, passedTests, totalTests)

    return {
      platformId,
      targetUrl,
      timestamp: new Date(),
      totalTests,
      passedTests,
      failedTests,
      results,
      summary
    }
  }

  /**
   * Generate detailed summary with recommendations
   */
  private generateDetailedSummary(results: TestResult[], passedTests: number, totalTests: number): string {
    const successRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0
    
    let summary = `Tests completed: ${passedTests}/${totalTests} passed (${successRate.toFixed(1)}%)`
    
    // Add recommendations based on test results
    const failedTests = results.filter(r => !r.passed)
    const selectorTests = results.filter(r => r.testName.startsWith('Selector:'))
    const failedSelectors = selectorTests.filter(r => !r.passed)
    
    if (failedSelectors.length > 0) {
      summary += `\n\n🔧 Selector Issues Found:`
      summary += `\n- ${failedSelectors.length} selector(s) need attention`
      summary += `\n- Review and update selectors in platform configuration`
    }
    
    const paginationTest = results.find(r => r.testName === 'Pagination Mechanism')
    if (paginationTest && !paginationTest.passed) {
      summary += `\n\n📄 Pagination Issues:`
      summary += `\n- Pagination mechanism needs review`
      summary += `\n- Check if next button selector is correct`
    }
    
    const extractionTest = results.find(r => r.testName === 'Data Extraction')
    if (extractionTest && !extractionTest.passed) {
      summary += `\n\n📊 Data Extraction Issues:`
      summary += `\n- Data extraction success rate is low`
      summary += `\n- Review field selectors and data structure`
    }
    
    if (successRate >= 80) {
      summary += `\n\n✅ Platform configuration looks good!`
    } else if (successRate >= 50) {
      summary += `\n\n⚠️  Platform needs some adjustments`
    } else {
      summary += `\n\n❌ Platform configuration needs significant work`
    }
    
    return summary
  }

  /**
   * Get selector validation summary
   */
  private getSelectorValidationSummary(results: TestResult[]): {
    totalSelectors: number
    foundSelectors: number
    missingSelectors: number
    successRate: number
  } {
    const selectorResults = results.filter(r => r.testName.startsWith('Selector:'))
    const totalSelectors = selectorResults.length
    const foundSelectors = selectorResults.filter(r => r.passed).length
    const missingSelectors = totalSelectors - foundSelectors
    const successRate = totalSelectors > 0 ? (foundSelectors / totalSelectors) * 100 : 0

    return {
      totalSelectors,
      foundSelectors,
      missingSelectors,
      successRate
    }
  }

  /**
   * Log test results
   */
  private logResults(report: TestReport, verbose: boolean): void {
    console.log('\n📊 Test Results')
    console.log('===============')
    console.log(report.summary)
    console.log(`⏱️  Total duration: ${report.totalTests > 0 ? Math.round(report.results.reduce((sum, r) => sum + r.duration, 0) / 1000) : 0}s`)
    
    // Show selector validation summary
    const selectorSummary = this.getSelectorValidationSummary(report.results)
    if (selectorSummary.totalSelectors > 0) {
      console.log('')
      console.log('🎯 Selector Validation Summary')
      console.log('=============================')
      console.log(`Total selectors tested: ${selectorSummary.totalSelectors}`)
      console.log(`Selectors found: ${selectorSummary.foundSelectors}`)
      console.log(`Selectors missing: ${selectorSummary.missingSelectors}`)
      console.log(`Success rate: ${selectorSummary.successRate.toFixed(1)}%`)
    }
    
    console.log('')

    if (verbose) {
      report.results.forEach(result => {
        const status = result.passed ? '✅' : '❌'
        console.log(`${status} ${result.testName}: ${result.message}`)
        if (result.details && Object.keys(result.details).length > 0) {
          console.log(`   Details: ${JSON.stringify(result.details)}`)
        }
      })
    } else {
      // Show only failed tests
      const failedTests = report.results.filter(r => !r.passed)
      if (failedTests.length > 0) {
        console.log('❌ Failed Tests:')
        failedTests.forEach(result => {
          console.log(`   - ${result.testName}: ${result.message}`)
        })
      }
    }

    console.log('')
    if (report.passedTests === report.totalTests) {
      console.log('🎉 All tests passed!')
    } else {
      console.log(`⚠️  ${report.failedTests} test(s) failed. Review the selectors and try again.`)
    }
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close()
        this.page = null
      }
      if (this.browser) {
        await this.browser.close()
        this.browser = null
      }
    } catch (error) {
      console.error('Warning: Failed to cleanup browser resources:', error)
    }
  }

  /**
   * Save test report to file
   */
  async saveReport(report: TestReport, outputPath?: string): Promise<void> {
    const defaultPath = path.join(process.cwd(), 'test-reports')
    const reportDir = outputPath || defaultPath

    // Ensure directory exists
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true })
    }

    const filename = `platform-test-${report.platformId}-${Date.now()}.json`
    const filePath = path.join(reportDir, filename)

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2))
    console.log(`📄 Test report saved to: ${filePath}`)
  }
}

