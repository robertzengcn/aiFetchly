# Local Business Finder Video Design

## Goal

Create a short English product-training video that teaches AiFetchly users what the Local Business Finder solves, what it does, and how to run a search from setup through exported results.

## Source Material

- Manual: `/Users/cengjianze/project/aifetchly-manual/docs/lead-generation/google-maps-scraper.md`
- Existing video visual identity: `hyperframes-search-engine-scraping-video/DESIGN.md` and `hyperframes-market-insight-explorer-video/DESIGN.md`

## Audience

Users who need local business leads and want a guided, practical walkthrough. The video should assume they know AiFetchly exists but have not used Local Business Finder before.

## Narrative

1. Problem: collecting local business leads manually from map platforms is slow, repetitive, and hard to organize.
2. Function: Local Business Finder searches Google Maps or Yandex Maps by keyword and location, then organizes business names, categories, ratings, reviews, addresses, phones, websites, and Maps URLs.
3. Steps:
   - Open Local Business Finder.
   - Choose Google Maps or Yandex Maps.
   - Enter a business keyword and location.
   - Configure max results, website inclusion, reviews, and browser visibility.
   - Optionally choose an account and proxies.
   - Start the search and monitor progress.
4. Result: show a completed table and the export actions: Copy All, Export CSV, and Export JSON.

## Format

- 1920x1080 landscape video.
- About 80-100 seconds.
- English generated voiceover.
- On-screen captions or concise scene labels must support the voiceover.
- Render final MP4 into the HyperFrames project `renders/` directory.

## Visual Identity

Use the existing AiFetchly product-training look:

- Canvas: `#F7F8FC`
- Surface: `#FFFFFF`
- Surface muted: `#EEF0F5`
- Text primary: `#23242A`
- Text secondary: `#6E7480`
- Primary action: `#6366F1`
- Primary action soft: `#C7C9FF`
- Success/status: `#DDF7E6`
- Success text: `#2EA568`
- Warning/accent: `#F4B942`
- Typography: `Inter`, `Helvetica Neue`, `Arial`, sans-serif

The visuals should use credible product UI mockups rather than abstract marketing graphics. Avoid dark cyber styling, gradient text, decorative blobs, and crowded manual dumps.

## Composition Structure

1. Opening problem frame: manual research versus organized lead capture.
2. Feature overview frame: source tabs, keyword/location fields, and data captured.
3. Setup walkthrough frame: Google/Yandex source choice and search criteria.
4. Options walkthrough frame: max results, include website, include reviews, show browser.
5. Account/proxy frame: optional account cookies and regional proxies.
6. Running search frame: progress bar, concurrent search cue, cancel note.
7. Results frame: completed table with lead data and export buttons.
8. Closing frame: results ready for outreach workflows.

## Voiceover Script

"Finding local business leads one by one can eat hours. You search maps, open listings, copy details, check websites, and still end up with a messy spreadsheet.

AiFetchly's Local Business Finder turns that manual work into an organized search. Choose Google Maps for global coverage, or Yandex Maps for Russia, CIS markets, and Turkey.

Start by opening Local Business Finder from the left navigation. In the Search tab, select your data source, then enter the business type you want, like dentist, Italian restaurant, plumber, or marketing agency.

Next, enter the target location. You can use a city, address, zip code, or a wider region. More specific locations usually produce more relevant leads.

Now tune the search. Set the maximum results from 1 to 50, include website URLs if you want outreach-ready records, and turn on reviews only when you need extra detail. Show Browser is usually off, unless you are debugging.

For Yandex searches, set language and region when needed. For higher success rates, you can also select a matching account and rotate proxies, especially for larger searches or regional markets.

Click Start Search. AiFetchly runs the search in the background, shows live progress, and lets you cancel while keeping partial results. You can run up to three searches at the same time.

When the search finishes, the results table gives you names, categories, ratings, review counts, addresses, phone numbers, websites, and map links.

From here, copy everything as JSON, export CSV for spreadsheets, or export JSON for downstream tools. Local Business Finder gives you structured local leads, ready for your next outreach step."

## Verification

- `npx hyperframes lint` must pass.
- `npx hyperframes inspect --samples 15` must report no layout errors.
- `npx hyperframes render --quality standard` must produce an MP4.
- The final scene must visibly show completed results and export options.
