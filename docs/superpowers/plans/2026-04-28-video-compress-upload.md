# Download-then-Compress Oversize Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download linked videos, compress them locally only when the downloaded file is larger than 100MB, and then continue the existing comment generation flow with the compressed file.

**Architecture:** Keep the change server-side and narrow. Add a dedicated video compression service that shells out to the system `ffmpeg` binary through a small process-runner boundary, returns a new temp file plus cleanup, and leaves small files untouched. In the generate route, allow the link-download path to fetch oversized source files up to a separate safe ceiling, then pass the downloaded temp file through the compression service before the model sees it. The oversize download path must not buffer the whole file in memory before compression.

**Tech Stack:** Nuxt/Nitro server routes, Node `node:child_process` / `node:fs`, system `ffmpeg` / `ffprobe`, Vitest.

---

### Task 1: Add a focused video compression service

**Files:**
- Create: `server/services/video-compress.ts`
- Create: `server/services/process-runner.ts`
- Create: `tests/unit/video-compress.test.ts`
- Create: `tests/unit/process-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Cover the service contract before implementation:
- files at or below 100MB return the original path unchanged
- files above 100MB trigger compression and return a new temp MP4 path
- the compression helper cleans up temp output on failure
- the helper throws a stable app error when `ffmpeg` is missing or exits non-zero
- the helper can be aborted and must clean up partial outputs when aborted
- the process runner waits for `close` before settling and preserves captured stdout/stderr
- the process runner abort and timeout behavior is covered directly

Run: `pnpm vitest run tests/unit/video-compress.test.ts`
Expected: FAIL because the service does not exist yet.

- [ ] **Step 2: Write minimal implementation**

Implement a small service that:
- reads the actual file size with `fs.stat`
- compares against a max-bytes threshold
- when over threshold, runs `ffmpeg` with a conservative preset that favors smaller size over quality
- writes output to a new temp file in the same temp-video area
- returns `{ sourcePath, cleanup, bytes, compressed }`
- accepts an `AbortSignal` and timeout budget so long transcodes stop cleanly when the request is canceled
- uses a tiny process-runner wrapper so tests can simulate missing binaries and non-zero exits without invoking the real ffmpeg binary

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
- Modify: `server/services/file.ts`
- Modify: `tests/unit/file.test.ts`
- Modify: `tests/api/generate.api.test.ts`

- [ ] **Step 1: Write the failing API tests**

Add two regression cases:
- a link-mode file download under 100MB should not call the compression service
- a link-mode file download over 100MB should download successfully, then call the compression service, and the model should receive the compressed path
- upload mode should continue to bypass compression entirely
- successful compression should clean up both the source download temp file and the compressed temp file after generation
- a request abort during compression should stop the transcode and clean up partial files

Use mocks rather than a real long video in API tests. Keep the tests focused on orchestration, not ffmpeg internals.

Run: `pnpm vitest run tests/api/generate.api.test.ts -t "压缩"`
Expected: FAIL until the route calls the new compression service.

Also add a dedicated failing file-service test that proves the compressible download path streams to disk and enforces the larger raw-download ceiling without buffering the entire file in memory.

- [ ] **Step 2: Update the generate route**

Implement the orchestration in `server/api/generate.post.ts`:
- keep the current Douyin link resolution flow
- allow the link-download path to fetch oversize source files up to a separate safe ceiling larger than 100MB, so the later compression step has a source file to work with
- make the oversize download path stream to disk instead of buffering the full file in memory
- after download, check the downloaded file size
- if it exceeds 100MB, call the compression service and replace the temp file path with the compressed one
- preserve cleanup for both the original and compressed temp files
- keep the existing low-quality retry behavior only for non-size transport failures; the compression path should own size-based handling
- thread the current request `AbortSignal` and a timeout budget into the compression helper so client disconnects stop ffmpeg quickly

In `server/services/file.ts`:
- add a separate raw-download ceiling for the compressible link path (default 400MB, configurable via `MAX_DOWNLOAD_VIDEO_SIZE_MB`)
- keep the current smaller cap for the non-compressing path
- expose enough metadata so the generate route can decide whether to compress without re-fetching the file

Important boundary:
- do **not** leave the 100MB limit enforced at the download step for this path, or the compression step will never receive the oversized source file
- do **not** let the oversize download path buffer the entire file before compression; the raw download ceiling must be enforced while streaming to disk
- do **not** skip abort propagation into the compression helper

- [ ] **Step 3: Run the API tests again**

Run: `pnpm vitest run tests/api/generate.api.test.ts -t "压缩"`
Expected: PASS.

- [ ] **Step 4: Run the file-service test**

Run: `pnpm vitest run tests/unit/file.test.ts tests/api/generate.api.test.ts -t "压缩"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/api/generate.post.ts server/services/file.ts tests/unit/file.test.ts tests/api/generate.api.test.ts
git commit -m "Compress oversized linked videos before generation"
```

---

### Task 3: Verify the full affected surface

**Files:**
- Review only: `server/services/video-compress.ts`, `server/api/generate.post.ts`, `server/services/file.ts`, `tests/unit/video-compress.test.ts`, `tests/unit/file.test.ts`, `tests/api/generate.api.test.ts`

- [ ] **Step 1: Run the targeted test set**

Run: `pnpm vitest run tests/unit/process-runner.test.ts tests/unit/video-compress.test.ts tests/unit/file.test.ts tests/api/generate.api.test.ts`
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
