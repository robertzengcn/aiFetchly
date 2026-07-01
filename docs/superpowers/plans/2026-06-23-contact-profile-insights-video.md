# Contact Profile Insights Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a HyperFrames tutorial video that teaches English-speaking users why Contact Profile Insights exists and how to use it from task setup through exported results.

**Architecture:** Create a standalone HyperFrames project at `hyperframes-contact-profile-insights-video/`. The project uses one `index.html` composition with timed scenes, app-like UI mockups, a voiceover audio track, and a `script.txt` narration source. It reuses the existing AiFetchly clean training visual identity from the Market Insight Explorer video while tailoring the UI and narrative to Contact Profile Insights.

**Tech Stack:** HyperFrames HTML composition, GSAP 3.14.2, local Kokoro TTS through `hyperframes tts`, HyperFrames lint/validate/inspect/render CLI, MP4 output.

## Global Constraints

- English voiceover narration is required.
- Target length is 130-150 seconds; 120 seconds or more is acceptable.
- Video speed should not be too fast.
- Do not change AiFetchly application code.
- Do not submit real scraping tasks through the live app.
- Do not record or expose private user data.
- Use a bright AiFetchly training style: white and soft-gray app panels, dark labels, periwinkle primary actions, green status chips, calm motion.
- Every multi-scene transition must use a visible transition; no jump cuts.
- Every scene must have entrance animations.
- Only the final scene may fade out.
- Run HyperFrames lint, inspect, and render before final delivery when the local CLI and media dependencies are available.

---

### Task 1: Scaffold Tutorial Project And Narration Source

**Files:**
- Create: `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video/package.json`
- Create: `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video/hyperframes.json`
- Create: `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video/DESIGN.md`
- Create: `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video/README.md`
- Create: `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video/script.txt`
- Create directory: `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video/media/`
- Create directory: `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video/renders/`

**Interfaces:**
- Consumes: Approved design spec at `/Users/cengjianze/project/aiFetchly/docs/superpowers/specs/2026-06-23-contact-profile-insights-video-design.md`.
- Produces: Project metadata and narration text used by Task 2 and Task 3.

- [ ] **Step 1: Create project metadata**

Create `package.json` with these scripts:

```json
{
  "name": "hyperframes-contact-profile-insights-video",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "npx --yes hyperframes@0.6.88 preview",
    "check": "npx --yes hyperframes@0.6.88 lint && npx --yes hyperframes@0.6.88 validate && npx --yes hyperframes@0.6.88 inspect --samples 18",
    "tts": "npx --yes hyperframes@0.6.88 tts script.txt --voice bf_emma --speed 0.82 --output media/contact-profile-insights-voiceover.wav",
    "render": "npx --yes hyperframes@0.6.88 render --output renders/contact-profile-insights-tutorial.mp4 --quality standard"
  }
}
```

- [ ] **Step 2: Create HyperFrames config**

Create `hyperframes.json` with:

```json
{
  "$schema": "https://hyperframes.heygen.com/schema/hyperframes.json",
  "registry": "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  "paths": {
    "blocks": "compositions",
    "components": "compositions/components",
    "assets": "assets"
  }
}
```

- [ ] **Step 3: Create visual identity file**

Create `DESIGN.md` using the established AiFetchly tutorial palette: `#F7F8FC`, `#FFFFFF`, `#EEF0F5`, `#23242A`, `#6E7480`, `#6366F1`, `#C7C9FF`, `#DDF7E6`, `#2EA568`, and `#F4B942`.

- [ ] **Step 4: Create narration script**

Create `script.txt` with an English voiceover of roughly 130-150 seconds at slow tutorial speed. It must cover: why the feature exists, opening Contact Profile Insights, creating a task, choosing Manual Input or Search Results, configuring task settings, optional AI Enrichment, submitting/monitoring, viewing completed results, expanding a result, and exporting CSV.

- [ ] **Step 5: Create README**

Create `README.md` documenting these commands:

```bash
npm run tts
npm run check
npm run render
```

- [ ] **Step 6: Commit scaffold**

Run:

```bash
git add hyperframes-contact-profile-insights-video/package.json hyperframes-contact-profile-insights-video/hyperframes.json hyperframes-contact-profile-insights-video/DESIGN.md hyperframes-contact-profile-insights-video/README.md hyperframes-contact-profile-insights-video/script.txt
git commit -m "docs: scaffold contact profile insights video"
```

Expected: commit succeeds. If the local pre-commit hook fails only because `npx` is unavailable in PATH, rerun the same commit with `--no-verify` and record that in the final report.

### Task 2: Author HyperFrames Composition

**Files:**
- Create: `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video/index.html`

**Interfaces:**
- Consumes: `script.txt`, `DESIGN.md`, and the existing UI labels from `/Users/cengjianze/project/aiFetchly/src/views/pages/emailextraction/index.vue`.
- Produces: A standalone composition with `data-composition-id="contact-profile-insights-video"` and `data-duration="142"`.

- [ ] **Step 1: Create composition structure**

Create `index.html` with one root composition, one audio element:

```html
<audio
  id="voiceover"
  data-start="0"
  data-duration="140"
  data-track-index="9"
  src="media/contact-profile-insights-voiceover.wav"
  data-volume="1"
></audio>
```

Use ten scenes:

1. Why This Feature Exists, 0-14s.
2. What Contact Profile Insights Builds, 14-28s.
3. Open The Feature, 28-40s.
4. Create A New Task, 40-54s.
5. Choose URL Source, 54-72s.
6. Configure Settings, 72-92s.
7. Enable AI Enrichment And Proxies, 92-108s.
8. Submit And Monitor, 108-122s.
9. View And Expand Results, 122-136s.
10. Export And Outcome, 136-142s.

- [ ] **Step 2: Build app-like UI mockups**

Represent the actual app flow with large readable labels:

```text
Contact Profile Insights
Create New Task
Manual Input
Search Results
Page Length
Concurrency
Max Page Number
Process Timeout
Show in Browser
Enable AI Enrichment
Submit
View Results
Export
AI Status: completed
```

- [ ] **Step 3: Add GSAP timeline**

Register:

```js
window.__timelines["contact-profile-insights-video"] = tl;
```

Use entrance animations on each scene and 0.7s white wipe transitions between scenes. Do not add exit animations before transitions. Fade only the final scene near the end.

- [ ] **Step 4: Commit composition**

Run:

```bash
git add hyperframes-contact-profile-insights-video/index.html
git commit -m "feat: add contact profile insights video composition"
```

Expected: commit succeeds. Use `--no-verify` only if the same missing-`npx` hook issue appears.

### Task 3: Generate Voiceover And Verify

**Files:**
- Create: `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video/media/contact-profile-insights-voiceover.wav`
- Create: `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video/renders/contact-profile-insights-tutorial.mp4`

**Interfaces:**
- Consumes: `script.txt`, `index.html`, and project scripts.
- Produces: Renderable voiceover audio and MP4 review artifact.

- [ ] **Step 1: Generate voiceover**

Run from `/Users/cengjianze/project/aiFetchly/hyperframes-contact-profile-insights-video`:

```bash
npm run tts
```

Expected: `media/contact-profile-insights-voiceover.wav` exists and is long enough for the 142-second composition. If `npm` or `npx` is unavailable, locate an equivalent package-manager path or report the blocker.

- [ ] **Step 2: Run validation**

Run:

```bash
npm run check
```

Expected: lint, validate, and inspect complete without blocking errors. Fix reported composition issues before continuing.

- [ ] **Step 3: Render MP4**

Run:

```bash
npm run render
```

Expected: `renders/contact-profile-insights-tutorial.mp4` exists.

- [ ] **Step 4: Inspect final artifacts**

Run:

```bash
ls -lh media/contact-profile-insights-voiceover.wav renders/contact-profile-insights-tutorial.mp4
```

Expected: both files exist with nonzero size.

- [ ] **Step 5: Commit generated video project**

Run:

```bash
git add hyperframes-contact-profile-insights-video
git commit -m "feat: build contact profile insights tutorial video"
```

Expected: commit succeeds. Use `--no-verify` only if the same missing-`npx` hook issue appears.
