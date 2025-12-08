1. The Architecture Flow
You should not feed raw HTML directly to the LLM. It is too token-heavy (expensive and slow) and contains too much noise (scripts, styles). You need a pipeline.

Shutterstock

The Workflow:

Puppeteer: Load page -> Handle SPA rendering -> Identify "Contact" links.

Pre-processing: Convert HTML to simplified Text/Markdown (remove noise).

LLM (The Brain): Analyze the text -> Extract entities -> Format as JSON.

Electron: Display results to the user.

2. Step-by-Step Implementation Strategy
Step 1: Smart Navigation (Puppeteer)
Contact information is often not on the homepage. It is usually on a /contact, /about, or /support page.

Logic:

Scrape the homepage.

Look for <a> tags where the href or innerText contains "Contact", "About", or "Support".

Navigate to that specific page to scrape the details.

Step 2: Cleaning the Content (Crucial)
LLMs have "context windows." Sending a 5MB raw HTML string will crash your request or cost a fortune.

Don't use: page.content() (Too messy).

Do use: document.body.innerText OR a library like turndown (converts HTML to Markdown). Markdown is excellent for LLMs because it preserves structure (headers, lists) without the tag overhead.


Code snippet (Puppeteer cleanup):

JavaScript

// Inside your Puppeteer evaluation
const cleanText = await page.evaluate(() => {
  // Remove scripts, styles, and SVGs to save tokens
  const scripts = document.querySelectorAll('script, style, svg, noscript');
  scripts.forEach(n => n.remove());
  
  // Return readable text (or use a library like Readability.js here)
  return document.body.innerText;
});
Step 3: The LLM Integration
For an Electron app, you have two main choices for the LLM:

Option A: Cloud API (OpenAI / Anthropic / Gemini)

Pros: Extremely smart, easy to implement, no hardware requirement for the user.

Cons: Costs money per scrape, requires internet, privacy concerns.

Recommendation: Use OpenAI GPT-4o-mini. It is very cheap, fast, and smart enough for extraction.

Option B: Local LLM (Ollama / Llama-3)

Pros: Free (after download), private, works offline.

Cons: Heavy download (4GB+), requires user to have good RAM/GPU, complex to bundle with Electron.

Recommendation: Only do this if privacy is the #1 selling point.

Step 4: Prompt Engineering (The "Secret Sauce")
You must force the LLM to return JSON. If it returns chatty text ("Here is the email I found..."), your code will break.

The Prompt Strategy:

Define a schema.

Ask for JSON strictly.

