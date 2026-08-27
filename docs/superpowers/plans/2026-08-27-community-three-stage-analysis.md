# Community Three-Stage Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the open-source extension's one-call screenshot analysis with a three-call, screenshot-grounded pipeline whose visible report aligns with ChartViz Cloud while remaining extension-only and single-timeframe.

**Architecture:** Two image-aware structured calls produce validated English visual facts and complete signal sets. A third text-only structured call reasons over the validated evidence bundle and produces a `community-3.0` final report in the selected user language. Provider transports become domain-neutral; all post-processing, risk arithmetic, coordinate normalization, annotations, and presentation remain local.

**Tech Stack:** TypeScript, React, Zod, Vitest, Testing Library, WXT, OpenAI Responses API, OpenRouter Chat Completions API, Gemini `generateContent` API.

**Spec:** `docs/superpowers/specs/2026-08-27-community-three-stage-analysis-design.md`

## Global Constraints

- A successful analysis makes exactly three semantic model calls.
- Only Stage 1 and Stage 2 receive the screenshot; Stage 3 is text-only.
- All system and user prompts are English; only Stage 3 controls final English or Simplified Chinese output.
- Internal facts, JSON keys, enums, IDs, timeframe tokens, prices, and coordinates remain English/fixed-format.
- The open-source pipeline contains no multi-timeframe, exchange OHLCV, news, history, Cloud-auth, quota, billing, or local-model logic.
- No silent semantic retry or signal recheck is allowed.
- The final report schema is exactly `community-3.0`; no `community-2.0` compatibility layer is required.
- The visible conclusion is `LONG`, `SHORT`, or `SIDEWAYS` / `做多`, `做空`, or `震荡`; `SIDEWAYS` is not `WAIT`.
- Existing unrelated dirty-worktree changes must be preserved; stage commits include only files owned by that stage.

---

### Task 1: Stage Contracts and English Prompt Builders

**Files:**
- Create: `extension/src/analysis/stages/shared-stage-types.ts`
- Create: `extension/src/analysis/stages/visual-facts.ts`
- Create: `extension/src/analysis/stages/visual-facts-schema.ts`
- Create: `extension/src/analysis/stages/visual-extraction-prompt.ts`
- Create: `extension/src/analysis/stages/signal-facts.ts`
- Create: `extension/src/analysis/stages/signal-facts-schema.ts`
- Create: `extension/src/analysis/stages/signal-extraction-prompt.ts`
- Create: `extension/src/analysis/stages/evidence-bundle.ts`
- Create: `extension/src/analysis/stages/evidence-reasoning-prompt.ts`
- Create: `extension/src/analysis/stages/community-report-v3.ts`
- Create: `extension/src/analysis/stages/community-report-v3-schema.ts`
- Test: `extension/tests/three-stage-contracts.test.ts`
- Test: `extension/tests/three-stage-prompts.test.ts`

**Interfaces:**
- Produces: `parseCommunityVisualFacts(value: unknown): CommunityVisualFacts`
- Produces: `parseCommunitySignalFacts(value: unknown): CommunitySignalFacts`
- Produces: `parseCommunityReportV3(value: unknown): CommunityReportV3`
- Produces: `buildVisualExtractionPrompt(input: StagePageContext): StagePrompt`
- Produces: `buildSignalExtractionPrompt(input: { context: StagePageContext; facts: CommunityVisualFacts }): StagePrompt`
- Produces: `buildEvidenceReasoningPrompt(input: { context: StagePageContext; evidence: CommunityEvidenceBundle; outputLanguage: OutputLanguage }): StagePrompt`
- Produces: `mergeCommunityEvidence(facts: CommunityVisualFacts, signals: CommunitySignalFacts): CommunityEvidenceBundle`
- Consumes: existing `JsonSchema` shape conventions from `extension/src/analysis/community-json-schema.ts` only as a style reference; new contracts remain independently versioned.

- [ ] **Step 1: Write failing contract tests**

Add literal valid Stage 1, Stage 2, and final fixtures. Assert successful parsing, exact schema versions, strict rejection of additional keys, invalid normalized ratios, duplicate IDs, incomplete signal drawing sets, empty user-facing strings, and `wait` rejection as a top-level conclusion.

