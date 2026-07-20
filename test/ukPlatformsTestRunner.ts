/**
 * UK Platforms Test Runner
 * Comprehensive testing and framework evaluation for UK platform adapters
 */

import { PlatformAdapterFactory } from '@/modules/PlatformAdapterFactory';
import { PlatformRegistry } from '@/modules/PlatformRegistry';
import fs from 'fs';
import path from 'path';
import YellComAdapterTest from './yellComAdapterTest';
import * as Test192 from './192ComAdapterTest';

export class UKPlatformsTestRunner {
    private factory: PlatformAdapterFactory;
    private registry: PlatformRegistry;
    private yellTest: YellComAdapterTest;
    private test192: any;

    constructor() {
        this.factory = new PlatformAdapterFactory();
        this.registry = new PlatformRegistry();
        this.yellTest = new YellComAdapterTest();
        this.test192 = new (Test192 as any)['192ComAdapterTest']();
    }

    /**
     * Test all UK platform configurations
     */
    async testUKPlatformConfigurations(): Promise<void> {
        console.log('🧪 Testing all UK platform configurations...');

        try {
            const ukPlatforms = this.registry.getPlatformsByCountry('UK');
            console.log(`✅ Found ${ukPlatforms.length} UK platforms`);

            for (const platform of ukPlatforms) {
                console.log(`\n📋 Testing ${platform.name} (${platform.id})...`);
                
                // Validate configuration
                const validation = this.registry.validatePlatformConfig(platform);
                if (!validation.isValid) {
                    throw new Error(`${platform.name} configuration invalid: ${validation.errors.join(', ')}`);
                }

                console.log(`✅ ${platform.name} configuration is valid (score: ${validation.score})`);

                // Test adapter creation
                const adapter = await this.factory.createAdapterById(platform.id);
                console.log(`✅ ${platform.name} adapter created successfully`);

                // Test adapter validation
                const adapterValidation = adapter.validateConfig();
                if (!adapterValidation.isValid) {
                    throw new Error(`${platform.name} adapter validation failed: ${adapterValidation.errors.join(', ')}`);
                }

                console.log(`✅ ${platform.name} adapter validation passed`);
            }

            console.log('\n✅ All UK platform configurations tested successfully');

        } catch (error) {
            console.error('❌ UK platform configuration test failed:', error);
            throw error;
        }
    }

    /**
     * Test framework efficiency metrics
     */
    async testFrameworkEfficiency(): Promise<void> {
        console.log('🧪 Testing framework efficiency metrics...');

        try {
            const metrics = {
                totalPlatforms: 0,
                ukPlatforms: 0,
                averageCreationTime: 0,
                averageValidationTime: 0,
                totalOverhead: 0
            };

            const startTime = Date.now();
            const allPlatforms = this.registry.getAllPlatforms();
            metrics.totalPlatforms = allPlatforms.length;

            const ukPlatforms = this.registry.getPlatformsByCountry('UK');
            metrics.ukPlatforms = ukPlatforms.length;

            let totalCreationTime = 0;
            let totalValidationTime = 0;

            // Test creation and validation times for UK platforms
            for (const platform of ukPlatforms) {
                const creationStart = Date.now();
                const adapter = await this.factory.createAdapterById(platform.id);
                const creationTime = Date.now() - creationStart;
                totalCreationTime += creationTime;

                const validationStart = Date.now();
                const validation = adapter.validateConfig();
                const validationTime = Date.now() - validationStart;
                totalValidationTime += validationTime;

                console.log(`${platform.name}: Creation=${creationTime}ms, Validation=${validationTime}ms`);
            }

            metrics.averageCreationTime = totalCreationTime / ukPlatforms.length;
            metrics.averageValidationTime = totalValidationTime / ukPlatforms.length;
            metrics.totalOverhead = Date.now() - startTime;

            console.log('\n📊 Framework Efficiency Metrics:');
            console.log(`Total platforms: ${metrics.totalPlatforms}`);
            console.log(`UK platforms: ${metrics.ukPlatforms}`);
            console.log(`Average creation time: ${metrics.averageCreationTime.toFixed(2)}ms`);
            console.log(`Average validation time: ${metrics.averageValidationTime.toFixed(2)}ms`);
            console.log(`Total overhead: ${metrics.totalOverhead}ms`);

            // Efficiency evaluation
            if (metrics.averageCreationTime < 100) {
                console.log('✅ Adapter creation is very efficient');
            } else if (metrics.averageCreationTime < 500) {
                console.log('✅ Adapter creation is efficient');
            } else {
                console.warn('⚠️ Adapter creation could be optimized');
            }

            if (metrics.averageValidationTime < 50) {
                console.log('✅ Validation is very efficient');
            } else if (metrics.averageValidationTime < 200) {
                console.log('✅ Validation is efficient');
            } else {
                console.warn('⚠️ Validation could be optimized');
            }

        } catch (error) {
            console.error('❌ Framework efficiency test failed:', error);
            throw error;
        }
    }

