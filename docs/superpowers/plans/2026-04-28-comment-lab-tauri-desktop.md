# Comment Lab Tauri Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Tauri desktop wrapper for Comment Lab that keeps the existing local Nuxt + Python services, so the app can run as a desktop program without exposing a remote server.

**Architecture:** Keep the current Nuxt API surface and Python sidecar intact for the first desktop slice. Add a Tauri shell that launches or points at the local app, then gradually move any desktop-only glue into Tauri commands if needed. This keeps the first release low-risk while preserving a path to deeper native integration later.

**Tech Stack:** Tauri v2, Rust, existing Nuxt 3 app, existing Python sidecar, existing npm/uv toolchain.

---

### Task 1: Add the Tauri scaffold and desktop launch path

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/tauri.conf.json`
- Modify: `package.json`

- [ ] **Step 1: Write the failing verification**

Expect the repo to have a Tauri entrypoint and a desktop script after scaffolding.

- [ ] **Step 2: Add the minimal Tauri project files**

Create the Rust app shell, configure it to load the local Comment Lab URL in development, and keep the current local server model rather than rewriting the app architecture.

- [ ] **Step 3: Add npm scripts for desktop development**

Expose commands for launching the existing local app under Tauri so the user can open Comment Lab as a desktop window.

- [ ] **Step 4: Run the targeted verification**

Run: `npm run typecheck`

Expected: PASS for the existing Nuxt app after the scaffold is added.

- [ ] **Step 5: Commit the slice**

```bash
git add package.json src-tauri docs/superpowers/plans/2026-04-28-comment-lab-tauri-desktop.md
git commit -m "feat: start Tauri desktop wrapper"
```

### Task 2: Document the desktop startup flow

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Describe the desktop launch mode**

Add a short section showing how to start Comment Lab inside Tauri and what remains local.

- [ ] **Step 2: Verify the doc update is consistent with the scripts**

Run: `git diff --check`

Expected: PASS with no whitespace or patch-format issues.

- [ ] **Step 3: Commit the documentation update**

```bash
git add README.md
git commit -m "docs: add desktop launch notes"
```

### Task 3: Validate the current local-server behavior still works

**Files:**
- Modify: none
- Test: `tests/*` as needed

- [ ] **Step 1: Run the existing unit and app checks**

Run: `npm test`

Expected: PASS for the current test suite.

- [ ] **Step 2: Run a lightweight build sanity check**

Run: `npm run build`

Expected: PASS or a clear follow-up if the build reveals a pre-existing issue.

- [ ] **Step 3: Record any packaging gaps**

If the first desktop slice still depends on local Node/Python processes, note that explicitly so the next slice can decide whether to bundle them as sidecars or keep the local launcher model.