```ts
expect(parseCommunityReportV3(validReport).conclusion.direction).toBe('sideways');
expect(() => parseCommunityReportV3({
  ...validReport,
  conclusion: { ...validReport.conclusion, direction: 'wait' },
})).toThrow();
```

- [ ] **Step 2: Run contract tests and verify RED**

Run: `pnpm vitest run tests/three-stage-contracts.test.ts`

Expected: FAIL because the stage modules do not exist.

- [ ] **Step 3: Implement strict stage types, Zod parsers, and JSON Schemas**

Use strict objects, bounded arrays, normalized `0..1` ratios, stable `Lxx`, `Pxx`, `Sxx`, and drawing IDs, and semantic `superRefine` rules. Keep segments internal to `CommunityVisualFacts`; omit them from `CommunityReportV3`.

The final top-level shape is:

```ts
type CommunityReportV3 = {
  schemaVersion: 'community-3.0';
  chart: { instrument: string | null; timeframe: string | null };
  conclusion: {
    direction: 'long' | 'short' | 'sideways';
    trend: 'bullish' | 'bearish' | 'sideways' | 'unclear';
    structure: 'hh-hl' | 'lh-ll' | 'range' | 'transition' | 'unclear';
    strength: 'strong' | 'moderate' | 'weak' | 'unclear';
    summary: string;
    primaryRisk: string;
    confidence: number;
  };
  marketExplanation: MarketExplanation;
  levels: FinalLevel[];
  tradePlan: ConditionalTradePlan;
  tradeSignals: FinalTradeSignal[];
  patterns: FinalPattern[];
  riskNotice: string;
};
```

- [ ] **Step 4: Run contract tests and verify GREEN**

Run: `pnpm vitest run tests/three-stage-contracts.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing prompt-boundary tests**

Assert behaviorally important prompt outputs:

- Stage 1 forbids recommendations and unsupported facts;
- Stage 2 requires matched entry/stop/target sets and point-in-time evaluation;
- Stage 3 contains the evidence hierarchy and selected output language;
- Stage 3 receives serialized evidence but no image reference;
- every prompt is provider-neutral and contains no multi-timeframe, exchange API, news, Cloud account, or broken-fragment instructions;
- page metadata is flattened, quoted, and labeled untrusted.

```ts
const zh = buildEvidenceReasoningPrompt({ context, evidence, outputLanguage: 'zh-CN' });
expect(zh.user).toContain('Output language: Simplified Chinese.');
expect(`${zh.system}\n${zh.user}`).not.toMatch(/multi[- ]timeframe|OHLCV|news search/i);
```

- [ ] **Step 6: Run prompt tests and verify RED**

Run: `pnpm vitest run tests/three-stage-prompts.test.ts`

Expected: FAIL because prompt builders do not exist.

- [ ] **Step 7: Implement three focused English prompt builders and evidence merge**

Each builder returns `{ version, system, user }`. Use versions `visual-1.0`, `signals-1.0`, and `reasoning-1.0`. Only `buildEvidenceReasoningPrompt` accepts `outputLanguage`. Serialize validated facts/evidence with `JSON.stringify`; never concatenate raw untrusted labels as instructions.

- [ ] **Step 8: Run Task 1 tests and compile**

Run:

```bash
pnpm vitest run tests/three-stage-contracts.test.ts tests/three-stage-prompts.test.ts
pnpm run compile
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 9: Commit Task 1 files only**

```bash
git add extension/src/analysis/stages extension/tests/three-stage-contracts.test.ts extension/tests/three-stage-prompts.test.ts
git commit -m "feat(community): define three-stage analysis contracts"
```

Review checkpoint: verify schemas, prompt responsibility separation, and language boundary before changing providers.

---

### Task 2: Domain-Neutral Structured Provider Transport