    /**
     * Test platform extensibility framework
     */
    async testPlatformExtensibility(): Promise<void> {
        console.log('🧪 Testing platform extensibility framework...');

        try {
            // Test that new platforms can be added easily
            const testConfig = {
                id: 'test-uk-platform',
                name: 'Test UK Platform',
                display_name: 'Test UK Platform',
                base_url: 'https://test.example.com',
                country: 'UK',
                language: 'English',
                is_active: true,
                version: '1.0.0',
                type: 'class' as const,
                class_name: 'TestUKAdapter',
                module_path: './platforms/TestUKAdapter',
                rate_limit: 100,
                delay_between_requests: 2000,
                max_concurrent_requests: 1,
                selectors: {
                    businessList: 'div.business',
                    businessName: 'h3.name'
                },
                settings: {
                    requiresAuthentication: false,
                    supportsProxy: true,
                    supportsCookies: true,
                    searchUrlPattern: 'https://test.example.com/search?q={keywords}&l={location}&p={page}',
                    resultUrlPattern: 'https://test.example.com{path}',
                    supportedFeatures: ['search', 'pagination'] as any
                },
                metadata: {
                    description: 'Test platform for extensibility evaluation',
                    lastUpdated: new Date(),
                    maintainer: 'Test Team',
                    tags: ['uk', 'test', 'extensibility'],
                    version: '1.0.0'
                }
            };

            // Test configuration validation
            const validation = this.registry.validatePlatformConfig(testConfig);
            if (!validation.isValid) {
                throw new Error(`Test platform configuration invalid: ${validation.errors.join(', ')}`);
            }

            console.log('✅ Test platform configuration is valid');

            // Test that platform can be registered
            await this.registry.registerPlatform(testConfig);
            console.log('✅ Test platform registered successfully');

            // Test that platform can be retrieved
            const retrievedConfig = this.registry.getPlatformConfig('test-uk-platform');
            if (!retrievedConfig) {
                throw new Error('Test platform not found after registration');
            }

            console.log('✅ Test platform retrieved successfully');

            // Test that platform can be removed
            await this.registry.removePlatform('test-uk-platform');
            console.log('✅ Test platform removed successfully');

            console.log('✅ Platform extensibility framework works correctly');

        } catch (error) {
            console.error('❌ Platform extensibility test failed:', error);
            throw error;
        }
    }

