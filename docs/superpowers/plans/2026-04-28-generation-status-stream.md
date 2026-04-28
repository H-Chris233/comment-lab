# Generation Status Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "正在生成中..." loading label with request-scoped, real-time key status updates for download, retry, compression, and model-call phases.

**Architecture:** Keep the existing per-request SSE stream and add a structured `status` event that carries a `requestId`, phase, and human-readable message. The server will emit this event at key workflow boundaries; the client will cache only the latest status for the active request and render that text in the results panel. No shared global status store; each stream remains isolated by request.

**Tech Stack:** Nuxt 3, Vue 3 composables, H3 SSE responses, Vitest.

---

### Task 1: Define request-scoped status payloads and SSE emission helpers

**Files:**
- Modify: `types/api.ts`
- Modify: `server/api/generate.post.ts`
- Modify: `server/services/file.ts`
- Modify: `server/services/video-compress.ts`

- [ ] **Step 1: Write the failing test**

  Add a server test that consumes `?stream=1` and asserts the response contains `event: status` entries with `requestId` and phase/message fields for at least download, compress, and model-call transitions.

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- tests/api/generate.api.test.ts -t "status 事件|实时状态"`  
  Expected: FAIL because `status` events are not yet emitted.

- [ ] **Step 3: Write minimal implementation**

  Add a `GenerateStatusPhase` / `GenerateStatusPayload` shape, a local `emitStatus(...)` helper in `server/api/generate.post.ts`, and progress callbacks from file download/compression code so the API can send structured status updates.

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- tests/api/generate.api.test.ts -t "status 事件|实时状态"`  
  Expected: PASS with `status` events present and request-isolated.

- [ ] **Step 5: Commit**

  ```bash
  git add types/api.ts server/api/generate.post.ts server/services/file.ts server/services/video-compress.ts tests/api/generate.api.test.ts
  git commit -m "feat: stream request-scoped generation status"
  ```

### Task 2: Surface active generation status in the client composable

**Files:**
- Modify: `composables/useGenerate.ts`
- Modify: `types/api.ts`
- Test: `tests/unit/useGenerate.test.ts`

- [ ] **Step 1: Write the failing test**

  Add a composable test that feeds `status` SSE events and asserts the active status text updates through download, retry, compress, and model-call phases without relying on a global store.

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- tests/unit/useGenerate.test.ts -t "status 事件|loading 文案"`  
  Expected: FAIL because the composable ignores `status`.

- [ ] **Step 3: Write minimal implementation**

  Parse the new `status` SSE event, keep the latest phase/message in local refs, and expose them to the page so the loading label can read a request-scoped status string.

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- tests/unit/useGenerate.test.ts -t "status 事件|loading 文案"`  
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add composables/useGenerate.ts types/api.ts tests/unit/useGenerate.test.ts
  git commit -m "feat: track generation status in the client"
  ```

### Task 3: Render the status text in the results UI

**Files:**
- Modify: `pages/index.vue`
- Modify: `components/ResultsPanel.vue`
- Test: `tests/unit/results-panel.test.ts` or existing UI tests if present

- [ ] **Step 1: Write the failing test**

  Add or extend a UI test to assert the loading text switches from the default placeholder to the latest status message, and that concurrent requests do not share text.

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- tests/unit/results-panel.test.ts -t "loading status"`  
  Expected: FAIL until the component accepts a status prop.

- [ ] **Step 3: Write minimal implementation**

  Pass the current status message from `useGenerate` into `ResultsPanel` and render it in place of the generic loading label, with a fallback to the old text when no status has arrived yet.

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- tests/unit/results-panel.test.ts -t "loading status"`  
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add pages/index.vue components/ResultsPanel.vue tests/unit/results-panel.test.ts
  git commit -m "feat: show live generation status in the UI"
  ```

### Task 4: Verify concurrency safety and end-to-end behavior

**Files:**
- Modify: `tests/api/generate.api.test.ts`
- Modify: `tests/unit/useGenerate.test.ts`

- [ ] **Step 1: Write the failing test**

  Add coverage for overlapping requests or multiple stream sessions to confirm each request keeps its own status and an aborted request cannot overwrite the current one.

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- tests/api/generate.api.test.ts tests/unit/useGenerate.test.ts -t "并发|requestId|状态隔离"`  
  Expected: FAIL until request-scoped filtering is covered.

- [ ] **Step 3: Write minimal implementation**

  Ensure the client only mutates the active request state, and the server continues to emit `requestId` with every status event.

- [ ] **Step 4: Run test to verify it passes**

  Run: `npm test -- tests/api/generate.api.test.ts tests/unit/useGenerate.test.ts -t "并发|requestId|状态隔离"`  
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add tests/api/generate.api.test.ts tests/unit/useGenerate.test.ts
  git commit -m "test: cover request-scoped generation status"
  ```

### Final Verification

**Files:**
- All files touched above

- [ ] Run the full project verification:

  ```bash
  npm run typecheck
  npm test
  ```

- [ ] Confirm the loading UI now shows request-scoped key statuses instead of only "正在生成中..."
- [ ] Commit any final cleanup and push to `origin/main`
