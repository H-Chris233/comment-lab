# Download-then-Compress Oversize Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download linked videos, compress them locally only when the downloaded file is larger than 100MB, and then continue the existing comment generation flow with the compressed file.

**Architecture:** Keep the change server-side and narrow. Add a dedicated video compression service that shells out to the system `ffmpeg` binary, returns a new temp file plus cleanup, and leaves small files untouched. In the generate route, allow the link-download path to fetch oversized source files up to a separate safe ceiling, then pass the downloaded temp file through the compression service before the model sees it.

**Tech Stack:** Nuxt/Nitro server routes, Node `node:child_process` / `node:fs`, system `ffmpeg` / `ffprobe`, Vitest.

---

### Task 1: Add a focused video compression service

**Files:**
- Create: `server/services/video-compress.ts`
- Create: `tests/unit/video-compress.test.ts`

- [ ] **Step 1: Write the failing test**

Cover the service contract before implementation:
- files at or below 100MB return the original path unchanged
- files above 100MB trigger compression and return a new temp MP4 path
- the compression helper cleans up temp output on failure
- the helper throws a stable app error when `ffmpeg` is missing or exits non-zero

Run: `pnpm vitest run tests/unit/video-compress.test.ts`
Expected: FAIL because the service does not exist yet.

- [ ] **Step 2: Write minimal implementation**

Implement a small service that:
- reads the actual file size with `fs.stat`
- compares against a max-bytes threshold
- when over threshold, runs `ffmpeg` with a conservative preset that favors smaller size over quality
- writes output to a new temp file in the same temp-video area
- returns `{ sourcePath, cleanup, bytes, compressed }`

Suggested first-pass ffmpeg shape:
- downscale to 720p-class output
- use H.264 + AAC
- use a relatively high CRF so the result is smaller, not pristine
- if the first pass still exceeds the threshold, optionally retry once with a stronger preset before failing

- [ ] **Step 3: Run the unit test again**

Run: `pnpm vitest run tests/unit/video-compress.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/services/video-compress.ts tests/unit/video-compress.test.ts
git commit -m "Add oversize video compression service"
```

---

### Task 2: Wire the link-download path through compression

**Files:**
- Modify: `server/api/generate.post.ts`
- Modify: `tests/api/generate.api.test.ts`

- [ ] **Step 1: Write the failing API tests**

Add two regression cases:
- a link-mode file download under 100MB should not call the compression service
- a link-mode file download over 100MB should download successfully, then call the compression service, and the model should receive the compressed path

Use mocks rather than a real long video in API tests. Keep the tests focused on orchestration, not ffmpeg internals.

Run: `pnpm vitest run tests/api/generate.api.test.ts -t "压缩"`
Expected: FAIL until the route calls the new compression service.

- [ ] **Step 2: Update the generate route**

Implement the orchestration in `server/api/generate.post.ts`:
- keep the current Douyin link resolution flow
- allow the link-download path to fetch oversize source files up to a separate safe ceiling larger than 100MB, so the later compression step has a source file to work with
- after download, check the downloaded file size
- if it exceeds 100MB, call the compression service and replace the temp file path with the compressed one
- preserve cleanup for both the original and compressed temp files

Important boundary:
- do **not** leave the 100MB limit enforced at the download step for this path, or the compression step will never receive the oversized source file

- [ ] **Step 3: Run the API tests again**

Run: `pnpm vitest run tests/api/generate.api.test.ts -t "压缩"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/api/generate.post.ts tests/api/generate.api.test.ts
git commit -m "Compress oversized linked videos before generation"
```

---

### Task 3: Verify the full affected surface

**Files:**
- Review only: `server/services/video-compress.ts`, `server/api/generate.post.ts`, `tests/unit/video-compress.test.ts`, `tests/api/generate.api.test.ts`

- [ ] **Step 1: Run the targeted test set**

Run: `pnpm vitest run tests/unit/video-compress.test.ts tests/api/generate.api.test.ts`
Expected: PASS.

- [ ] **Step 2: Run type checking**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Do a final sanity review**

Check that:
- small files still take the original path
- oversize files are compressed before generation
- cleanup still removes all temp artifacts
- no upload-mode behavior changed

- [ ] **Step 4: Commit final verification-only adjustments if any**

If any tiny follow-up fixes are needed, make them in one small commit with a focused message. Otherwise, stop after the green verification.
