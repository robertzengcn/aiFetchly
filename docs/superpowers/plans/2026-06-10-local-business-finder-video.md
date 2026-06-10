# Local Business Finder Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and render an English voiceover product-training video for AiFetchly's Local Business Finder.

**Architecture:** Create one self-contained HyperFrames project with a root `index.html`, `DESIGN.md`, generated narration audio, and final MP4 render. The composition uses credible mocked AiFetchly UI screens synchronized to the voiceover and validates with HyperFrames lint and visual inspect.

**Tech Stack:** HyperFrames CLI, HTML/CSS, GSAP timeline animation, generated English TTS audio, FFmpeg-backed MP4 rendering.

---

## File Structure

- Create: `hyperframes-local-business-finder-video/DESIGN.md` — visual identity for this video, adapted from existing AiFetchly training videos.
- Create/Modify: `hyperframes-local-business-finder-video/index.html` — main HyperFrames composition with scenes, captions, timed audio, and animation.
- Create: `hyperframes-local-business-finder-video/script.txt` — narration text used for TTS generation.
- Create: `hyperframes-local-business-finder-video/media/local-business-finder-voiceover.wav` — generated English narration.
- Create: `hyperframes-local-business-finder-video/renders/local-business-finder.mp4` — final rendered video.

### Task 1: Scaffold HyperFrames Project

**Files:**
- Create: `hyperframes-local-business-finder-video/`

- [ ] **Step 1: Create the project**

Run:

```bash
PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH npx hyperframes init hyperframes-local-business-finder-video --non-interactive
```

Expected: a new HyperFrames project directory exists with `index.html` and project support files.

- [ ] **Step 2: Commit scaffold**

```bash
git add hyperframes-local-business-finder-video
PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH git commit -m "chore: scaffold local business finder video"
```

### Task 2: Add Visual Identity and Voiceover Script

**Files:**
- Create: `hyperframes-local-business-finder-video/DESIGN.md`
- Create: `hyperframes-local-business-finder-video/script.txt`

- [ ] **Step 1: Write `DESIGN.md`**

Use the palette and typography from `docs/superpowers/specs/2026-06-10-local-business-finder-video-design.md` with Local Business Finder-specific wording.

- [ ] **Step 2: Write `script.txt`**

Use the full voiceover script from the spec, preserving the paragraph order.

- [ ] **Step 3: Generate voiceover**

Run:

```bash
cd hyperframes-local-business-finder-video && PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH npx hyperframes tts script.txt --voice af_nova --output media/local-business-finder-voiceover.wav
```

Expected: `media/local-business-finder-voiceover.wav` exists and is readable.

- [ ] **Step 4: Commit identity and narration assets**

```bash
git add hyperframes-local-business-finder-video/DESIGN.md hyperframes-local-business-finder-video/script.txt hyperframes-local-business-finder-video/media/local-business-finder-voiceover.wav
PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH git commit -m "feat: add local business finder narration"
```

### Task 3: Build the Composition

**Files:**
- Modify: `hyperframes-local-business-finder-video/index.html`

- [ ] **Step 1: Replace the starter composition**

Build a 1920x1080 root composition with:

- `data-composition-id="local-business-finder-video"`
- one timed `<audio>` clip using `media/local-business-finder-voiceover.wav`
- eight visual scenes matching the spec
- soft wipe transitions between scenes
- GSAP entrance animations for every scene element
- final scene showing completed results and export controls

- [ ] **Step 2: Commit composition**

```bash
git add hyperframes-local-business-finder-video/index.html
PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH git commit -m "feat: build local business finder video composition"
```

### Task 4: Validate and Render

**Files:**
- Create: `hyperframes-local-business-finder-video/renders/local-business-finder.mp4`

- [ ] **Step 1: Lint**

Run:

```bash
cd hyperframes-local-business-finder-video && PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH npx hyperframes lint
```

Expected: no lint errors.

- [ ] **Step 2: Inspect**

Run:

```bash
cd hyperframes-local-business-finder-video && PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH npx hyperframes inspect --samples 15
```

Expected: no layout errors.

- [ ] **Step 3: Render MP4**

Run:

```bash
cd hyperframes-local-business-finder-video && PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH npx hyperframes render --quality standard --output renders/local-business-finder.mp4
```

Expected: `renders/local-business-finder.mp4` exists.

- [ ] **Step 4: Commit render**

```bash
git add hyperframes-local-business-finder-video/renders/local-business-finder.mp4
PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH git commit -m "feat: render local business finder training video"
```

## Self-Review

- Spec coverage: every scene, voiceover, result reveal, and verification requirement from the spec has a corresponding task.
- Placeholder scan: this plan contains no unfinished requirements or references to undefined files.
- Type consistency: all paths use the same project directory name, `hyperframes-local-business-finder-video`.
