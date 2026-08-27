# Community Extension Stage 3 Runtime Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the existing Direct three-stage analysis behind a mode-neutral runtime contract and prove the same contract can represent a capable fake Cloud runtime without adding a real Cloud transport.

**Architecture:** `AnalysisRuntime` owns analysis execution, cancellation, capabilities, and safe failures. `DirectAnalysisRuntime` contains provider resolution, the existing three-stage pipeline, annotation rendering, and provider-aware diagnostics; the React controller becomes a runtime-agnostic UI state machine. `CloudAnalysisGateway` can expose an injected runtime only when available, while the production gateway remains unavailable and accepts no credentials, screenshots, or network arguments.

**Tech Stack:** TypeScript 7, React 19, WXT 0.21, Vitest 4, Testing Library, Manifest V3.

**Spec:** `docs/superpowers/specs/2026-08-27-community-extension-cloud-direct-modes.md`

## Global Constraints

- Implement only delivery stage 3: the common runtime contract, Direct runtime wrapper, fake-Cloud contract tests, and panel/controller integration.
- Do not add Cloud authentication, tokens, endpoints, task polling, quota, billing, history, or website changes.
- Do not add the single/multi-timeframe cards or timeframe switching; those belong to stages 4 and 5.
- Direct remains single-image and single-timeframe and must reject multiple captures before provider resolution or a paid provider request.
- Direct keeps the existing three-stage prompt pipeline, visible report, annotation result, public progress messages, diagnostics, retry behavior, and provider request count.
- Production Cloud remains unavailable and accepts no credential, image, capture, analyze, connect, or fetch argument.
- Runtime cancellation must preserve the existing stale-result generation guard.
- English and Simplified Chinese public errors remain safe and contain no prompts, payloads, keys, screenshots, model output, or selectors.
- Preserve unrelated dirty changes and commit only exact stage hunks.

---

### Task 1: Common analysis-runtime and Cloud gateway contracts

**Files:**
- Create: `extension/src/analysis/runtime/analysis-runtime.ts`
- Modify: `extension/src/cloud/cloud-gateway.ts`
- Create: `extension/tests/analysis-runtime-contract.test.ts`

**Interfaces:**
- Produces `AnalysisCapabilities`, `AnalysisCapture`, `AnalysisRuntimeInput`, `AnalysisRuntimeOutcome`, `AnalysisRuntimeFailure`, and `AnalysisRuntime`.
- Extends `CloudAnalysisGateway` with a zero-argument `runtime()` lookup.
- Produces `resolveCloudRuntime(gateway)` for capability-driven callers and tests.

```ts
export type AnalysisCapabilities = Readonly<{
  multiTimeframe: boolean;
  maxTimeframes: 1 | 2 | 3;
}>;

export type AnalysisCapture = Readonly<{
  image: ProcessedImage;
  context: Pick<StagePageContext, 'instrument' | 'timeframe'>;
}>;

export type AnalysisRuntimeInput = Readonly<{
  captures: readonly AnalysisCapture[];
  outputLanguage: OutputLanguage;
  onProgress?(message: ProgressMessage): void;
}>;

export type AnalysisRuntimeOutcome = Readonly<{
  report: CommunityReportV3;
  annotations: AnnotatedReportImages;
}>;

export type AnalysisRuntimeErrorCode = AnalysisErrorCode
  | 'multi_timeframe_requires_cloud';

export class AnalysisRuntimeFailure extends Error {
  readonly code: AnalysisRuntimeErrorCode | 'unknown';
  readonly diagnostic: AnalysisDiagnostic | null;
}

export interface AnalysisRuntime {
  readonly mode: AnalysisMode;
  capabilities(): AnalysisCapabilities;
  analyze(input: AnalysisRuntimeInput): Promise<AnalysisRuntimeOutcome>;
  cancel(): void;
}
```

- [ ] **Step 1: Write failing runtime contract tests**

Add tests that import the missing runtime module, construct a fake Cloud runtime advertising `{ multiTimeframe: true, maxTimeframes: 3 }`, submit three labeled captures, and assert one runtime call returns the supplied report and annotations. Add production gateway assertions:

```ts
expect(unavailableCloudGateway.availability()).toEqual({
  available: false,
  code: 'cloud_not_available',
});
expect(unavailableCloudGateway.runtime()).toBeNull();
expect(unavailableCloudGateway.runtime.length).toBe(0);
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `cd extension && pnpm exec vitest run tests/analysis-runtime-contract.test.ts`

Expected: FAIL because `analysis/runtime/analysis-runtime` and the gateway runtime contract do not exist.

- [ ] **Step 3: Implement the minimal common contract**

Keep all runtime fields immutable at the type boundary. `AnalysisRuntimeFailure` stores only a stable public code and an already-sanitized optional diagnostic. It must never accept or retain an API key, prompt, screenshot, raw provider response, or selector.

- [ ] **Step 4: Extend the Cloud gateway without adding transport**

Use this availability union and zero-argument runtime lookup:

```ts
export type CloudAvailability =
  | Readonly<{ available: false; code: 'cloud_not_available' }>
  | Readonly<{ available: true }>;

export interface CloudAnalysisGateway {
  availability(): CloudAvailability;
  runtime(): AnalysisRuntime | null;
}

export function resolveCloudRuntime(
  gateway: CloudAnalysisGateway,
): AnalysisRuntime | null {
  if (!gateway.availability().available) return null;
  const runtime = gateway.runtime();
  if (!runtime || runtime.mode !== 'cloud') {
    throw new TypeError('Available Cloud gateway must expose a Cloud runtime.');
  }
  return runtime;
}
```

The production object returns `null`. It must expose no token, configure, connect, upload, capture, analyze, fetch, or screenshot method.

- [ ] **Step 5: Verify contract tests and types**

Run:

```bash
cd extension
pnpm exec vitest run tests/analysis-runtime-contract.test.ts tests/analysis-mode-settings.test.tsx
pnpm compile
git diff --check
```

Expected: all selected tests and compilation pass.

- [ ] **Step 6: Commit Task 1 exact files**

```bash
git add extension/src/analysis/runtime/analysis-runtime.ts \
  extension/src/cloud/cloud-gateway.ts \
  extension/tests/analysis-runtime-contract.test.ts
git commit -m "feat(community): define analysis runtime contract"
```

---

### Task 2: Direct three-stage runtime wrapper

**Files:**
- Create: `extension/src/analysis/runtime/direct-analysis-runtime.ts`
- Create: `extension/tests/direct-analysis-runtime.test.ts`
- Modify exact keys: `extension/src/i18n/en.ts`
- Modify exact keys: `extension/src/i18n/zh-CN.ts`
- Modify exact type hunk: `extension/src/ui/components/AnalysisError.tsx`

**Interfaces:**
- Consumes `AnalysisRuntime` and the unchanged `runThreeStageAnalysis` pipeline.
- Produces `DirectAnalysisRuntime` and `DirectAnalysisRuntimeDependencies`.

```ts
export type DirectAnalysisRuntimeDependencies = Readonly<{
  getProvider(kind: ProviderKind): StructuredVisionProvider;
  runAnalysis(input: ThreeStageAnalysisInput): Promise<CommunityReportV3>;
  buildAnnotations(
    image: ProcessedImage,
    report: CommunityReportV3,
  ): Promise<AnnotatedReportImages>;
  createRequestId(): string;
  now(): number;
}>;

