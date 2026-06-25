This is a common scenario in large-scale scraping. You cannot rely on a human to provide the entity name for every URL.To make your system work with only a list of URLs, you must modify your architecture to derive the targetEntity and use the LLM's generalized knowledge to find the contact details of the website's primary organization.Here is the 3-step solution to adapt your existing workflow.1. Step 1: Impute the targetEntity (Self-Correction)Since you don't have the entity name, you can have your Puppeteer script automatically generate a highly probable name to use as context for the LLM.You can derive a name using three reliable, free methods before you call the LLM for extraction:MethodSourceUse CaseDomain Namenew URL(url).hostnameMost reliable for company websites (e.g., apple.com $\rightarrow$ "Apple")Page Titlepage.title()Good for specific listings, as titles often contain the entity name.H1 Tagdocument.querySelector('h1').innerTextExcellent for product or directory pages where the entity name is the primary heading.Code AdaptationYou can add this step inside your main scrapeContactInfo function:JavaScriptasync function scrapeContactInfo(url) {
  // ... browser and page initialization ...
  
  try {
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    // --- NEW: Derive the Target Entity Name ---
    let pageTitle = await page.title();
    
    // Simple derivation: Use the main domain name as a fallback entity name
    let derivedEntity = new URL(url).hostname
                                    .replace('www.', '')
                                    .split('.')[0]
                                    .toUpperCase(); 

    // Use the page title as the best guess if it's more specific
    const targetEntity = pageTitle.includes(derivedEntity) ? pageTitle : derivedEntity;
    console.log(`Derived Target Entity: ${targetEntity}`);
    // ------------------------------------------

    // Existing: Use Heuristic Scanner to navigate to the Contact Page
    // (This logic is already robust and does not require targetEntity)
    const contactPageUrl = await findContactPage(page);
    if (contactPageUrl) {
        await page.goto(contactPageUrl, { waitUntil: 'networkidle0' });
    }
    
    // Existing: Extract and Clean Content
    const pageText = await page.evaluate(() => {
        // ... (cleanup code provided in search_contact.md) ...
        document.querySelectorAll('script, style, img, svg').forEach(e => e.remove());
        return document.body.innerText.substring(0, 15000); 
    });

    // ... continue to Step 2 ...
2. Step 2: Modify the LLM PromptThe goal of the LLM shifts from "find the details for X entity" to "find the primary contact details on this page." The derived entity name is still provided to give it context, helping it filter out contact information for website developers or secondary businesses.Original LLM Prompt (from your file):RoleContent (Goal: Extract specific fields)systemYou are a data extraction assistant. Extract the following fields from the website text...userWebsite Content: \n${pageText}Modified LLM Prompt (Goal: Use Context to Identify Primary Entity):The only change is in the system instruction, where you insert the derived entity name to help the LLM contextualize the information.JavaScript// 4. Send to LLM
const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  response_format: { type: "json_object" }, 
  messages: [
    {
      role: "system",
      content: `You are a data extraction assistant. The entity associated with this page is **${targetEntity}**.
      Extract the PRIMARY contact information for this entity from the website text:
      - email (string or null)
      - phone (string or null)
      - address (string or null)
      - social_links (array of strings)
      
      Return the output strictly as valid JSON. If you cannot find the primary entity's contact, return null for those fields.`
    },
    {
      role: "user",
      content: `Website Content:\n${pageText}`
    }
  ]
});
By telling the LLM the page's likely subject is ${targetEntity}, you give it enough context to distinguish between, for example, the phone number of "Acme Solutions" and the phone number of "Web Designer Pro."3. Step 3: Rely on Robust Navigation (The Heuristic Scanner)The core strength of your solution for handling diverse URLs lies in your Heuristic Scanner logic.The findContactPage function you provided does not require the targetEntity to work. It simply looks for links containing keywords like "contact," "about," and "support" and scores them based on text and URL.The complete, robust flow for any URL is:Direct Check: Scan the homepage text for a direct email/phone number.Heuristic Scan: Run findContactPage() to find the most likely contact URL (e.g., /contact-us). If a mailto: link is found, capture the email immediately and skip navigation.Fallback Brute Force: If the Heuristic Scan fails, check standard routes like /contact, /about-us.Extract with LLM: Navigate to the best URL found and use the LLM (with the derived entity name) to extract the final, structured JSON data.This flow is resilient because the navigation (Puppeteer) is separate from the final extraction (LLM), allowing each tool to specialize and requiring minimal external input.