**Files:**
- Modify: `extension/src/providers/provider-types.ts`
- Create: `extension/src/providers/structured-response.ts`
- Modify: `extension/src/providers/openai-provider.ts`
- Modify: `extension/src/providers/openrouter-provider.ts`
- Modify: `extension/src/providers/gemini-provider.ts`
- Modify: `extension/src/providers/response-parser.ts`
- Modify: `extension/tests/openai-provider.test.ts`
- Modify: `extension/tests/openrouter-provider.test.ts`
- Modify: `extension/tests/gemini-provider.test.ts`
- Create: `extension/tests/structured-provider-stages.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and parse functions.
- Produces: `VisionProvider.generateStructured<T>(config, request): Promise<T>`.
- Preserves: `VisionProvider.testConnection(config, signal): Promise<void>`.

- [ ] **Step 1: Write failing cross-provider structured-generation tests**

For each provider, assert one image request and one text-only request. Verify exact provider payload boundaries: system prompt, user prompt, optional image, strict schema name/schema, model, `store: false` for OpenAI, and `require_parameters: true` for OpenRouter. Parse with a real Zod-backed stage parser.

- [ ] **Step 2: Run provider stage tests and verify RED**

Run: `pnpm vitest run tests/structured-provider-stages.test.ts`

Expected: FAIL because `generateStructured` does not exist.

- [ ] **Step 3: Add the generic provider request contract**

```ts
export type StructuredGenerationRequest<T> = {
  systemPrompt: string;
  userPrompt: string;
  image?: { mediaType: SupportedImageMediaType; dataUrl: string };
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  parse(value: unknown): T;
  signal: AbortSignal;
};
```

Remove final-report domain knowledge from provider transport. `structured-response.ts` extracts the provider envelope and then invokes `request.parse`.

- [ ] **Step 4: Implement OpenAI, OpenRouter, and Gemini structured transport**

Image parts are present only when `request.image` exists. Preserve current abort, timeout, HTTP status, secret-safety, response-size, and safe-diagnostic behavior.

- [ ] **Step 5: Migrate existing provider tests without weakening assertions**

Existing error-mapping, cancellation, timeout, response-envelope, image-validation, and secret-leak tests must exercise `generateStructured`. Connection-test behavior remains unchanged.

- [ ] **Step 6: Run provider tests and compile**

Run:

```bash
pnpm vitest run tests/structured-provider-stages.test.ts tests/openai-provider.test.ts tests/openrouter-provider.test.ts tests/gemini-provider.test.ts
pnpm run compile
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit Task 2 files only**

```bash
git add extension/src/providers/provider-types.ts extension/src/providers/structured-response.ts extension/src/providers/openai-provider.ts extension/src/providers/openrouter-provider.ts extension/src/providers/gemini-provider.ts extension/src/providers/response-parser.ts extension/tests/openai-provider.test.ts extension/tests/openrouter-provider.test.ts extension/tests/gemini-provider.test.ts extension/tests/structured-provider-stages.test.ts
git commit -m "refactor(community): support staged structured providers"
```

Review checkpoint: inspect provider payloads and confirm Stage 3 cannot include an image accidentally.

---

### Task 3: Three-Stage Orchestrator, Normalization, and Diagnostics

**Files:**
- Create: `extension/src/analysis/stages/normalize-visual-facts.ts`
- Create: `extension/src/analysis/stages/normalize-signals.ts`
- Create: `extension/src/analysis/stages/report-semantics-v3.ts`
- Create: `extension/src/analysis/stages/analysis-pipeline.ts`
- Modify: `extension/src/providers/provider-diagnostics.ts`
- Modify: `extension/src/ui/state/use-analysis-controller.ts`
- Modify: `extension/src/ui/components/AnalysisProgress.tsx`
- Modify: `extension/src/i18n/en.ts`
- Modify: `extension/src/i18n/zh-CN.ts`
- Create: `extension/tests/analysis-pipeline.test.ts`
- Modify: `extension/tests/analysis-controller.test.tsx`
- Modify: `extension/tests/analysis-error.test.tsx`

**Interfaces:**
- Consumes: `VisionProvider.generateStructured`, Task 1 contracts/prompts.
- Produces: `runThreeStageAnalysis(input, dependencies): Promise<CommunityReportV3>`.
- Produces: safe failure stages enumerated in the design spec.

- [ ] **Step 1: Write failing pipeline sequence tests**

Use a deterministic fake transport at the provider boundary and real prompt builders/parsers. Assert three ordered calls, images only on calls one and two, selected language only in call three, stage outputs passed forward, no later call after failure/cancellation, and a fresh three-call sequence after user retry.

- [ ] **Step 2: Run pipeline tests and verify RED**

Run: `pnpm vitest run tests/analysis-pipeline.test.ts`

Expected: FAIL because `runThreeStageAnalysis` does not exist.

- [ ] **Step 3: Implement deterministic Stage 1 and Stage 2 normalization**