export class DirectAnalysisRuntime implements AnalysisRuntime {
  readonly mode = 'direct' as const;
  constructor(
    config: ProviderConfig,
    dependencies?: Partial<DirectAnalysisRuntimeDependencies>,
  );
  capabilities(): Readonly<{
    multiTimeframe: false;
    maxTimeframes: 1;
  }>;
  analyze(input: AnalysisRuntimeInput): Promise<AnalysisRuntimeOutcome>;
  cancel(): void;
}
```

- [ ] **Step 1: Write failing Direct runtime tests**

Cover these behaviors independently:

1. capabilities are exactly `{ multiTimeframe: false, maxTimeframes: 1 }`;
2. one capture resolves the provider once, invokes the existing pipeline once with the same config, image, page context, language, progress callback, and runtime-owned signal, then renders annotations once;
3. two captures reject with `AnalysisRuntimeFailure.code === 'multi_timeframe_requires_cloud'` before `getProvider`, `runAnalysis`, or `buildAnnotations` is called;
4. `cancel()` aborts the signal used by the active pipeline and yields `cancelled`;
5. a classified provider failure becomes a safe `AnalysisRuntimeFailure` preserving the diagnostic stage, provider, and model but not the API key, screenshot, prompt, or raw output;
6. annotation rendering failure becomes `invalid_image` with `annotation_rendering` diagnostic stage.

- [ ] **Step 2: Run the Direct runtime tests and verify RED**

Run: `cd extension && pnpm exec vitest run tests/direct-analysis-runtime.test.ts`

Expected: FAIL because `DirectAnalysisRuntime` does not exist.

- [ ] **Step 3: Implement exact single-capture validation and execution**

Validate `input.captures.length === 1` before resolving a provider. For one capture, forward the existing fields without changing their values:

```ts
const report = await dependencies.runAnalysis({
  config,
  provider,
  image: {
    mediaType: capture.image.mediaType,
    dataUrl: capture.image.dataUrl,
  },
  context: {
    ...capture.context,
    site: null,
    exchange: null,
  },
  outputLanguage: input.outputLanguage,
  signal: controller.signal,
  onProgress: input.onProgress,
});
```

- [ ] **Step 4: Move provider-aware diagnostics into Direct runtime**

Map `ProviderError('cancelled')` to a runtime failure with no diagnostic. Map other `ProviderError` values through `createAnalysisDiagnostic`. Map unknown errors to `{ code: 'unknown', diagnostic: null }`. Annotation errors use a new `ProviderError('invalid_image')` decorated with `annotation_rendering` before diagnostic creation.

- [ ] **Step 5: Add the safe multi-capture error translation**

Add only these exact keys and extend `AnalysisError` to accept `AnalysisRuntimeErrorCode`:

- English: `Multi-timeframe analysis is available through ChartViz Cloud.`
- Simplified Chinese: `多周期分析由 ChartViz Cloud 提供，直连模型暂不支持。`

- [ ] **Step 6: Verify Direct output and provider-call invariants**

Run:

```bash
cd extension
pnpm exec vitest run tests/direct-analysis-runtime.test.ts \
  tests/analysis-pipeline.test.ts \
  tests/three-stage-prompts.test.ts \
  tests/analysis-error.test.tsx
pnpm compile
git diff --check
```

Expected: the existing pipeline and prompt tests remain unchanged and pass; Direct runtime invokes `runAnalysis` exactly once for one analysis and zero times for multiple captures.

- [ ] **Step 7: Commit Task 2 exact hunks**

Stage the two new files and only the new translation/type hunks, then commit:

```bash
git commit -m "refactor(community): wrap direct analysis in runtime"
```

---

### Task 3: Runtime-agnostic controller and panel integration

**Files:**
- Modify: `extension/src/ui/state/use-analysis-controller.ts`
- Modify: `extension/tests/analysis-controller.test.tsx`
- Modify exact hunks: `extension/entrypoints/panel/App.tsx`
- Modify exact hunks: `extension/tests/panel-workflow.test.tsx`

**Interfaces:**
- `useAnalysisController()` no longer consumes provider or pipeline dependencies.
- `configure(runtime)` activates and resets to source.
- `updateRuntime(runtime)` replaces same-mode future execution access without resetting the visible workflow.
- `selectImage(image)` remains the Stage 3 single-image UI entry point.
- App dependencies replace provider/pipeline internals with `createDirectRuntime(config)` and `testDirectConnection(config, signal)`.

```ts
export type AppDependencies = {
  loadConfig(): Promise<ProviderConfig | null>;
  saveConfig(config: ProviderConfig): Promise<void>;
  loadMode(config: ProviderConfig | null): Promise<AnalysisMode>;
  saveMode(mode: AnalysisMode): Promise<void>;
  cloudGateway: CloudAnalysisGateway;
  createDirectRuntime(config: ProviderConfig): AnalysisRuntime;
  testDirectConnection(
    config: ProviderConfig,
    signal: AbortSignal,
  ): Promise<void>;
  inspect(): Promise<ChartContext>;
  capture(signal: AbortSignal): Promise<CapturedChart>;
};
```

- [ ] **Step 1: Rewrite controller tests against a fake runtime and verify RED**

Create a test helper implementing the common runtime contract. Preserve assertions for setup/source/preview/analyzing/completed, concise progress, retry, refresh, cancellation, stale resolution/rejection, stale annotation completion, and safe diagnostics. Add an explicit assertion that `configure(secondRuntime)` cancels the first runtime and clears its image/report/error state.

Run: `cd extension && pnpm exec vitest run tests/analysis-controller.test.tsx`

Expected: FAIL because the controller still expects provider/pipeline dependencies and provider config.

- [ ] **Step 2: Refactor the controller to runtime ownership**

Replace `configRef` with `runtimeRef`. Replace the active `AbortController` ref with an active-runtime ref. `analyze` submits one capture:

```ts
const outcome = await runtime.analyze({
  captures: [{ image, context: pageContext }],
  outputLanguage: language,
  onProgress: appendPublicProgress,
});
```

On success, set the existing report and annotations. On `AnalysisRuntimeFailure`, use its code and sanitized diagnostic. On any other exception, use `unknown` and no diagnostic. Keep the generation check before every post-await state update.

- [ ] **Step 3: Preserve cancellation and retry semantics**

`invalidateOperation()` and `cancel()` call `activeRuntime.cancel()` exactly once and advance the generation. A late resolve or rejection from a non-cooperative runtime cannot overwrite preview, cancelled, or a later completed analysis.

- [ ] **Step 4: Add failing App workflow tests for the boundary**

Replace App test injection of `getProvider`, `runAnalysis`, and `buildAnnotations` with a `createDirectRuntime` fake. Assert:

- bootstrap creates one Direct runtime only for active Direct with a config;
- initial Direct activation creates/configures one runtime after config and mode persistence;
- Direct settings create an updated runtime but retain the visible chart state;
- capture invokes only `runtime.analyze` and shows the unchanged report;
- runtime failure diagnostics remain localized and safe;
- Cloud default creates no Direct runtime and performs no chart inspection.

- [ ] **Step 5: Wire App to the Direct runtime factory**

Default dependencies use:

```ts
createDirectRuntime: (config) => new DirectAnalysisRuntime(config),
testDirectConnection: (config, signal) =>
  providerRegistry.get(config.provider).testConnection(config, signal),
