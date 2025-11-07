import { IDataExtractor, BusinessData, Address, BusinessHours, Rating, ValidationResult, ValidationError, ValidationWarning } from '../modules/interface/IDataExtractor';

/**
 * Mock implementation of IDataExtractor for testing purposes.
 * This mock provides predictable behavior for unit testing and development.
 */
export class MockDataExtractor implements IDataExtractor {
    /**
     * Mock business name extraction
     */
    async extractBusinessName(element: any): Promise<string> {
        return 'Mock Business Name';
    }

    /**
     * Mock phone number extraction
     */
    async extractPhoneNumber(element: any): Promise<string> {
        return '+1-555-1234';
    }

    /**
     * Mock email extraction
     */
    async extractEmail(element: any): Promise<string | null> {
        return 'mock@example.com';
    }

    /**
     * Mock website extraction
     */
    async extractWebsite(element: any): Promise<string | null> {
        return 'https://mockbusiness.com';
    }

    /**
     * Mock address extraction
     */
    async extractAddress(element: any): Promise<Address> {
        return {
            street: '123 Mock Street',
            city: 'Mock City',
            state: 'MS',
            zip: '12345',
            country: 'USA',
            formatted: '123 Mock Street, Mock City, MS 12345, USA'
        };
    }

    /**
     * Mock social media extraction
     */
    async extractSocialMedia(element: any): Promise<string[]> {
        return [
            'https://facebook.com/mockbusiness',
            'https://twitter.com/mockbusiness',
            'https://linkedin.com/company/mockbusiness'
        ];
    }

    /**
     * Mock categories extraction
     */
    async extractCategories(element: any): Promise<string[]> {
        return ['Mock Category 1', 'Mock Category 2', 'Mock Category 3'];
    }

    /**
     * Mock business hours extraction
     */
    async extractBusinessHours(element: any): Promise<BusinessHours | null> {
        return {
            monday: { open: '9:00 AM', close: '5:00 PM' },
            tuesday: { open: '9:00 AM', close: '5:00 PM' },
            wednesday: { open: '9:00 AM', close: '5:00 PM' },
            thursday: { open: '9:00 AM', close: '5:00 PM' },
            friday: { open: '9:00 AM', close: '5:00 PM' },
            saturday: { open: '10:00 AM', close: '3:00 PM' },
            sunday: { open: '', close: '', closed: true }
        };
    }

    /**
     * Mock rating extraction
     */
    async extractRating(element: any): Promise<Rating | null> {
        return {
            score: 4.5,
            max_score: 5.0,
            review_count: 50,
            rating_text: 'Excellent'
        };
    }

    /**
     * Mock data validation
     */
    validateExtractedData(data: BusinessData): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        // Validate business name
        if (!data.business_name || data.business_name.trim().length === 0) {
            errors.push({
                field: 'business_name',
                message: 'Business name is required',
                severity: 'error'
            });
        }

        // Validate email format if present
        if (data.email && !this.isValidEmail(data.email)) {
            warnings.push({
                field: 'email',
                message: 'Email format appears invalid',
                suggestion: 'Please verify the email format'
            });
        }

        // Validate phone format if present
        if (data.phone && !this.isValidPhone(data.phone)) {
            warnings.push({
                field: 'phone',
                message: 'Phone format appears invalid',
                suggestion: 'Please verify the phone number format'
            });
        }

        // Calculate completeness
        const requiredFields = ['business_name'];
        const optionalFields = ['email', 'phone', 'website', 'address', 'categories'];
        const totalFields = requiredFields.length + optionalFields.length;
        let completedFields = 0;

        if (data.business_name) completedFields++;
        if (data.email) completedFields++;
        if (data.phone) completedFields++;
        if (data.website) completedFields++;
        if (data.address) completedFields++;
        if (data.categories && data.categories.length > 0) completedFields++;

        const completeness = Math.round((completedFields / totalFields) * 100);

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            completeness
        };
    }

    /**
     * Mock data sanitization
     */
    sanitizeData(data: BusinessData): BusinessData {
        const sanitized = { ...data };

        // Sanitize business name
        if (sanitized.business_name) {
            sanitized.business_name = sanitized.business_name.trim();
        }

        // Sanitize email
        if (sanitized.email) {
            sanitized.email = sanitized.email.toLowerCase().trim();
        }

        // Sanitize phone
        if (sanitized.phone) {
            sanitized.phone = sanitized.phone.replace(/\s+/g, ' ').trim();
        }

        // Sanitize website
        if (sanitized.website) {
            if (!sanitized.website.startsWith('http://') && !sanitized.website.startsWith('https://')) {
                sanitized.website = 'https://' + sanitized.website;
            }
        }

        // Sanitize categories
        if (sanitized.categories) {
            sanitized.categories = sanitized.categories.map(cat => cat.trim()).filter(cat => cat.length > 0);
        }

        // Sanitize social media
        if (sanitized.social_media) {
            sanitized.social_media = sanitized.social_media.filter(url => url && url.trim().length > 0);
        }

        return sanitized;
    }

    /**
     * Validate email format
     */
    private isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Validate phone format
     */
    private isValidPhone(phone: string): boolean {
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
        return phoneRegex.test(cleanPhone);
    }
} 