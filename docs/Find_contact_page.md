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

