# Community Stage 4 Multi-Timeframe UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the v1.0.0 single/multi-timeframe mode cards, keep Direct analysis single-frame, and guide Direct users to the truthful unavailable Cloud settings.

**Architecture:** A focused `CaptureModeSelector` renders capability-driven cards without knowing providers or capture internals. `ChartCaptureSource` owns the pending capture-mode selection and site eligibility. `App` activates either an injected Cloud runtime or the existing Direct runtime and passes only runtime capabilities into the capture UI.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, WXT MV3.

**Spec:** `docs/superpowers/specs/2026-08-27-community-extension-cloud-direct-modes.md`

## Global Constraints

- Stage 4 implements UI and guidance only; timeframe switching and multi-image capture remain Stage 5.
- Direct runtime remains exactly one screenshot and one timeframe.
- Multi-timeframe eligibility comes from `AnalysisRuntime.capabilities()` plus the supported-site registry.
- Default roles are Context `4h`, Setup `1h`, Trigger `15m`.
- The unavailable production Cloud gateway accepts no token and no screenshot.
- All visible copy is available in English and Simplified Chinese.

---

### Task 1: Capability-driven capture mode selector

**Files:**
- Create: `extension/src/ui/components/CaptureModeSelector.tsx`
- Create: `extension/tests/capture-mode-selector.test.tsx`
- Modify exact keys: `extension/src/i18n/en.ts`
- Modify exact keys: `extension/src/i18n/zh-CN.ts`
- Modify exact selectors: `extension/entrypoints/panel/style.css`

**Interfaces:**
- Consumes: `AnalysisCapabilities`, `Language`, selected mode, and site eligibility.
- Produces: `CaptureMode = 'single' | 'multi'` and `CaptureModeSelector` callbacks for single selection, multi selection, and Cloud settings guidance.

- [ ] **Step 1: Write failing selector behavior tests**

Cover four public behaviors: single selected by default; Direct multi click retains single and reveals the localized Cloud message/action; capable Cloud selects multi and displays `Context 4h`, `Setup 1h`, `Trigger 15m`; unsupported sites cannot select multi even with a capable runtime.

- [ ] **Step 2: Run the selector test and verify RED**

Run: `cd extension && pnpm exec vitest run tests/capture-mode-selector.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the selector with v1.0.0 card semantics**

Use a two-button `role="group"`, `aria-pressed`, and an inline `role="status"` for Cloud guidance. A Direct multi button remains operable for discovery but never invokes `onModeChange('multi')`. A Cloud-capable but site-ineligible multi button uses `aria-disabled="true"` and does not change mode.

- [ ] **Step 4: Add only the required localized copy and styles**

Add exact concepts for screenshot mode, single timeframe/current chart, multi timeframe, Context/Setup/Trigger role labels, site unavailable, and opening Cloud settings. Port the compact v1.0.0 card proportions into the current panel palette.

- [ ] **Step 5: Run selector tests, compile, and commit**

Run: `cd extension && pnpm exec vitest run tests/capture-mode-selector.test.tsx && pnpm compile && git diff --check`

Commit: `feat(community): add capability-driven timeframe cards`

---

### Task 2: Integrate mode selection with detected chart state

**Files:**
- Modify: `extension/src/ui/components/ChartCaptureSource.tsx`
- Modify: `extension/tests/chart-capture-source.test.tsx`

**Interfaces:**
- Consumes: `AnalysisCapabilities` and `onOpenCloudSettings()` from App.
- Produces: single capture unchanged; multi UI selection only when runtime and current site both allow it.

- [ ] **Step 1: Add failing ChartCaptureSource tests**

Assert that mode cards appear only after a supported chart is detected, Direct multi does not call `capture`, Cloud-capable supported charts select multi, and 10jqka remains site-ineligible.

- [ ] **Step 2: Run the source tests and verify RED**

Run: `cd extension && pnpm exec vitest run tests/chart-capture-source.test.tsx`

Expected: FAIL because the source does not accept capabilities or render the selector.

- [ ] **Step 3: Implement source integration**

Resolve site eligibility from `findSupportedSiteByChartUrl(context.url)?.multiTimeframe === true`. Reset mode to `single` whenever chart detection refreshes. Keep the existing single `capture(signal)` call unchanged. While `multi` is selected in a fake capable Cloud test, disable the single capture action until Stage 5 supplies the multi-capture callback.

- [ ] **Step 4: Run source and existing site-guidance tests**

Run: `cd extension && pnpm exec vitest run tests/chart-capture-source.test.tsx tests/supported-sites.test.ts`

- [ ] **Step 5: Commit**

Commit: `feat(community): connect timeframe cards to chart context`

---

### Task 3: Activate injected Cloud runtime capabilities in App

**Files:**
- Modify: `extension/entrypoints/panel/App.tsx`
- Modify exact hunks: `extension/tests/panel-workflow.test.tsx`

**Interfaces:**
- Consumes: `resolveCloudRuntime(cloudGateway)` and `AnalysisRuntime.capabilities()`.
- Produces: active runtime capabilities passed to `ChartCaptureSource`; Cloud guidance opens settings with the Cloud tab selected.

- [ ] **Step 1: Add failing App workflow tests**

Assert that Direct bootstrap renders both cards and opens Cloud settings without capture; an available injected Cloud runtime configures the controller and enables the multi card; unavailable Cloud still performs no chart inspection and creates no Direct runtime.

- [ ] **Step 2: Run panel tests and verify RED**

Run: `cd extension && pnpm exec vitest run tests/panel-workflow.test.tsx`

- [ ] **Step 3: Wire active runtime and capabilities**

Create one `activateRuntime(runtime)` helper that stores `runtime.capabilities()` and calls `controller.configure(runtime)`. Bootstrap Direct from config and Cloud from `resolveCloudRuntime`. Pass capabilities and `openCloudSettings` to the capture source. Settings inspection must not activate Cloud while the production gateway is unavailable.

- [ ] **Step 4: Run the Stage 4 focused suite**

Run:

```bash
cd extension
pnpm exec vitest run \
  tests/capture-mode-selector.test.tsx \
  tests/chart-capture-source.test.tsx \
  tests/panel-workflow.test.tsx \
  tests/analysis-controller.test.tsx \
  tests/analysis-mode-settings.test.tsx
pnpm compile
git diff --check
```

- [ ] **Step 5: Commit**

Commit: `feat(community): expose runtime timeframe capabilities`

---

### Task 4: Stage 4 verification and review checkpoint

**Files:**
- No production changes.

**Interfaces:**
- Consumes the completed Stage 4 UI.
- Produces verification evidence only; Stage 5 remains untouched.

- [ ] **Step 1: Run full automated verification**

Run: `cd extension && pnpm test && pnpm compile && pnpm build && pnpm build:edge && git diff --check`

- [ ] **Step 2: Audit the boundary**

Run:

```bash
rg -n "switchTimeframe|captureMultiple|multiCapture" \
  extension/src/ui extension/entrypoints/panel/App.tsx
rg -n "token|apiKey|fetch|screenshot|capture" extension/src/cloud/cloud-gateway.ts
```

Expected: no Stage 5 switching/capture implementation and no Cloud secret or transport implementation.

- [ ] **Step 3: Report and stop**

Report card behavior, Direct guidance, fake Cloud capability proof, test/build evidence, commits, and preserved unrelated dirty files. Do not begin Stage 5.