Validate monotonic price anchors, calibrate price-positioned y ratios, preserve entry-candle wick coordinates, reject incomplete signal sets, compute risk/reward from readable numeric values, and merge stable evidence references. No model repair call is allowed.

- [ ] **Step 4: Implement the orchestrator**

Call Stage 1, normalize, call Stage 2, normalize/merge, call Stage 3, and run final semantic validation. Wrap each boundary with the precise safe failure stage. Use one caller-owned `AbortSignal` throughout.

- [ ] **Step 5: Run pipeline tests and verify GREEN**

Run: `pnpm vitest run tests/analysis-pipeline.test.ts`

Expected: PASS.

- [ ] **Step 6: Write failing controller/progress/diagnostic tests**

Assert concise user progress, cancellation, stale-generation protection, exact failure-stage diagnostics, and absence of prompts/images/full responses from diagnostics.

- [ ] **Step 7: Integrate the pipeline into `useAnalysisController`**

Replace direct `provider.analyze` with `runThreeStageAnalysis`. Keep the normal UI progress generic: reading chart, reviewing evidence, preparing result. Keep precise stage names only in expandable safe diagnostics.

- [ ] **Step 8: Run Task 3 tests and compile**

Run:

```bash
pnpm vitest run tests/analysis-pipeline.test.ts tests/analysis-controller.test.tsx tests/analysis-error.test.tsx
pnpm run compile
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 9: Commit Task 3 files only**

```bash
git add extension/src/analysis/stages extension/src/providers/provider-diagnostics.ts extension/src/ui/state/use-analysis-controller.ts extension/src/ui/components/AnalysisProgress.tsx extension/src/i18n extension/tests/analysis-pipeline.test.ts extension/tests/analysis-controller.test.tsx extension/tests/analysis-error.test.tsx
git commit -m "feat(community): orchestrate three-stage chart analysis"
```

Review checkpoint: run one English and one Chinese provider-fixture flow and inspect safe diagnostics.

---

### Task 4: Cloud-Aligned `community-3.0` Presentation and Annotations

**Files:**
- Modify: `extension/src/ui/components/ReportView.tsx`
- Modify: `extension/src/ui/export/copy-report.ts`
- Modify: `extension/src/annotations/build-annotations.ts`
- Modify: `extension/src/annotations/render-signal.ts`
- Modify: `extension/src/i18n/en.ts`
- Modify: `extension/src/i18n/zh-CN.ts`
- Modify: `extension/entrypoints/panel/style.css`
- Modify: `extension/tests/community-ui-fixtures.ts`
- Modify: `extension/tests/report-view.test.tsx`
- Modify: `extension/tests/build-annotations.test.ts`
- Modify: `extension/tests/render-signal.test.ts`

**Interfaces:**
- Consumes: `CommunityReportV3` and locally rendered annotation groups.
- Produces: Cloud-aligned visible report and copied report text.

- [ ] **Step 1: Write failing direct-conclusion UI tests**

Assert no `Current view`/`当前观点`, heading `LONG`/`做多` or `SIDEWAYS`/`震荡`, no duplicate direction metric, retained confidence/strength/structure/summary/risk, and exact visible module order.

- [ ] **Step 2: Run report UI tests and verify RED**

Run: `pnpm vitest run tests/report-view.test.tsx`

Expected: FAIL because the current report still renders `Current view`.

- [ ] **Step 3: Implement `CommunityReportV3` presentation and copied text**

Render original screenshot, direct conclusion, market explanation, levels, level image, scenarios, individual signal cards/images, individual pattern cards/images, and risk notice. Translate enums in UI only.

- [ ] **Step 4: Write failing annotation tests for V3 IDs and signal direction**

Assert one signal image per `Sxx`, one pattern image per `Pxx`, calibrated stop/target lines, and Long arrows drawn below the candle pointing upward / Short arrows above the candle pointing downward.

- [ ] **Step 5: Migrate annotation builders and renderers**

Use validated V3 references. Preserve original image data. Omit invalid drawing layers without discarding valid report text.

- [ ] **Step 6: Run Task 4 tests and compile**

Run:

```bash
pnpm vitest run tests/report-view.test.tsx tests/build-annotations.test.ts tests/render-signal.test.ts
pnpm run compile
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit Task 4 files only**

