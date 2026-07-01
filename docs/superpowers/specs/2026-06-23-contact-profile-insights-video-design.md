# Contact Profile Insights Tutorial Video Design

## Goal

Create an English product-training video that teaches users why AiFetchly's Contact Profile Insights feature matters and how to use it from task creation through final results. The video should be clear enough for a first-time user to follow at a comfortable pace.

## Audience

AiFetchly users who want to collect public contact information from websites, directories, or existing search results and turn it into structured outreach-ready contact profiles.

## Recommended Format

Use a guided product walkthrough built in HyperFrames:

- English voiceover narration.
- Large readable on-screen captions and step labels.
- App-like UI recreations based on the live Electron interface.
- Cursor highlights and focus rings for important controls.
- A final results scene showing completed AI-enriched contact profiles.

This approach gives a clean, controllable tutorial without relying on fragile live screen recording timing.

## Length And Pace

Target duration: 130-150 seconds.

The video should move slowly enough that users can understand each step. It should avoid rapid cuts, crowded text, and fast cursor movement.

## Narrative Arc

1. Explain the problem: public contact details are scattered across websites and search results, and manual collection is slow and inconsistent.
2. Introduce Contact Profile Insights as the way to turn URLs into structured contact profiles.
3. Navigate to Contact Profile Insights from the app sidebar.
4. Create a new task.
5. Choose the input source:
   - Manual Input for custom URL lists.
   - Search Results for URLs already collected by Market Insight Explorer.
6. Configure task settings:
   - Page Length.
   - Concurrency.
   - Max Page Number.
   - Process Timeout.
   - Show in Browser.
   - Optional proxies.
   - Optional AI Enrichment for phone, address, and social links.
7. Submit the task and return to the task list.
8. Open a completed task's results.
9. Show the results table with URL, record time, phone, address, social links, and AI status.
10. Expand one result row to show discovered emails and enriched profile details.
11. End by showing Export as the final action for using the results in outreach.

## Visual Identity

Reuse the existing AiFetchly HyperFrames training style from the Market Insight Explorer video:

- Bright app workspace.
- White and soft-gray panels.
- Dark readable UI labels.
- Periwinkle primary action buttons.
- Green completion/status chips.
- Minimal decoration.
- Calm, operational motion.

The new video project should include its own `DESIGN.md` copied or adapted from that established style, with feature-specific wording for Contact Profile Insights.

## Voiceover Direction

Voiceover should be friendly, instructional, and direct. It should avoid hype and keep sentences short enough to match visible UI actions.

Tone example:

"Contact Profile Insights helps you turn websites into structured contact profiles. Instead of checking every page by hand, AiFetchly visits the URLs, scans for public email addresses, and can use AI to enrich each profile with phone numbers, addresses, and social links."

## Scenes

1. **Why This Feature Exists**: scattered websites become structured profiles.
2. **Open The Feature**: sidebar focus on Contact Profile Insights.
3. **Create A Task**: task list and Create New Task button.
4. **Choose URL Source**: Manual Input and Search Results options.
5. **Configure The Task**: settings panel with slow callouts.
6. **Enable AI Enrichment**: explain optional enriched fields.
7. **Submit And Monitor**: task moves to processing/completed state.
8. **View Results**: completed task opens the detail table.
9. **Inspect A Profile**: expanded row shows emails and enriched fields.
10. **Export Results**: CSV export as the closing outcome.

## Verification

Before final delivery:

- Run HyperFrames lint.
- Run HyperFrames inspect with timeline samples.
- Render a draft MP4.
- Check the video visually for readable text, correct pacing, nonblank frames, and synchronized voiceover.
- Render the final MP4 after fixes.

## Out Of Scope

- Changing the AiFetchly application code.
- Submitting real scraping tasks through the live app.
- Recording or exposing private user data.
- Translating this tutorial into non-English languages.
