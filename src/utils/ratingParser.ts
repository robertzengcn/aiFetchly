import { Rating } from '@/interfaces/IDataExtractor';

/**
 * Rating parsing utilities for different platforms
 * Supports various rating formats commonly found in yellow pages and review platforms
 */
export class RatingParser {
    
    /**
     * Parse rating from CSS classes
     * Common pattern used by many platforms
     */
    static parseRatingFromClasses(ratingClasses: string[], platform: string = 'unknown'): Rating | null {
        if (!ratingClasses || ratingClasses.length === 0) return null;

        const ratingMap: { [key: string]: number } = {
            // Standard rating classes
            'one': 1,
            'one-half': 1.5,
            'two': 2,
            'two-half': 2.5,
            'three': 3,
            'three-half': 3.5,
            'four': 4,
            'four-half': 4.5,
            'five': 5,
            
            // Platform-specific rating classes
            'rating-1': 1,
            'rating-2': 2,
            'rating-3': 3,
            'rating-4': 4,
            'rating-5': 5,
            
            // Yelp-specific classes
            'five-stars': 5,
            'four-stars': 4,
            'three-stars': 3,
            'two-stars': 2,
            'one-star': 1,
            
            // YellowPages-specific classes
            'star-1': 1,
            'star-2': 2,
            'star-3': 3,
            'star-4': 4,
            'star-5': 5
        };

        for (const className of ratingClasses) {
            if (ratingMap[className]) {
                return {
                    score: ratingMap[className],
                    max_score: 5,
                    review_count: 0,
                    rating_text: platform
                };
            }
        }

        return null;
    }

    /**
     * Parse rating from aria-label attribute
     * Common pattern used by accessibility-compliant sites
     */
    static parseRatingFromAriaLabel(ariaLabel: string, platform: string = 'unknown'): Rating | null {
        if (!ariaLabel) return null;

        // Common patterns in aria-labels
        const patterns = [
            /(\d+\.?\d*)\s*star/i,
            /(\d+\.?\d*)\s*out\s*of\s*(\d+)/i,
            /(\d+\.?\d*)\s*rating/i,
            /(\d+\.?\d*)\s*stars/i
        ];

        for (const pattern of patterns) {
            const match = ariaLabel.match(pattern);
            if (match) {
                const score = parseFloat(match[1]);
                const maxScore = match[2] ? parseInt(match[2]) : 5;
                
                if (score >= 0 && score <= maxScore) {
                    return {
                        score,
                        max_score: maxScore,
                        review_count: 0,
                        rating_text: platform
                    };
                }
            }
        }

        return null;
    }

    /**
     * Parse rating from text content
     * Handles various text formats like "4.5 stars", "3/5", etc.
     */
    static parseRatingFromText(text: string, platform: string = 'unknown'): Rating | null {
        if (!text) return null;

        const cleanedText = text.trim().toLowerCase();

        // Pattern: "4.5 stars" or "4.5 out of 5"
        const starPattern = /(\d+\.?\d*)\s*(?:stars?|out\s*of\s*(\d+))/i;
        const starMatch = cleanedText.match(starPattern);
        if (starMatch) {
            const score = parseFloat(starMatch[1]);
            const maxScore = starMatch[2] ? parseInt(starMatch[2]) : 5;
            
            if (score >= 0 && score <= maxScore) {
                return {
                    score,
                    max_score: maxScore,
                    review_count: 0,
                    rating_text: platform
                };
            }
        }

        // Pattern: "3/5" or "4.2/5"
        const fractionPattern = /(\d+\.?\d*)\/(\d+)/i;
        const fractionMatch = cleanedText.match(fractionPattern);
        if (fractionMatch) {
            const score = parseFloat(fractionMatch[1]);
            const maxScore = parseInt(fractionMatch[2]);
            
            if (score >= 0 && score <= maxScore) {
                return {
                    score,
                    max_score: maxScore,
                    review_count: 0,
                    rating_text: platform
                };
            }
        }

        // Pattern: just a number (assume 5-point scale)
        const numberPattern = /^(\d+\.?\d*)$/;
        const numberMatch = cleanedText.match(numberPattern);
        if (numberMatch) {
            const score = parseFloat(numberMatch[1]);
            if (score >= 0 && score <= 5) {
                return {
                    score,
                    max_score: 5,
                    review_count: 0,
                    rating_text: platform
                };
            }
        }

        return null;
    }

    /**
     * Parse review count from text
     * Handles formats like "(123 reviews)", "123 reviews", etc.
     */
    static parseReviewCount(text: string): number {
        if (!text) return 0;

        const cleanedText = text.trim();
        
        // Pattern: "(123 reviews)" or "123 reviews"
        const reviewPattern = /\(?(\d+(?:,\d+)*)\s*reviews?\)?/i;
        const reviewMatch = cleanedText.match(reviewPattern);
        if (reviewMatch) {
            const countStr = reviewMatch[1].replace(/,/g, '');
            return parseInt(countStr) || 0;
        }

        // Pattern: just a number in parentheses
        const numberPattern = /\((\d+(?:,\d+)*)\)/;
        const numberMatch = cleanedText.match(numberPattern);
        if (numberMatch) {
            const countStr = numberMatch[1].replace(/,/g, '');
            return parseInt(countStr) || 0;
        }

        // Pattern: just a number
        const simpleNumberPattern = /^(\d+(?:,\d+)*)$/;
        const simpleMatch = cleanedText.match(simpleNumberPattern);
        if (simpleMatch) {
            const countStr = simpleMatch[1].replace(/,/g, '');
            return parseInt(countStr) || 0;
        }

        return 0;
    }

    /**
     * Create a rating object with review count
     */
    static createRating(score: number, maxScore: number = 5, reviewCount: number = 0, platform: string = 'unknown'): Rating {
        return {
            score: Math.max(0, Math.min(score, maxScore)), // Clamp between 0 and maxScore
            max_score: maxScore,
            review_count: Math.max(0, reviewCount),
            rating_text: platform
        };
    }

    /**
     * Validate rating object
     */
    static validateRating(rating: Rating): boolean {
        if (!rating) return false;

        return (
            typeof rating.score === 'number' &&
            typeof rating.max_score === 'number' &&
            typeof rating.review_count === 'number' &&
            rating.score >= 0 &&
            rating.score <= rating.max_score &&
            rating.review_count >= 0
        );
    }

    /**
     * Format rating for display
     */
    static formatRating(rating: Rating): string {
        if (!this.validateRating(rating)) return '';

        const stars = '★'.repeat(Math.floor(rating.score)) + '☆'.repeat(rating.max_score - Math.floor(rating.score));
        const score = rating.score.toFixed(1);
        const reviewText = rating.review_count > 0 ? ` (${rating.review_count} reviews)` : '';

        return `${stars} ${score}/${rating.max_score}${reviewText}`;
    }

    /**
     * Extract rating from multiple sources
     * Tries different parsing methods and returns the first valid result
     */
    static extractRating(
        element: Element | null,
        platform: string = 'unknown'
    ): Rating | null {
        if (!element) return null;

        // Try parsing from CSS classes
        const classes = Array.from(element.classList);
        const classRating = this.parseRatingFromClasses(classes, platform);
        if (classRating) return classRating;

        // Try parsing from aria-label
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
            const ariaRating = this.parseRatingFromAriaLabel(ariaLabel, platform);
            if (ariaRating) return ariaRating;
        }

        // Try parsing from text content
        const textContent = element.textContent?.trim();
        if (textContent) {
            const textRating = this.parseRatingFromText(textContent, platform);
            if (textRating) return textRating;
        }

        return null;
    }
} 