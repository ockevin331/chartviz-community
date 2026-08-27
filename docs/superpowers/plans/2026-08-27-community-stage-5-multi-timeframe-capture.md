# Community Stage 5 Multi-Timeframe Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture Context `4h`, Setup `1h`, and Trigger `15m` charts atomically, restore the original chart timeframe, and submit all three labeled images to a capable Cloud runtime.

**Architecture:** Port the proven v1.0.0 site timeframe adapter behind one content-message boundary instead of redesigning selectors. The background owns the switch/wait/hide/crop/restore transaction and returns ordered captures; the active-chart client converts every returned image, while the controller and panel pass the complete capture set to the already-injected Cloud runtime.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, WXT MV3.

**Spec:** `docs/superpowers/specs/2026-08-27-community-extension-cloud-direct-modes.md`

## Global Constraints

- Stage 5 implements multi-timeframe switching and capture only; Stage 6 release packaging remains untouched.
- Default ordered roles are Context `4h`, Setup `1h`, Trigger `15m`.
- Capture requests accept one to three distinct values from `5m`, `15m`, `1h`, `4h`, and `1d`.
- Direct runtime remains exactly one image; only runtime capabilities enable multi capture.
- A failed switch or capture returns no partial result and attempts to restore the original normalized timeframe in `finally`.
- The floating panel is hidden only while each visible screenshot is taken and is always restored.
- The production unavailable Cloud gateway receives no screenshot or credential.
- All new visible copy is localized in English and Simplified Chinese.

---

### Task 1: Port the proven site timeframe switch boundary

**Files:**
- Create: `extension/src/sites/set-timeframe.ts`
- Modify: `extension/src/domain/chart-messages.ts`
- Modify exact handler hunks: `extension/entrypoints/content.ts`
- Create: `extension/tests/set-timeframe.test.ts`
- Modify exact test hunks: `extension/tests/content-bridge.test.ts`

**Interfaces:**
- Produces `SupportedCaptureTimeframe = '5m' | '15m' | '1h' | '4h' | '1d'`.
- Produces `SetChartTimeframeMessage` and `setActiveChartTimeframe(timeframe): Promise<void>`.
- Content response returns the context collected after the requested switch.

- [ ] **Step 1: Write failing adapter and content-boundary tests**

Cover the exported pure v1.0.0 matching helpers and verify that the exact `chartviz/chart/timeframe` message calls the switch dependency, then recollects context. Verify switch failures become bounded readable responses.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd extension && pnpm exec vitest run tests/set-timeframe.test.ts tests/content-bridge.test.ts`

Expected: FAIL because the timeframe message and adapter do not exist.

- [ ] **Step 3: Port the v1.0.0 adapter and wire the content handler**

Copy the proven selector, menu, iframe, and readiness logic without adding new site heuristics. Inject `setTimeframe()` into `createContentMessageHandler` so handler behavior remains testable.

- [ ] **Step 4: Run focused tests and compile**

Run: `cd extension && pnpm exec vitest run tests/set-timeframe.test.ts tests/content-bridge.test.ts && pnpm compile && git diff --check`

- [ ] **Step 5: Commit**

Commit: `feat(community): restore site timeframe switching`

---

### Task 2: Add atomic ordered multi-chart capture

**Files:**
- Modify: `extension/src/domain/chart-messages.ts`
- Modify: `extension/entrypoints/background.ts`
- Modify: `extension/tests/active-chart-capture.test.ts`

**Interfaces:**
- `CaptureActiveChartMessage` accepts optional `timeframes: SupportedCaptureTimeframe[]`.
- Successful `CaptureResponse` contains ordered `captures` entries with `timeframe`, `context`, and `previewDataUrl`.
- Background validates one to three distinct timeframes before changing the page.

- [ ] **Step 1: Write failing background transaction tests**

Cover ordered `4h`/`1h`/`15m` switching and capture, original-timeframe restoration, rejection of duplicates or more than three inputs before switching, and failure cleanup with no partial response.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd extension && pnpm exec vitest run tests/active-chart-capture.test.ts`

Expected: FAIL because capture messages cannot carry timeframes and the background performs one capture only.

- [ ] **Step 3: Implement the background transaction**

For each target: send the switch message, wait for exact ready context, hide panel, capture and crop, restore panel, then append the labeled result. Restore the original normalized timeframe in `finally`; return an error rather than partial captures when any target fails.

- [ ] **Step 4: Run tests and compile**

Run: `cd extension && pnpm exec vitest run tests/active-chart-capture.test.ts tests/content-bridge.test.ts && pnpm compile && git diff --check`

