# AiFetchly Search Engine Scraping Tutorial Video

This HyperFrames project creates a 16:9 tutorial video teaching users how to use Search Engine Scraping in AiFetchly.

Source manual:

`/Users/cengjianze/project/aifetchly-manual/docs/lead-generation/search-engines.md`

## Storyboard

1. Intro: Search Engine Scraping turns search results into lead lists.
2. Navigate: open Search, then Search Scraper.
3. Configure: enter one keyword per line, optionally generate related keywords, choose Google/Bing/Yandex.
4. Safety settings: page number, concurrency, proxies, local browser, search account, show browser, AI recovery.
5. Execute: Submit to run now or Save Only to create the task.
6. Manage: open Search Task List, run/retry/edit/view results/download logs.
7. Improve leads: AI Analyze, AI Extract Contact Info, Extract Emails, Export CSV.
8. Best practices: start small, use proxies, use local browser for Yandex or scale, focus on 70%+ leads.

## Commands

From this directory, use HyperFrames CLI when available:

```bash
npx hyperframes lint
npx hyperframes inspect --samples 12
npx hyperframes preview --port 3017
npx hyperframes render --output renders/aifetchly-search-engine-scraping.mp4 --quality standard
```

Preview URL:

`http://localhost:3017/#project/hyperframes-search-engine-scraping-video`

## Narration Text

Welcome to AiFetchly Search Engine Scraping. In this walkthrough, you will create a search task, configure reliable scraping options, review results, and turn those results into qualified leads.

Start from the left navigation. Open Search, then choose Search Scraper. This is where you define what the app should search for.

Add your keywords, one per line. Use specific terms for better lead quality. If AI is enabled, Generate Related Keywords can expand your list and remove duplicates.

Choose the search engine: Google, Bing, or Yandex. Google is great for broad coverage, Bing is often forgiving, and Yandex requires local browser mode.

Set the starting page and concurrency. Start with one to three concurrent searches, then increase gradually when proxies and accounts are ready.

For more reliable scraping, choose proxies, enable local browser for human-like behavior, select search accounts when needed, and enable AI Recovery for large or difficult runs.

When everything looks right, Submit runs the task immediately. Save Only stores the task so you can run it later from the task list.

Use Search Task List to monitor status, retry errors, edit settings, stop running jobs, view results, or download logs.

In Results, select rows and use AI Analyze to score lead quality and classify industries. Then use AI Extract Contact Info to find emails, phone numbers, and addresses.

Export the final results as CSV and focus outreach on high-probability leads, especially scores above seventy percent.
