Input (The Criteria): You must let the user define their "Ideal Customer Profile" (ICP) in your app settings.

Scrape (The Evidence): Puppeteer gathers "About Us" text, Meta descriptions, and H1/H2 headers (clues about business nature).

LLM (The Judge): The LLM compares the Evidence against the Criteria and assigns a score (0-100) with a reasoning.

Step 1: The Scraper (Focus on "Business Intent")
Unlike scraping contact info, here we don't care about phone numbers. We care about Identity. We need to feed the LLM the "Meta Description" (the elevator pitch) and the main body text.

The Strategy:

Meta Tags: Often contain the most concise summary of a business.

Headers (H1-H3): Usually describe the service offering.

Home/About Page: We need to scan both to understand the business model.

Step 2: The Prompt Engineering (The Core Logic)
You cannot just ask "Is this a customer?". The LLM doesn't know your business. You must structure the prompt dynamically.

The Prompt Structure:

Role: You are a B2B Sales Research Analyst. My Business: [User inputs what they sell, e.g., "I sell high-end coffee machines to offices"] Target Website Content: [Scraped text from website] Task: Analyze if the target is a good fit. Output: JSON { match_score: 0-100, reason: "string", qualified: boolean }

Step 3: Implementation Code
Here is a complete function to integrate into your Electron app.

JavaScript

import puppeteer from 'puppeteer';
import OpenAI from 'openai';

// 1. User Configuration (Store this in your App Settings)
const userConfig = {
    myProduct: "Enterprise SEO Software",
    targetAudience: "Marketing agencies or large e-commerce brands with high traffic.",
    negativeCriteria: "Small local businesses, personal blogs, non-profits."
};

async function qualifyLead(url, config) {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    try {
        // --- A. Scrape Business Signals ---
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        const siteData = await page.evaluate(() => {
            // Get Meta Description (High value signal)
            const meta = document.querySelector('meta[name="description"]');
            const description = meta ? meta.content : "";

            // Get Main Headers (What do they claim to do?)
            const headers = Array.from(document.querySelectorAll('h1, h2'))
                                 .map(h => h.innerText)
                                 .join(' | ');

            // Get first 1000 characters of body text (Cost saving)
            const body = document.body.innerText.substring(0, 1000).replace(/\s+/g, ' ');

            return `Title: ${document.title}\nDescription: ${description}\nHeaders: ${headers}\nContent snippet: ${body}`;
        });

        // --- B. The LLM Analysis ---
        const openai = new OpenAI({ apiKey: 'YOUR_KEY' }); // Secure this!

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Fast & Cheap
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You are a Lead Qualification Bot. 
                    I will give you my "Ideal Customer Profile" and data from a website.
                    
                    Your Goal: Determine if this website is a potential customer for me.
                    
                    My Product/Service: "${config.myProduct}"
                    My Ideal Customer: "${config.targetAudience}"
                    Avoid these: "${config.negativeCriteria}"
                    
                    Return JSON format:
                    {
                        "is_potential_customer": boolean,
                        "confidence_score": number (0-100),
                        "summary": "One sentence describing what this company does",
                        "reasoning": "Why they fit or do not fit my profile"
                    }`
                },
                {
                    role: "user",
                    content: `Analyze this website data:\n${siteData}`
                }
            ]
        });

        const analysis = JSON.parse(completion.choices[0].message.content);
        return analysis;

    } catch (error) {
        console.error(`Analysis failed for ${url}:`, error);
        return { is_potential_customer: false, error: "Failed to scrape" };
    } finally {
        await browser.close();
    }
}

// Usage Example
// qualifyLead('https://www.some-agency.com', userConfig).then(console.log);
Step 4: Batch Processing in Electron (UI UX)
Since you have a list of URLs, you cannot run them all at once or your user's computer will freeze (launching 50 Chrome instances is bad).

Use a Queue: Use a library like p-queue or async to limit concurrency.

Concurrency Limit: Set concurrency to 2. This means only 2 websites are analyzed at a time.

Progress Bar: Since this process is slow (approx. 5-10 seconds per site), you must show a progress bar in the UI.

JavaScript

import PQueue from 'p-queue';

// Limit to 2 concurrent browsers to save RAM
const queue = new PQueue({ concurrency: 2 });

const urls = ['site1.com', 'site2.com', 'site3.com', ...];

urls.forEach(url => {
    queue.add(async () => {
        const result = await qualifyLead(url, userConfig);
        // Send result to Electron Renderer (UI) immediately
        mainWindow.webContents.send('lead-analyzed', { url, result });
    });
});
Advanced Tip: The "About Us" Pivot
Sometimes the Homepage is vague (e.g., "We Create Future.").

If the initial scrape yields a low confidence score (e.g., the description is too short), modify your script to:

Look for a link containing "About".

Navigate there.

Scrape that text.

Re-run the LLM check.

This "Double-Check" mechanism significantly increases accuracy for vague corporate websites.