    /**
     * Generate framework evaluation report
     */
    async generateFrameworkReport(): Promise<void> {
        console.log('📋 Generating framework evaluation report...');

        try {
            const report = {
                timestamp: new Date().toISOString(),
                totalPlatforms: this.registry.getAllPlatforms().length,
                ukPlatforms: this.registry.getPlatformsByCountry('UK').length,
                activePlatforms: this.registry.getActivePlatforms().length,
                platformTypes: this.registry.getPlatformsByType('class').length,
                frameworkEfficiency: {
                    averageCreationTime: 0,
                    averageValidationTime: 0,
                    totalOverhead: 0
                },
                extensibilityScore: 0,
                recommendations: [] as string[]
            };

            // Calculate efficiency metrics
            const ukPlatforms = this.registry.getPlatformsByCountry('UK');
            let totalCreationTime = 0;
            let totalValidationTime = 0;

            for (const platform of ukPlatforms) {
                const creationStart = Date.now();
                const adapter = await this.factory.createAdapterById(platform.id);
                const creationTime = Date.now() - creationStart;
                totalCreationTime += creationTime;

                const validationStart = Date.now();
                const validation = adapter.validateConfig();
                const validationTime = Date.now() - validationStart;
                totalValidationTime += validationTime;
            }

            report.frameworkEfficiency.averageCreationTime = totalCreationTime / ukPlatforms.length;
            report.frameworkEfficiency.averageValidationTime = totalValidationTime / ukPlatforms.length;

            // Calculate extensibility score (0-100)
            const baseScore = 50;
            const efficiencyBonus = report.frameworkEfficiency.averageCreationTime < 200 ? 20 : 0;
            const validationBonus = report.frameworkEfficiency.averageValidationTime < 100 ? 20 : 0;
            const platformBonus = ukPlatforms.length >= 2 ? 10 : 0;

            report.extensibilityScore = Math.min(100, baseScore + efficiencyBonus + validationBonus + platformBonus);

            // Generate recommendations
            if (report.frameworkEfficiency.averageCreationTime > 500) {
                report.recommendations.push('Consider optimizing adapter creation performance');
            }

            if (report.frameworkEfficiency.averageValidationTime > 200) {
                report.recommendations.push('Consider optimizing validation performance');
            }

            if (ukPlatforms.length < 3) {
                report.recommendations.push('Consider adding more UK platforms for better coverage');
            }

            if (report.extensibilityScore < 70) {
                report.recommendations.push('Review framework design for better extensibility');
            }

            console.log('\n📊 Framework Evaluation Report:');
            console.log('=' .repeat(60));
            console.log(`Timestamp: ${report.timestamp}`);
            console.log(`Total platforms: ${report.totalPlatforms}`);
            console.log(`UK platforms: ${report.ukPlatforms}`);
            console.log(`Active platforms: ${report.activePlatforms}`);
            console.log(`Class-based platforms: ${report.platformTypes}`);
            console.log(`Average creation time: ${report.frameworkEfficiency.averageCreationTime.toFixed(2)}ms`);
            console.log(`Average validation time: ${report.frameworkEfficiency.averageValidationTime.toFixed(2)}ms`);
            console.log(`Extensibility score: ${report.extensibilityScore}/100`);
            
            if (report.recommendations.length > 0) {
                console.log('\n💡 Recommendations:');
                report.recommendations.forEach(rec => console.log(`- ${rec}`));
            }

            console.log('=' .repeat(60));

            // Save report to file
            const reportPath = path.join(__dirname, 'output/uk-platforms-framework-report.json');
            
            // Ensure output directory exists
            const outputDir = path.dirname(reportPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
            console.log(`📄 Report saved to: ${reportPath}`);

        } catch (error) {
            console.error('❌ Framework report generation failed:', error);
            throw error;
        }
    }

    /**
     * Run comprehensive UK platforms testing and evaluation
     */
    async runComprehensiveTests(): Promise<void> {
        console.log('🚀 Starting comprehensive UK platforms testing and framework evaluation...');
        console.log('=' .repeat(80));

        const tests = [
            this.testUKPlatformConfigurations.bind(this),
            this.testFrameworkEfficiency.bind(this),
            this.testPlatformExtensibility.bind(this),
            this.generateFrameworkReport.bind(this)
        ];

        let passedTests = 0;
        const totalTests = tests.length;

        for (const test of tests) {
            try {
                await test();
                passedTests++;
                console.log('✅ Test passed');
            } catch (error) {
                console.error('❌ Test failed:', error);
            }
            console.log('-'.repeat(60));
        }

        console.log('=' .repeat(80));
        console.log(`📊 Comprehensive Test Results: ${passedTests}/${totalTests} tests passed`);
        
        if (passedTests === totalTests) {
            console.log('🎉 All UK platforms tests and framework evaluation passed!');
            console.log('✅ Framework is ready for production use');
        } else {
            console.log('⚠️ Some tests failed. Please review the errors above.');
        }

        // Run individual platform tests
        console.log('\n🧪 Running individual platform tests...');
        console.log('=' .repeat(60));

        try {
            await this.yellTest.runAllTests();
        } catch (error) {
            console.error('❌ Yell.com tests failed:', error);
        }

        console.log('-'.repeat(60));

        try {
            await this.test192.runAllTests();
        } catch (error) {
            console.error('❌ 192.com tests failed:', error);
        }

        console.log('=' .repeat(60));
        console.log('🏁 UK platforms testing and framework evaluation completed');
    }
}

// Export for use in other test files
export default UKPlatformsTestRunner;
