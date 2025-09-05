import { describe, it } from 'mocha';
import { expect } from 'chai';

describe('Yelp Phone Number Extraction', function() {
    const sampleHTML = `<section class="y-css-1790tv2"><div class="y-css-y8tdj8" data-testid="cookbook-island"><div class="y-css-4cg16w"><div class="y-css-13akgjv"><div class="y-css-1ilqd8r"><a href="/biz_redir?url=http%3A%2F%2Fwww.traveldarlings.com&amp;cachebuster=1757042976&amp;website_link_type=website&amp;src_bizid=x5NIoEm8w-VJgVW33giMsQ&amp;s=d659d26e5022623450c9c824249e4de513d0fc45201e103928e0df0b89f1e6f7" class=" y-css-14ckas3" target="_blank"><span aria-label="Business website" alt="Business website" aria-hidden="false" role="img" class="icon--24-external-link-v2 icon__09f24__zr17A y-css-1u7t9bb"><svg width="24" height="24" class="icon_svg"><path d="M20.47 3.07a.5.5 0 0 1 .53.46v6a.5.5 0 0 1-.39.49.58.58 0 0 1-.19 0 .47.47 0 0 1-.35-.15L17.8 7.6l-5 5a1 1 0 0 1-1.41 0 1 1 0 0 1 0-1.41l5-5-2.27-2.27a.5.5 0 0 1 .35-.85h6ZM20 21H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6a1 1 0 0 1 0 2H5v14h14v-5a1 1 0 0 1 2 0v6a1 1 0 0 1-1 1Z"></path></svg></span></a></div><div class="y-css-8x4us"><p class=" y-css-9fw56v">Business website</p><p class=" y-css-qn4gww" data-font-weight="semibold"><a href="/biz_redir?url=http%3A%2F%2Fwww.traveldarlings.com&amp;cachebuster=1757042976&amp;website_link_type=website&amp;src_bizid=x5NIoEm8w-VJgVW33giMsQ&amp;s=d659d26e5022623450c9c824249e4de513d0fc45201e103928e0df0b89f1e6f7" class="y-css-14ckas3" target="_blank" rel="noopener">traveldarlings.com</a></p></div></div></div><div class="y-css-4cg16w"><div class="y-css-13akgjv"><div class="y-css-1ilqd8r"><span aria-label="Business phone number" alt="Business phone number" aria-hidden="false" role="img" class="icon--24-phone-v2 icon__09f24__zr17A y-css-1u7t9bb"><svg width="24" height="24" class="icon_svg"><path d="M13.59 23.07A7 7 0 0 1 8.64 21L3 15.36a7 7 0 0 1 0-9.9l1.39-1.41a1 1 0 0 1 1.42 0l5 5a1 1 0 0 1 0 1.41 2.001 2.001 0 0 0 2.83 2.83 1 1 0 0 1 1.41 0l4.95 5a1 1 0 0 1 0 1.42L18.54 21a7 7 0 0 1-4.95 2.07ZM5.1 6.17l-.71.71a5 5 0 0 0 0 7.07l5.66 5.66a5 5 0 0 0 7.07 0l.71-.71-3.63-3.63a4 4 0 0 1-4.86-.61 4 4 0 0 1-.61-4.86L5.1 6.17Zm12.78 5.95a1 1 0 0 1-1-1 4 4 0 0 0-4-4 1 1 0 0 1 0-2 6 6 0 0 1 6 6 1 1 0 0 1-1 1Zm4.19 0a1 1 0 0 1-1-1 8.19 8.19 0 0 0-8.19-8.19 1 1 0 0 1 0-2c5.625.006 10.184 4.565 10.19 10.19a1 1 0 0 1-1 1Z"></path></svg></span></div><div class="y-css-8x4us"><p class=" y-css-9fw56v">Phone number</p><p class=" y-css-qn4gww" data-font-weight="semibold">(415) 324-9739</p></div></div></div><div class="y-css-4cg16w"><div class="y-css-13akgjv"><div class="y-css-1ilqd8r"><a href="/map/travel-darlings-san-francisco-5" class=" y-css-14ckas3"><span aria-label="Directions to the business" alt="Directions to the business" aria-hidden="false" role="img" class="icon--24-directions-v2 icon__09f24__zr17A y-css-1u7t9bb"><svg width="24" height="24" viewBox="0 0 22 22" class="icon_svg"><path d="M11 22a3 3 0 0 1-2.12-.88l-8-8a3 3 0 0 1 0-4.24l8-8a3 3 0 0 1 4.24 0l8 8a3 3 0 0 1 0 4.24l-8 8A3 3 0 0 1 11 22Zm0-20a1 1 0 0 0-.71.29l-8 8a1 1 0 0 0 0 1.42l8 8a1 1 0 0 0 1.42 0l8-8a1 1 0 0 0 0-1.42l-8-8A1 1 0 0 0 11 2Zm4.85 8.15a.48.48 0 0 1 0 .66l-3 3a.47.47 0 0 1-.35.15.43.43 0 0 1-.19 0 .5.5 0 0 1-.31-.46v-2.05a1 1 0 0 1-.25.05h-2a1 1 0 0 0-1 1v1a1 1 0 1 1-2 0v-1a3 3 0 0 1 3-3h2a1 1 0 0 1 .25.05V7.5a.5.5 0 0 1 .31-.5.47.47 0 0 1 .54.15l3 3Z"></path></svg></span></a></div><div class="y-css-8x4us"><p class=" y-css-qn4gww" data-font-weight="semibold"><a href="/map/travel-darlings-san-francisco-5" class="y-css-14ckas3">Get Directions</a></p><p class=" y-css-p0gpmm" data-font-weight="semibold">2745 Webster St Ste 1 San Francisco, CA 94123</p></div></div></div><div class=" y-css-pdk311"><button type="submit" class=" y-css-blc109" data-activated="false" value="submit" data-button="true"><div class="y-css-ifzvh4"><div class="y-css-11asbdc"><span alt="" aria-hidden="true" role="img" class="icon--24-pencil-v2 y-css-zi7d4n"><svg width="24" height="24" class="icon_svg"><path fill-rule="evenodd" clip-rule="evenodd" d="m2.277 14.83-1.23 7a1 1 0 0 0 .29.88 1 1 0 0 0 .71.29.473.473 0 0 0 .13-.02l7-1.23a.92.92 0 0 0 .53-.28l9.87-9.86 2.47-2.47a3.34 3.34 0 0 0 0-4.7L19.607 2a3.34 3.34 0 0 0-4.7 0l-2.47 2.44-9.88 9.86a.92.92 0 0 0-.28.53zm15.21-3.93-7.65 7.63-4.32-4.34 7.63-7.63 4.34 4.34zm3.17-5.05-2.46-2.46a1.33 1.33 0 0 0-1.88 0l-1.76 1.76 4.34 4.34 1.76-1.76a1.33 1.33 0 0 0 0-1.88zm-16.48 9.81 4.19 4.19-5.09.9.9-5.09z"></path></svg></span></div><div class="y-css-jby69f"><span class="y-css-3ptwl3"><p class=" y-css-hjwf28" data-font-weight="semibold">Suggest an edit</p></span></div></div></button></div></div></section>`;

    it('should extract phone number using current regex pattern', function() {
        // Current regex pattern from YelpComAdapter
        const phoneRegex = /Phone number<\/p>\s*<p[^>]*data-font-weight="semibold"[^>]*>([^<]+)<\/p>/i;
        const phoneMatch = sampleHTML.match(phoneRegex);
        
        console.log('Phone regex match result:', phoneMatch);
        
        if (phoneMatch && phoneMatch[1]) {
            const phoneText = phoneMatch[1].trim();
            console.log('Extracted phone number:', phoneText);
            expect(phoneText).to.equal('(415) 324-9739');
        } else {
            console.log('❌ No phone number found with current regex');
            expect.fail('Phone number not found with current regex pattern');
        }
    });

    it('should extract phone number using improved regex patterns', function() {
        // Test multiple regex patterns
        const regexPatterns = [
            // Pattern 1: Current pattern
            /Phone number<\/p>\s*<p[^>]*data-font-weight="semibold"[^>]*>([^<]+)<\/p>/i,
            
            // Pattern 2: More flexible whitespace and attributes
            /Phone number<\/p>\s*<p[^>]*data-font-weight=["']semibold["'][^>]*>\s*([^<]+?)\s*<\/p>/i,
            
            // Pattern 3: Allow any characters between Phone number and the phone (without 's' flag)
            /Phone number<\/p>[\s\S]*?<p[^>]*data-font-weight=["']semibold["'][^>]*>\s*([^<]+?)\s*<\/p>/i,
            
            // Pattern 4: Look for phone number pattern directly
            /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
            
            // Pattern 5: More specific to the HTML structure
            /Phone number<\/p><\/div><\/div><\/div><div[^>]*><div[^>]*><div[^>]*><p[^>]*data-font-weight="semibold"[^>]*>([^<]+)<\/p>/i
        ];

        let foundPhone = false;
        
        for (let i = 0; i < regexPatterns.length; i++) {
            const regex = regexPatterns[i];
            const match = sampleHTML.match(regex);
            
            console.log(`\nTesting pattern ${i + 1}:`, regex.toString());
            
            if (match) {
                if (regex.flags.includes('g')) {
                    // Global regex returns array of matches
                    console.log('Matches found:', match);
                    for (const phoneCandidate of match) {
                        const trimmed = phoneCandidate.trim();
                        if (isValidPhoneNumber(trimmed)) {
                            console.log(`✅ Valid phone found with pattern ${i + 1}:`, trimmed);
                            expect(trimmed).to.equal('(415) 324-9739');
                            foundPhone = true;
                            break;
                        }
                    }
                } else {
                    // Non-global regex
                    console.log('Match result:', match);
                    if (match[1]) {
                        const phoneText = match[1].trim();
                        console.log(`✅ Phone found with pattern ${i + 1}:`, phoneText);
                        if (isValidPhoneNumber(phoneText)) {
                            expect(phoneText).to.equal('(415) 324-9739');
                            foundPhone = true;
                            break;
                        }
                    }
                }
            } else {
                console.log(`❌ No match with pattern ${i + 1}`);
            }
            
            if (foundPhone) break;
        }
        
        if (!foundPhone) {
            expect.fail('No valid phone number found with any regex pattern');
        }
    });

    it('should extract website URL', function() {
        const websiteRegex = /Business website<\/p>\s*<p[^>]*data-font-weight="semibold"[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/i;
        const websiteMatch = sampleHTML.match(websiteRegex);
        
        console.log('Website regex match result:', websiteMatch);
        
        if (websiteMatch && websiteMatch[1] && websiteMatch[2]) {
            const href = websiteMatch[1];
            const displayText = websiteMatch[2].trim();
            
            console.log('Website href:', href);
            console.log('Website display text:', displayText);
            
            expect(displayText).to.equal('traveldarlings.com');
            expect(href).to.include('biz_redir');
        } else {
            expect.fail('Website not found');
        }
    });

    it('should extract address', function() {
        const addressRegex = /Get Directions<\/a><\/p>\s*<p[^>]*data-font-weight="semibold"[^>]*>([^<]+)<\/p>/i;
        const addressMatch = sampleHTML.match(addressRegex);
        
        console.log('Address regex match result:', addressMatch);
        
        if (addressMatch && addressMatch[1]) {
            const addressText = addressMatch[1].trim();
            console.log('Extracted address:', addressText);
            expect(addressText).to.equal('2745 Webster St Ste 1 San Francisco, CA 94123');
        } else {
            expect.fail('Address not found');
        }
    });
});

// Helper function to validate phone number format
function isValidPhoneNumber(phone: string): boolean {
    // Remove all non-digit characters
    const digitsOnly = phone.replace(/\D/g, '');
    // Check if it has 10-15 digits (typical phone number length)
    return digitsOnly.length >= 10 && digitsOnly.length <= 15;
}