Handle "Not Found" scenarios (return null, don't hallucinate).

3. Practical Code Example
Here is how you might structure the extraction function in your Electron main process or a utility file.

Prerequisites: npm install puppeteer openai

JavaScript

import puppeteer from 'puppeteer';
import OpenAI from 'openai';

// Initialize OpenAI (You might ask the user for their Key in the UI)
const openai = new OpenAI({ apiKey: 'YOUR_API_KEY' });

async function scrapeContactInfo(url) {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  try {
    // 1. Go to URL
    await page.goto(url, { waitUntil: 'networkidle0' });

    // 2. Heuristic: Check if there is a better "Contact" link
    // (Simplified logic: usually you'd check hrefs and click)
    
    // 3. Extract and Clean Content
    // We limit the text length to prevent token overflow
    const pageText = await page.evaluate(() => {
        // Simple cleanup
        document.querySelectorAll('script, style, img, svg').forEach(e => e.remove());
        return document.body.innerText.substring(0, 15000); // 15k char limit
    });

    // 4. Send to LLM
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cost-effective model
      response_format: { type: "json_object" }, // FORCE JSON
      messages: [
        {
          role: "system",
          content: `You are a data extraction assistant. 
          Extract the following fields from the website text:
          - email (string or null)
          - phone (string or null)
          - address (string or null)
          - social_links (array of strings)
          
          Return the output strictly as valid JSON.`
        },
        {
          role: "user",
          content: `Website Content:\n${pageText}`
        }
      ]
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return result;

  } catch (error) {
    console.error("Scraping failed:", error);
    return null;
  } finally {
    await browser.close();
  }
}
4. Advanced Optimization Tips
Hybrid Approach (Cost Saving):

Regex is free and fast. Before calling the LLM, run a simple Regex for emails. If you find what you need, skip the LLM. Only use the LLM for hard stuff like Addresses (which have no standard format) or if Regex fails.

Vision LLMs:

Sometimes contact info is hidden in an image (e.g., a footer image) to prevent bot scraping.

Standard text scraping fails here.

Solution: Puppeteer can take a screenshot (page.screenshot()), and you can pass that image to GPT-4o-Vision. It can read the text off the image.

Electron Security:

If you release this app to the public, do not hardcode your API Key.

Add a "Settings" page in your Electron app where the user inputs their own OpenAI API Key, or route requests through your own backend server where you hold the key.

Handling "Click to Reveal":

Some sites hide phone numbers behind a "Click to Show" button.

Puppeteer is vital here. You can ask the LLM: "What is the CSS selector for the reveal button?" (based on HTML structure), then have Puppeteer click it before extracting text.

For the step2, how can I find /contact, /about,/support page on a website?

You cannot rely on simply guessing the URL (like website.com/contact) because modern websites use unpredictable structures (e.g., /company/about-us, /support-center, or even a single-page application hash like /#contact).

The most robust way is to mimic human behavior: Scan the Homepage for specific keywords in links, score them, and click the best one.

Here is a 3-stage strategy to achieve this with Puppeteer.

Strategy 1: The Heuristic Scanner (Fastest & Most Reliable)
This method grabs all <a> tags from the homepage and uses a scoring system to find the most likely candidate. It checks both the visible text (e.g., "Contact Us") and the URL itself (e.g., href="/contact").

Shutterstock

Here is a ready-to-use function for your Electron app:

JavaScript

async function findContactPage(page) {
  // 1. Get all links from the page
  // We extract the href, innerText, and aria-label to analyze them
  const potentialLinks = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a'));
    
    return anchors.map(a => ({
      href: a.href,
      text: a.innerText.toLowerCase().trim(),
      aria: (a.getAttribute('aria-label') || '').toLowerCase(),
      // Check if it is visible (not hidden in a hamburger menu we haven't opened)
      visible: a.offsetWidth > 0 && a.offsetHeight > 0 
    })).filter(link => link.href && !link.href.startsWith('javascript'));
  });

  // 2. Define keywords and their "Priority Score"
  // Higher score = better match
  const keywords = [
    { word: 'contact', score: 10 },
    { word: 'get in touch', score: 8 },
    { word: 'support', score: 6 },
    { word: 'about', score: 4 },
    { word: 'help', score: 2 }
  ];

  let bestLink = null;
  let highestScore = 0;

  // 3. Score the links
  for (const link of potentialLinks) {
    let currentScore = 0;

    // Check visible text (Human readable)
    keywords.forEach(k => {
      if (link.text.includes(k.word)) currentScore += k.score;
    });

    // Check the URL slug (Technical readable)
    // We prefer "/contact" over a blog post "about-our-contact-lens"
    keywords.forEach(k => {
      if (link.href.includes(k.word)) currentScore += (k.score / 2); // Weighted less
    });

    // Penalize "mailto" links if you want a PAGE, not an email trigger
    // If you want the email directly, you can catch this here!
    if (link.href.startsWith('mailto:')) {
        // You might want to save this email immediately and return null!
        console.log("Found direct email:", link.href);
        continue; 
    }

    // Update best link
    if (currentScore > highestScore) {
      highestScore = currentScore;
      bestLink = link.href;
    }
  }

  return bestLink; // Returns the URL string or null
}
Strategy 2: The "Fallback" Brute Force
If the heuristic scanner finds nothing (perhaps the site uses icons without text, or obscure navigation), you can try a "Hail Mary" list of standard paths.

JavaScript

async function checkStandardRoutes(page, baseUrl) {
  const commonPaths = ['/contact', '/contact-us', '/about', '/about-us', '/support'];
  
  for (const path of commonPaths) {
    const urlToCheck = new URL(path, baseUrl).toString();
    
    try {
      // Use 'head' request if possible to save bandwidth, 
      // but in Puppeteer we just navigate.
      const response = await page.goto(urlToCheck, { waitUntil: 'domcontentloaded' });
      
      // If we don't get a 404, we assume it's valid
      if (response.status() === 200) {
        return urlToCheck;
      }
    } catch (e) {
      // Ignore navigation errors
    }
  }
  return null;
}
Strategy 3: Dealing with Footer Links
Often, contact links are hidden in the footer and might not be visible initially if the page uses "lazy loading" or infinite scroll.

Tip: Before running the extraction script in Strategy 1, verify if you need to scroll to the bottom.

JavaScript

// Scroll to bottom to ensure footer links are rendered
await page.evaluate(async () => {
    await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if(totalHeight >= scrollHeight){
                clearInterval(timer);
                resolve();
            }
        }, 100);
    });
});
How to combine them (The Logic Flow)
Direct Check: Does the homepage already have the phone number/email? (Scan the homepage text first).

Heuristic Scan: Run findContactPage(). If it returns a URL, go there.

Fallback: If logic returns null, run checkStandardRoutes().

Important Edge Case: "mailto:" and "tel:" My code in Strategy 1 filters out mailto: links, but these are gold. If findContactPage encounters a link like <a href="mailto:ceo@company.com">, you should capture that data immediately rather than trying to navigate to it (which would try to open the user's email client on their desktop).