```bash
git add extension/src/ui/components/ReportView.tsx extension/src/ui/export/copy-report.ts extension/src/annotations/build-annotations.ts extension/src/annotations/render-signal.ts extension/src/i18n/en.ts extension/src/i18n/zh-CN.ts extension/entrypoints/panel/style.css extension/tests/community-ui-fixtures.ts extension/tests/report-view.test.tsx extension/tests/build-annotations.test.ts extension/tests/render-signal.test.ts
git commit -m "feat(community): align staged report presentation with cloud"
```

Review checkpoint: visually inspect English and Chinese completed-report fixtures at panel width and full-height layout.

---

### Task 5: Setup Copy, Migration Cleanup, Full Verification, and Release Artifact

**Files:**
- Modify: `extension/src/ui/components/ProviderSetup.tsx`
- Modify: `extension/src/i18n/en.ts`
- Modify: `extension/src/i18n/zh-CN.ts`
- Delete: `extension/src/analysis/community-prompt.ts` after all imports migrate
- Delete: `extension/src/analysis/community-report.ts` after all imports migrate
- Delete: `extension/src/analysis/community-json-schema.ts` after all imports migrate
- Modify: `extension/tests/provider-setup.test.tsx`
- Modify: `extension/tests/panel-workflow.test.tsx`
- Delete: `extension/tests/community-prompt.test.ts` with the obsolete one-call prompt module
- Delete: `extension/tests/community-report.test.ts` with the obsolete `community-2.0` report module
- Delete: `extension/tests/community-json-schema.test.ts` with the obsolete `community-2.0` schema module
- Modify: `README.md`
- Modify: `docs/manual-smoke-test.md`

**Interfaces:**
- Consumes: complete three-stage implementation.
- Produces: a coherent setup experience and verified Chrome/Edge builds.

- [ ] **Step 1: Write failing setup and workflow tests**

Assert the setup screen states that one analysis uses three provider requests, saving configuration makes no provider call, connection testing makes exactly one call, capture starts the three-stage pipeline, and manual retry restarts it.

- [ ] **Step 2: Run setup/workflow tests and verify RED**

Run: `pnpm vitest run tests/provider-setup.test.tsx tests/panel-workflow.test.tsx`

Expected: FAIL on the new three-request disclosure and staged workflow assertions.

- [ ] **Step 3: Update setup copy and remove obsolete one-call modules**

Remove old `community-2.0` prompt/report imports after `rg` proves no production consumers remain. Do not retain a compatibility adapter or shadow path.

- [ ] **Step 4: Update README and smoke-test instructions**

Document three requests per analysis, direct provider data flow, no silent retries, English internal prompts, final language selection, single timeframe, supported providers/models, and Chrome unpacked-install steps.

- [ ] **Step 5: Run focused workflow tests**

Run:

```bash
pnpm vitest run tests/provider-setup.test.tsx tests/panel-workflow.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run the full verification gate**

Run:

```bash
pnpm test
pnpm run compile
pnpm run build
pnpm run build:edge
```

Expected: all tests pass; TypeScript, Chrome MV3, and Edge MV3 builds exit 0.

- [ ] **Step 7: Run release-boundary and secret scans**

Run from repository worktree root:

```bash
./scripts/verify-release.sh
rg -n "sk-[A-Za-z0-9_-]{12,}|OPENROUTER_API_KEY=.+|GOOGLE_API_KEY=.+" extension --glob '!pnpm-lock.yaml'
```

Expected: release verification exits 0 and the secret scan returns no committed secret values.

- [ ] **Step 8: Commit Task 5 files only**

```bash
git add extension/src/ui/components/ProviderSetup.tsx extension/src/i18n/en.ts extension/src/i18n/zh-CN.ts extension/src/analysis/community-prompt.ts extension/src/analysis/community-report.ts extension/src/analysis/community-json-schema.ts extension/tests/provider-setup.test.tsx extension/tests/panel-workflow.test.tsx extension/tests/community-prompt.test.ts extension/tests/community-report.test.ts extension/tests/community-json-schema.test.ts README.md docs/manual-smoke-test.md
git commit -m "release(community): complete three-stage extension analysis"
```

- [ ] **Step 9: Perform manual smoke checks**

Load the unpacked Chrome build and verify one English TradingView analysis, one Simplified Chinese analysis, one provider error, cancellation during each stage, image zoom/download, and one signal per annotation image. Record results in `docs/manual-smoke-test.md`.
