import { Address } from '@/interfaces/IDataExtractor';

/**
 * Address parsing utilities for different countries and formats
 * Supports US and Canadian address formats commonly found in yellow pages platforms
 */
export class AddressParser {
    
    /**
     * Parse address string into structured format
     * Supports multiple address formats from different platforms
     */
    static parseAddress(addressText: string, country: string = 'USA'): Address | null {
        if (!addressText) return null;

        switch (country.toLowerCase()) {
            case 'canada':
                return this.parseCanadianAddress(addressText);
            case 'usa':
            case 'united states':
            default:
                return this.parseUSAddress(addressText);
        }
    }

    /**
     * Parse US address format
     * Expected format: "123 Main St, City, ST 12345"
     */
    private static parseUSAddress(addressText: string): Address | null {
        if (!addressText) return null;

        const parts = addressText.split(',').map(part => part.trim());
        
        if (parts.length < 2) return null;

        const street = parts[0];
        const lastPart = parts[parts.length - 1];
        
        // Handle different US address formats
        let city = '';
        let state = '';
        let zip = '';
        
        if (parts.length >= 3) {
            city = parts[1];
            const stateZipMatch = lastPart.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
            if (stateZipMatch) {
                state = stateZipMatch[1];
                zip = stateZipMatch[2];
            } else {
                // If no state/zip pattern found, treat last part as city continuation
                city = parts.slice(1).join(', ');
            }
        } else {
            city = parts[1];
        }

        return {
            street,
            city,
            state,
            zip,
            country: 'USA'
        };
    }

    /**
     * Parse Canadian address format
     * Expected format: "123 Main St, City, Province PostalCode"
     * or "123 Main St, City, ON L1A 1A1"
     */
    private static parseCanadianAddress(addressText: string): Address | null {
        if (!addressText) return null;

        const parts = addressText.split(',').map(part => part.trim());
        
        if (parts.length < 2) return null;

        const street = parts[0];
        const lastPart = parts[parts.length - 1];
        
        // Canadian postal codes are in format A1A 1A1
        const postalCodeMatch = lastPart.match(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/);
        const zip = postalCodeMatch ? postalCodeMatch[0] : '';
        
        // Extract province (2-letter code like ON, BC, QC)
        const provinceMatch = lastPart.match(/\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/);
        const state = provinceMatch ? provinceMatch[0] : '';
        
        // City is everything between street and province/postal code
        const city = parts.slice(1, -1).join(', ').trim() || 
                    (lastPart.replace(postalCodeMatch?.[0] || '', '').replace(provinceMatch?.[0] || '', '').trim());

        return {
            street,
            city,
            state,
            zip,
            country: 'Canada'
        };
    }

    /**
     * Clean and normalize address text
     * Removes extra whitespace, newlines, and common formatting issues
     */
    static cleanAddressText(addressText: string): string {
        if (!addressText) return '';

        return addressText
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .replace(/\n/g, ', ') // Replace newlines with commas
            .replace(/\r/g, '') // Remove carriage returns
            .replace(/,\s*,/g, ',') // Remove empty comma-separated parts
            .replace(/^\s*,\s*/, '') // Remove leading comma
            .replace(/\s*,\s*$/, '') // Remove trailing comma
            .trim();
    }

    /**
     * Extract postal code from address text
     * Supports both US and Canadian formats
     */
    static extractPostalCode(addressText: string, country: string = 'USA'): string {
        if (!addressText) return '';

        const cleanedText = this.cleanAddressText(addressText);

        if (country.toLowerCase() === 'canada') {
            // Canadian postal code: A1A 1A1
            const match = cleanedText.match(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/);
            return match ? match[0] : '';
        } else {
            // US ZIP code: 12345 or 12345-6789
            const match = cleanedText.match(/\b\d{5}(?:-\d{4})?\b/);
            return match ? match[0] : '';
        }
    }

    /**
     * Extract state/province from address text
     * Supports both US states and Canadian provinces
     */
    static extractState(addressText: string, country: string = 'USA'): string {
        if (!addressText) return '';

        const cleanedText = this.cleanAddressText(addressText);

        if (country.toLowerCase() === 'canada') {
            // Canadian provinces
            const provinces = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
            for (const province of provinces) {
                if (cleanedText.includes(province)) {
                    return province;
                }
            }
        } else {
            // US states (2-letter codes)
            const states = [
                'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
                'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
                'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
                'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
                'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
            ];
            for (const state of states) {
                if (cleanedText.includes(state)) {
                    return state;
                }
            }
        }

        return '';
    }

    /**
     * Validate address structure
     * Returns true if the address has the minimum required fields
     */
    static validateAddress(address: Address): boolean {
        if (!address) return false;

        // Must have at least street and city
        return !!(address.street && address.city);
    }

    /**
     * Format address for display
     * Converts structured address back to readable format
     */
    static formatAddress(address: Address): string {
        if (!address) return '';

        const parts: string[] = [];

        if (address.street) parts.push(address.street);
        if (address.city) parts.push(address.city);
        
        if (address.state && address.zip) {
            parts.push(`${address.state} ${address.zip}`);
        } else if (address.state) {
            parts.push(address.state);
        } else if (address.zip) {
            parts.push(address.zip);
        }

        return parts.join(', ');
    }
} 