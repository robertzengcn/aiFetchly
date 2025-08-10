import * as fs from 'fs'
import * as path from 'path'
import { PlatformConfig, PlatformSelectors, PlatformSettings, PlatformMetadata, PlatformFeature } from '@/interfaces/IPlatformConfig'
import { BaseModule } from '@/modules/baseModule'

/**
 * Platform Template Generator CLI
 * 
 * This tool helps developers create new platform configurations by generating
 * boilerplate configuration files with all required fields and placeholder values.
 */
export class PlatformTemplateGenerator extends BaseModule {
  private platformsDir: string

  constructor() {
    super()
    this.platformsDir = path.join(process.cwd(), 'src/config/platforms')
  }

  /**
   * Generate a new platform configuration template
   */
  async generatePlatformTemplate(): Promise<void> {
    try {
      console.log('🏗️  Platform Template Generator')
      console.log('===============================\n')

      // Get platform details from user
      const platformDetails = await this.promptForPlatformDetails()
      
      // Generate the configuration
      const config = this.createPlatformConfig(platformDetails)
      
      // Save the configuration file
      await this.savePlatformConfig(config)
      
      console.log('\n✅ Platform template generated successfully!')
      console.log(`📁 File saved: ${path.join(this.platformsDir, `${config.id}.json`)}`)
      console.log('\n📝 Next steps:')
      console.log('1. Review and customize the generated configuration')
      console.log('2. Update selectors based on the target website')
      console.log('3. Test the configuration using the PlatformTestingFramework')
      console.log('4. Register the platform with the PlatformRegistry')
      
    } catch (error) {
      console.error('❌ Failed to generate platform template:', error)
      throw error
    }
  }