- [ ] **Step 5: Commit**

Commit: `feat(community): capture ordered timeframe charts`

---

### Task 3: Convert and submit the complete capture set

**Files:**
- Modify: `extension/src/capture/active-chart.ts`
- Modify: `extension/src/ui/state/use-analysis-controller.ts`
- Modify: `extension/tests/active-chart-capture.test.ts`
- Modify: `extension/tests/analysis-controller.test.tsx`

**Interfaces:**
- `ActiveChartClient.captureMany(timeframes, signal): Promise<readonly CapturedChart[]>` converts every returned data URL.
- `useAnalysisController.selectCaptures(captures)` stores one to three runtime-ready captures.
- `analyze(outputLanguage)` submits the stored capture set unchanged and uses the first image as the visible report original.

- [ ] **Step 1: Write failing client and controller tests**

Verify ordered conversion of three images, rejection of malformed/partial response entries, three-capture runtime submission, first-image display compatibility, retry reuse, and cancellation before image processing.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd extension && pnpm exec vitest run tests/active-chart-capture.test.ts tests/analysis-controller.test.tsx`

- [ ] **Step 3: Implement capture-set conversion and controller state**

Keep `capture()` as the existing one-image API. Add `captureMany()` and one internal response converter. Store complete `AnalysisCapture[]` in a ref and state; clear it on configure, refresh, or choosing another chart.

- [ ] **Step 4: Run focused tests and compile**

Run: `cd extension && pnpm exec vitest run tests/active-chart-capture.test.ts tests/analysis-controller.test.tsx tests/analysis-runtime.test.ts && pnpm compile && git diff --check`

- [ ] **Step 5: Commit**

Commit: `feat(community): submit multi-chart runtime input`

---

### Task 4: Complete the multi-timeframe panel flow

**Files:**
- Modify: `extension/src/ui/components/ChartCaptureSource.tsx`
- Modify: `extension/entrypoints/panel/App.tsx`
- Modify exact keys: `extension/src/i18n/en.ts`
- Modify exact keys: `extension/src/i18n/zh-CN.ts`
- Modify exact selectors: `extension/entrypoints/panel/style.css`
- Modify: `extension/tests/chart-capture-source.test.tsx`
- Modify exact hunks: `extension/tests/panel-workflow.test.tsx`

**Interfaces:**
- `ChartCaptureSource` receives `captureMany(timeframes, signal)` and emits `onCaptured(captures)` for both modes.
- Multi mode uses exact defaults `['4h', '1h', '15m']` and shows a flicker warning.
- `App` forwards all captures to the controller; injected Cloud runtime receives three images in role order.

- [ ] **Step 1: Write failing source and App workflow tests**

Verify multi selection enables the action, renders the localized flicker warning, calls `captureMany(['4h','1h','15m'])`, never calls single capture, and submits three images to the capable injected Cloud runtime. Direct behavior and 10jqka ineligibility remain unchanged.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd extension && pnpm exec vitest run tests/chart-capture-source.test.tsx tests/panel-workflow.test.tsx`

- [ ] **Step 3: Implement the panel flow**

Use one capture-set callback for single and multi modes. Keep automatic analysis after successful capture. Disable refresh and mode changes while capturing, surface the first readable failure, and do not expose partial captures.

- [ ] **Step 4: Run the Stage 5 focused suite**

Run: `cd extension && pnpm exec vitest run tests/set-timeframe.test.ts tests/content-bridge.test.ts tests/active-chart-capture.test.ts tests/analysis-controller.test.tsx tests/chart-capture-source.test.tsx tests/panel-workflow.test.tsx tests/cloud-gateway.test.ts && pnpm compile && git diff --check`

- [ ] **Step 5: Commit**

Commit: `feat(community): complete multi-timeframe capture flow`

---

### Task 5: Stage 5 verification and review checkpoint

**Files:**
- No production changes.

**Interfaces:**
- Produces verification evidence only; Stage 6 remains untouched.

- [ ] **Step 1: Run full automated verification**

Run: `cd extension && pnpm test && pnpm compile && pnpm build && pnpm build:edge && git diff --check`

- [ ] **Step 2: Audit safety and scope boundaries**

Verify malformed timeframe arrays cause no page message, every panel-hide path restores visibility, every attempted multi sequence has a restore attempt when the original timeframe is known, Direct runtime still rejects more than one capture, and unavailable Cloud performs no capture.

- [ ] **Step 3: Report and stop**

Report switching coverage, atomic capture behavior, three-image runtime proof, test/build evidence, commits, and preserved unrelated dirty files. Do not begin Stage 6.