```

Bootstrap and initial activation call `controller.configure(createDirectRuntime(config))`. Saving settings while Direct remains active calls `controller.updateRuntime(createDirectRuntime(config))`. Remove provider resolution, pipeline execution, and annotation construction from App dependencies.

- [ ] **Step 6: Run focused runtime integration tests**

Run:

```bash
cd extension
pnpm exec vitest run tests/analysis-runtime-contract.test.ts \
  tests/direct-analysis-runtime.test.ts \
  tests/analysis-controller.test.tsx \
  tests/panel-workflow.test.tsx \
  tests/analysis-mode-settings.test.tsx \
  tests/provider-setup.test.tsx
pnpm compile
git diff --check
```

Expected: all focused tests pass with no additional provider request.

- [ ] **Step 7: Commit Task 3 exact hunks**

Stage only the four listed files and commit:

```bash
git commit -m "refactor(community): drive panel through analysis runtime"
```

---

### Task 4: Stage 3 release verification and review checkpoint

**Files:**
- No production files.
- Verify the Stage 3 commit range and current worktree without staging unrelated changes.

**Interfaces:**
- Consumes the completed common contract, Direct runtime, controller, and App integration.
- Produces verification evidence only; Stage 4 remains untouched.

- [ ] **Step 1: Run the complete extension test suite**

Run: `cd extension && pnpm test`

Expected: every test file passes with zero failures and no paid provider request.

- [ ] **Step 2: Compile and build both browser targets**

Run:

```bash
cd extension
pnpm compile
pnpm build
pnpm build:edge
```

Expected: TypeScript, Chrome MV3, and Edge MV3 builds exit zero.

- [ ] **Step 3: Audit the production Cloud gateway and Direct boundary**

Run:

```bash
cd extension
rg -n "token|apiKey|screenshot|capture|analyze|fetch|connect" src/cloud/cloud-gateway.ts
rg -n "getProvider|runThreeStageAnalysis|buildAnnotations" entrypoints/panel/App.tsx src/ui/state/use-analysis-controller.ts
```

Expected: the first command finds no forbidden Cloud input or transport method; the second finds no provider/pipeline implementation detail in App or the controller.

- [ ] **Step 4: Inspect commit scope and whitespace**

Run:

```bash
git diff --check
git diff --cached --check
git status --short
git log -4 --oneline
```

Expected: no whitespace errors, no staged unrelated changes, and three Stage 3 implementation commits after the plan commit.

- [ ] **Step 5: Stop for user review**

Report runtime contract behavior, unchanged Direct provider-call count, fake Cloud contract coverage, test/build evidence, exact commits, and remaining unrelated dirty files. Do not begin Stage 4.

## Stage 3 Review Checklist

1. App and the React controller contain no provider resolution, prompt, pipeline, or annotation implementation detail.
2. Direct runtime performs the same three-stage analysis and returns the same report and annotations.
3. Direct rejects two or three captures before any provider or pipeline call.
4. Runtime cancellation and stale-result protection preserve existing behavior.
5. A fake Cloud runtime can advertise three-timeframe capability and accept three capture objects through the common contract.
6. The production Cloud gateway remains unavailable and has no credentials, screenshot, analyze, connect, or fetch input.
7. Chrome and Edge builds pass.