  /**
   * Prompt user for platform details
   */
  private async promptForPlatformDetails(): Promise<any> {
    const readline = require('readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    const question = (query: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(query, resolve)
      })
    }

    console.log('Please provide the following details for your new platform:\n')

    const platformId = await question('Platform ID (e.g., "myplatform-com"): ')
    const platformName = await question('Platform Name (e.g., "MyPlatform.com"): ')
    const baseUrl = await question('Base URL (e.g., "https://www.myplatform.com"): ')
    const country = await question('Country (e.g., "USA"): ')
    const language = await question('Language (e.g., "English"): ')
    const platformType = await question('Platform Type (configuration/class/hybrid) [configuration]: ') || 'configuration'
    const description = await question('Description (optional): ') || ''
    const maintainer = await question('Maintainer (optional): ') || ''

    rl.close()

    return {
      platformId,
      platformName,
      baseUrl,
      country,
      language,
      platformType,
      description,
      maintainer
    }
  }

  /**
   * Create platform configuration from user input
   */
  private createPlatformConfig(details: any): PlatformConfig {
    const now = new Date().toISOString()
    
    // Create basic selectors template
    const selectors: PlatformSelectors = {
      businessList: 'div.business-list, .search-results, .result-list',
      businessName: 'h2.business-name, .company-name, .title',
      phone: '.phone, .telephone, .contact-phone',
      email: '.email, .contact-email, a[href^="mailto:"]',
      website: '.website, .site-url, a[href^="http"]',
      address: '.address, .location, .contact-address',
      address_city: '.city, .address-city',
      address_state: '.state, .address-state',
      address_zip: '.zip, .postal-code, .address-zip',
      address_country: '.country, .address-country',
      categories: '.categories, .tags, .business-type',
      rating: '.rating, .stars, .score',
      reviewCount: '.review-count, .reviews, .rating-count',
      description: '.description, .summary, .about',
      pagination: {
        nextButton: '.next, .pagination-next, a[rel="next"]',
        currentPage: '.current-page, .page-number',
        maxPages: '.total-pages, .page-count'
      }
    }

    // Create settings template
    const settings: PlatformSettings = {
      requiresAuthentication: false,
      supportsProxy: true,
      supportsCookies: true,
      searchUrlPattern: `${details.baseUrl}/search?q={keywords}&location={location}&page={page}`,
      resultUrlPattern: `${details.baseUrl}{path}`,
      supportedFeatures: [PlatformFeature.SEARCH, PlatformFeature.PAGINATION]
    }

    // Create metadata template
    const metadata: PlatformMetadata = {
      lastUpdated: new Date(now),
      version: '1.0.0',
      category: 'business-directory',
      tags: [details.country.toLowerCase(), 'business-directory', 'local-search'],
      statistics: {
        totalBusinesses: 0,
        lastScraped: new Date(now),
        successRate: 0
      }
    }

    // Create the main configuration
    const config: PlatformConfig = {
      id: details.platformId,
      name: details.platformName,
      display_name: details.platformName,
      base_url: details.baseUrl,
      country: details.country,
      language: details.language,
      is_active: true,
      version: '1.0.0',
      type: details.platformType as 'configuration' | 'class' | 'hybrid',
      rate_limit: 100,
      delay_between_requests: 2000,
      max_concurrent_requests: 1,
      selectors,
      settings,
      metadata,
      description: details.description || `Platform configuration for ${details.platformName}`,
      maintainer: details.maintainer || 'Platform Development Team'
    }

    // Add class-specific fields if needed
    if (details.platformType === 'class' || details.platformType === 'hybrid') {
      config.class_name = `${details.platformName.replace(/[^a-zA-Z0-9]/g, '')}Adapter`
      config.module_path = `./platforms/${config.class_name}`
    }

    return config
  }

  /**
   * Save platform configuration to file
   */
  private async savePlatformConfig(config: PlatformConfig): Promise<void> {
    // Ensure platforms directory exists
    if (!fs.existsSync(this.platformsDir)) {
      fs.mkdirSync(this.platformsDir, { recursive: true })
      console.log(`📁 Created platforms directory: ${this.platformsDir}`)
    }

    // Create filename
    const fileName = `${config.id}.json`
    const filePath = path.join(this.platformsDir, fileName)

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      console.log(`⚠️  Warning: File ${fileName} already exists.`)
      const readline = require('readline')
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      })

      const answer = await new Promise<string>((resolve) => {
        rl.question('Do you want to overwrite it? (y/N): ', resolve)
      })
      rl.close()

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log('❌ Operation cancelled.')
        return
      }
    }

    // Write configuration to file
    const configJson = JSON.stringify(config, null, 2)
    fs.writeFileSync(filePath, configJson)
    
    console.log(`💾 Saved platform configuration to: ${filePath}`)
  }

  /**
   * Generate a simple configuration template (for programmatic use)
   */
  static generateSimpleTemplate(platformId: string, platformName: string, baseUrl: string): PlatformConfig {
    const now = new Date().toISOString()
    
    return {
      id: platformId,
      name: platformName,
      display_name: platformName,
      base_url: baseUrl,
      country: 'USA',
      language: 'English',
      is_active: true,
      version: '1.0.0',
      type: 'configuration',
      rate_limit: 100,
      delay_between_requests: 2000,
      max_concurrent_requests: 1,
      selectors: {
        businessList: 'div.business-list',
        businessName: 'h2.business-name',
        phone: '.phone',
        email: '.email',
        website: '.website',
        address: '.address',
        pagination: {
          nextButton: '.next',
          currentPage: '.current-page',
          maxPages: '.total-pages'
        }
      },
      settings: {
        requiresAuthentication: false,
        supportsProxy: true,
        supportsCookies: true,
        searchUrlPattern: `${baseUrl}/search?q={keywords}&page={page}`,
        resultUrlPattern: `${baseUrl}{path}`,
        supportedFeatures: [PlatformFeature.SEARCH, PlatformFeature.PAGINATION]
      },
      metadata: {
        lastUpdated: new Date(now),
        version: '1.0.0',
        category: 'business-directory',
        tags: ['usa', 'business-directory'],
        statistics: {
          totalBusinesses: 0,
          lastScraped: new Date(now),
          successRate: 0
        }
      },
      description: `Platform configuration for ${platformName}`,
      maintainer: 'Platform Development Team'
    }
  }

  /**
   * List all existing platform configurations
   */
  listExistingPlatforms(): string[] {
    if (!fs.existsSync(this.platformsDir)) {
      return []
    }

    const files = fs.readdirSync(this.platformsDir)
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''))

    return files
  }

  /**
   * Validate a platform configuration
   */
  validatePlatformConfig(config: PlatformConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    // Required fields validation
    if (!config.id) errors.push('Platform ID is required')
    if (!config.name) errors.push('Platform name is required')
    if (!config.base_url) errors.push('Base URL is required')
    if (!config.country) errors.push('Country is required')
    if (!config.language) errors.push('Language is required')
    if (!config.selectors) errors.push('Selectors are required')
    if (!config.selectors?.businessList) errors.push('Business list selector is required')
    if (!config.selectors?.businessName) errors.push('Business name selector is required')

    // URL validation
    try {
      new URL(config.base_url)
    } catch {
      errors.push('Base URL is not a valid URL')
    }

    // Type validation
    if (!['configuration', 'class', 'hybrid'].includes(config.type)) {
      errors.push('Platform type must be one of: configuration, class, hybrid')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }
}

