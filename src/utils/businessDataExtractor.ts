import { Page } from 'puppeteer';
import { BusinessData, Address, BusinessHours, Rating } from '@/interfaces/IDataExtractor';
import { AddressParser } from './addressParser';
import { RatingParser } from './ratingParser';

/**
 * Business data extraction utilities
 * Provides common patterns for extracting business information from various platforms
 */
export class BusinessDataExtractor {
    
    /**
     * Extract business name from various selector patterns
     */
    static async extractBusinessName(page: Page, selectors: string[]): Promise<string | null> {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const name = await page.evaluate(el => el.textContent?.trim(), element);
                    if (name && name.length > 0) {
                        return name;
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract business phone number
     */
    static async extractPhoneNumber(page: Page, selectors: string[]): Promise<string | null> {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const phone = await page.evaluate(el => {
                        const text = el.textContent?.trim() || '';
                        const href = el.getAttribute('href') || '';
                        
                        // Extract phone from href (tel: links)
                        if (href.startsWith('tel:')) {
                            return href.replace('tel:', '').trim();
                        }
                        
                        // Extract phone from text
                        const phoneMatch = text.match(/(\+\d{1,3}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
                        if (phoneMatch) {
                            return phoneMatch[0];
                        }
                        
                        return text;
                    }, element);
                    
                    if (phone && phone.length > 0) {
                        return phone;
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract business website URL
     */
    static async extractWebsite(page: Page, selectors: string[]): Promise<string | null> {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const website = await page.evaluate(el => {
                        const href = el.getAttribute('href') || '';
                        const text = el.textContent?.trim() || '';
                        
                        // If href is a valid URL, use it
                        if (href && (href.startsWith('http') || href.startsWith('www'))) {
                            return href;
                        }
                        
                        // If text looks like a URL, use it
                        if (text && (text.startsWith('http') || text.startsWith('www'))) {
                            return text;
                        }
                        
                        return null;
                    }, element);
                    
                    if (website) {
                        return website;
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract business address
     */
    static async extractAddress(page: Page, selectors: string[], country: string = 'USA'): Promise<Address | null> {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const addressText = await page.evaluate(el => el.textContent?.trim(), element);
                    if (addressText) {
                        return AddressParser.parseAddress(addressText, country);
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract business rating
     */
    static async extractRating(page: Page, selectors: string[]): Promise<Rating | null> {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const ratingData = await page.evaluate(el => {
                        const classes = Array.from(el.classList);
                        const text = el.textContent?.trim() || '';
                        const title = el.getAttribute('title') || '';
                        
                        return { classes, text, title };
                    }, element);
                    
                    const rating = RatingParser.parseRatingFromClasses(ratingData.classes);
                    if (rating) {
                        return rating;
                    }
                    
                    // Try to parse from text
                    const textRating = RatingParser.parseRatingFromText(ratingData.text);
                    if (textRating) {
                        return textRating;
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract business hours
     */
    static async extractBusinessHours(page: Page, selectors: string[]): Promise<BusinessHours | null> {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const hoursText = await page.evaluate(el => el.textContent?.trim(), element);
                    if (hoursText) {
                        return this.parseBusinessHours(hoursText);
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract business category/type
     */
    static async extractCategory(page: Page, selectors: string[]): Promise<string | null> {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const category = await page.evaluate(el => el.textContent?.trim(), element);
                    if (category && category.length > 0) {
                        return category;
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract business description
     */
    static async extractDescription(page: Page, selectors: string[]): Promise<string | null> {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const description = await page.evaluate(el => el.textContent?.trim(), element);
                    if (description && description.length > 0) {
                        return description;
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract business email
     */
    static async extractEmail(page: Page, selectors: string[]): Promise<string | null> {
        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const email = await page.evaluate(el => {
                        const href = el.getAttribute('href') || '';
                        const text = el.textContent?.trim() || '';
                        
                        // Extract from mailto: links
                        if (href.startsWith('mailto:')) {
                            return href.replace('mailto:', '').trim();
                        }
                        
                        // Extract from text
                        const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                        if (emailMatch) {
                            return emailMatch[0];
                        }
                        
                        return null;
                    }, element);
                    
                    if (email) {
                        return email;
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract business services
     */
    static async extractServices(page: Page, selectors: string[]): Promise<string[] | null> {
        for (const selector of selectors) {
            try {
                const elements = await page.$$(selector);
                if (elements.length > 0) {
                    const services = await page.evaluate((els) => {
                        return els.map(el => (el as unknown as HTMLElement).textContent?.trim()).filter(text => text && text.length > 0);
                    }, elements);
                    
                    if (services.length > 0) {
                        return services.filter((service): service is string => service !== undefined);
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Extract business images
     */
    static async extractImages(page: Page, selectors: string[]): Promise<string[] | null> {
        for (const selector of selectors) {
            try {
                const elements = await page.$$(selector);
                if (elements.length > 0) {
                    const images = await page.evaluate((els) => {
                        return els.map(el => {
                            const src = (el as unknown as HTMLElement).getAttribute('src') || '';
                            const dataSrc = (el as unknown as HTMLElement).getAttribute('data-src') || '';
                            return dataSrc || src;
                        }).filter(src => src && src.length > 0);
                    }, elements);
                    
                    if (images.length > 0) {
                        return images;
                    }
                }
            } catch (error) {
                continue;
            }
        }
        return null;
    }

    /**
     * Parse business hours from text
     */
    private static parseBusinessHours(hoursText: string): BusinessHours | null {
        try {
            // Common business hours patterns
            const patterns = [
                // "Mon-Fri: 9:00 AM-5:00 PM"
                /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:-(Mon|Tue|Wed|Thu|Fri|Sat|Sun))?:\s*(\d{1,2}:\d{2}\s*[AP]M)-(\d{1,2}:\d{2}\s*[AP]M)/gi,
                // "Monday - Friday: 9:00 AM - 5:00 PM"
                /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*-\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))?:\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/gi,
                // "9:00 AM - 5:00 PM"
                /(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/gi
            ];

            for (const pattern of patterns) {
                const matches = hoursText.match(pattern);
                if (matches) {
                    // For now, return a simple structure
                    return {
                        monday: { open: hoursText, close: hoursText },
                        tuesday: { open: hoursText, close: hoursText },
                        wednesday: { open: hoursText, close: hoursText },
                        thursday: { open: hoursText, close: hoursText },
                        friday: { open: hoursText, close: hoursText },
                        saturday: { open: hoursText, close: hoursText },
                        sunday: { open: hoursText, close: hoursText }
                    };
                }
            }

            return null;
        } catch (error) {
            console.log('Error parsing business hours:', error);
            return null;
        }
    }

    /**
     * Extract all business data using provided selectors
     */
    static async extractAllBusinessData(
        page: Page,
        selectors: {
            name?: string[];
            phone?: string[];
            website?: string[];
            address?: string[];
            rating?: string[];
            hours?: string[];
            category?: string[];
            description?: string[];
            email?: string[];
            services?: string[];
            images?: string[];
        },
        country: string = 'USA'
    ): Promise<Partial<BusinessData>> {
        const data: Partial<BusinessData> = {};

        if (selectors.phone) {
            data.phone = await this.extractPhoneNumber(page, selectors.phone) || undefined;
        }

        if (selectors.website) {
            data.website = await this.extractWebsite(page, selectors.website) || undefined;
        }

        if (selectors.address) {
            data.address = await this.extractAddress(page, selectors.address, country) || undefined;
        }

        if (selectors.rating) {
            data.rating = await this.extractRating(page, selectors.rating) || undefined;
        }

        if (selectors.description) {
            data.description = await this.extractDescription(page, selectors.description) || undefined;
        }

        if (selectors.email) {
            data.email = await this.extractEmail(page, selectors.email) || undefined;
        }

        return data;
    }
} 