# Uploads up to 1000MB with server-side compression for oversize files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow video uploads up to 1000MB, and when an uploaded video is larger than 100MB, compress it on the server before generation continues.

**Architecture:** Keep the existing multipart upload flow, but raise the upload acceptance ceiling to 1000MB and treat 100MB as the compression threshold. After the upload is written to a temp file, run it through the existing ffmpeg compression service when it exceeds 100MB, then pass the resulting temp file to the current generation path with cleanup for both original and compressed artifacts.

**Tech Stack:** Nuxt/Nitro server routes, Node `fs`, system `ffmpeg`, Vitest, existing Comment Lab upload/compression helpers.

---

### Task 1: Raise the upload ceiling and front-end limit copy

**Files:**
- Modify: `nuxt.config.ts`
- Modify: `tests/setup.ts`
- Modify: `pages/index.vue`
- Modify: `components/SourceInput.vue`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `tests/unit/validators.test.ts`

- [ ] **Step 1: Write the failing tests / assertions**

Update the unit and API-side expectations so upload validation now accepts up to 1000MB and the UI hint reflects 1000MB instead of 100MB.

- [ ] **Step 2: Run the targeted checks to confirm the old limit still fails**

Run: `npm test -- tests/unit/validators.test.ts tests/unit/file.test.ts`
Expected: the existing limit assertions fail until the config and UI copy are updated.

- [ ] **Step 3: Update the default limits**

Set the upload ceiling default to 1000MB in runtime config and test setup, and update the upload hint/copy on the front end and in docs.

- [ ] **Step 4: Re-run the targeted checks**

Run: `npm test -- tests/unit/validators.test.ts tests/unit/file.test.ts`
Expected: PASS.

---

### Task 2: Compress uploaded videos above 100MB before generation

**Files:**
- Modify: `server/api/generate.post.ts`
- Modify: `tests/api/generate.api.test.ts`
- Modify: `tests/unit/video-compress.test.ts`
- Modify: `tests/unit/file.test.ts`

- [ ] **Step 1: Write the failing upload-compression regression tests**

Cover these cases:
- upload files at or below 100MB still flow through unchanged
- upload files above 100MB are saved, compressed on the server, and then passed to the model with the compressed temp file path
- upload files above 1000MB are still rejected
- cleanup removes both the original upload temp file and the compressed temp file when compression is used

- [ ] **Step 2: Run the focused API test to prove the upload path does not compress yet**

Run: `npm test -- tests/api/generate.api.test.ts -t "upload 模式会"`
Expected: FAIL until the upload branch is wired through compression.

- [ ] **Step 3: Implement the upload-side compression handoff**

After `saveVideoUploadToTempFile(...)`, run the uploaded temp file through the existing compression service when it exceeds 100MB, then continue generation with the compressed path and combined cleanup.

- [ ] **Step 4: Re-run the focused API tests**

Run: `npm test -- tests/api/generate.api.test.ts -t "upload 模式会|文件过大时返回 FILE_TOO_LARGE"`
Expected: PASS.

---

### Task 3: Verify the full affected surface

**Files:**
- Review only: `server/api/generate.post.ts`, `server/services/file.ts`, `server/services/video-compress.ts`, `components/SourceInput.vue`, `pages/index.vue`, `tests/api/generate.api.test.ts`, `tests/unit/validators.test.ts`

- [ ] **Step 1: Run the targeted test set**

Run: `npm test -- tests/unit/validators.test.ts tests/unit/file.test.ts tests/unit/video-compress.test.ts tests/api/generate.api.test.ts`
Expected: PASS.

- [ ] **Step 2: Run type checking**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Do a final sanity review**

Check that:
- upload accepts up to 1000MB
- upload files above 100MB are compressed before generation
- download behavior is unchanged
- cleanup still removes all temp artifacts

