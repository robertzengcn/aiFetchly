# AiFetchly Market Insight Explorer Tutorial Video

This HyperFrames project creates a 16:9 tutorial video teaching users how to use Market Insight Explorer in AiFetchly.

Source manual:

`/Users/cengjianze/project/aifetchly-manual/docs/lead-generation/search-engines.md`

## Storyboard

1. Intro: Market Insight Explorer turns public search results into lead lists.
2. Navigate: open Market Insight, then Market Insight Explorer.
3. Configure: enter one keyword per line, optionally generate related keywords, and choose Google, Bing, or Yandex.
4. Reliability settings: page number, concurrency, proxies, local browser, search engine account, show browser, and AI recovery.
5. Execute: Submit to run now or Save Only to create the task.
6. Manage: open Search Task List, run/retry/edit/view results/download logs.
7. Improve leads: AI Analyze, AI Profile Insights, Build Contact Profiles, and Export.
8. Best practices: start small, use proxies, use local browser for Yandex, and focus on 70%+ leads.

## Commands

From this directory, use HyperFrames CLI:

```bash
npx hyperframes lint
npx hyperframes inspect --samples 12
npx hyperframes preview --port 3018
npx hyperframes render --output renders/aifetchly-market-insight-explorer.mp4 --quality standard
```

Preview URL:

`http://localhost:3018/#project/hyperframes-market-insight-explorer-video`

## Narration Text

Welcome to AiFetchly Market Insight Explorer. In this walkthrough, you will create a search task, configure reliable collection options, review results, and turn public search results into qualified leads.

Start from the left navigation. Open Market Insight, then choose Market Insight Explorer. This is where you define the public sources or industry keywords you want to organize.

Add your keywords, one per line. Use specific terms for better lead quality. If AI is enabled, Generate Related Keywords can expand your list and remove duplicates.

Choose a supported search engine: Google, Bing, or Yandex. For Yandex, turn on local browser integration before running the task.

Set the starting page and concurrent quantity. Start with one to three concurrent searches, then increase gradually when proxies and accounts are ready.

For more reliable runs, choose proxies, enable local browser for human-like behavior, select search engine accounts when needed, turn on Show in Browser when debugging, and enable AI Recovery for difficult public source access errors.

When everything looks right, Submit runs the task immediately. Save Only stores the task so you can run it later from the task list.

Use Search Task List to monitor status, retry errors, edit settings, stop running jobs, view results, or download logs.

In Search Task Detail, select rows and use AI Analyze to score lead quality and classify industries. Then use AI Profile Insights or Build Contact Profiles to organize public contact information.

Export the final results and focus outreach on high-probability leads, especially scores above seventy percent.
