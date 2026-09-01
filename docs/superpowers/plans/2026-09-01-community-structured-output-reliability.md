# Community Structured Output Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenRouter Claude analysis use native constrained JSON output, preserve the actual router path in diagnostics, and keep ChartViz domain validation strict without adding a fourth LLM call.

**Architecture:** The OpenRouter adapter selects an envelope protocol by model family. Anthropic models use `/api/v1/messages` with `output_config.format`; other curated OpenRouter models keep Chat Completions. A transport-only schema transformer removes constraints unsupported by Claude while the original Zod parser remains authoritative locally. Safe router metadata flows through an optional per-request trace callback into each analysis-stage failure snapshot.

**Tech Stack:** TypeScript 7, WXT 0.21, Zod 4, Vitest 4, Fetch API, Chrome/Edge Manifest V3.

**Spec:** `docs/superpowers/specs/2026-09-01-community-structured-output-reliability-design.md`

## Global Constraints

- Keep exactly three model calls in the normal analysis pipeline.
- Do not add an LLM repair call.
- Do not accept provider-invented alternate analytical schemas.
- Never expose API keys or image Base64 data in diagnostics.
- Keep the original application schema as the final local validator.
- Preserve all current price, timeframe, geometry, evidence, and risk semantic checks.

---

### Task 1: Claude transport-schema transformation

**Files:**
- Create: `extension/src/providers/anthropic-transport-schema.ts`
- Test: `extension/tests/anthropic-transport-schema.test.ts`

**Interfaces:**
- Consumes: application JSON Schema as `Record<string, unknown>`.
- Produces: `toAnthropicTransportSchema(schema: Record<string, unknown>): Record<string, unknown>`.
- The returned object is a deep copy and never mutates the application schema.

- [ ] **Step 1: Write failing transformation tests**

Cover nested objects and arrays. Assert that unsupported numeric, string-length, and collection-size constraints are absent from the transported schema, constraint text is appended to descriptions, nested objects receive `additionalProperties: false`, and the original schema is unchanged.

```ts
const transported = toAnthropicTransportSchema(applicationSchema);
expect(transported).not.toBe(applicationSchema);
expect(JSON.stringify(transported)).not.toContain('"minimum"');
expect(JSON.stringify(transported)).not.toContain('"maxItems"');
expect(applicationSchema.properties.confidence.minimum).toBe(0);
expect(transported).toMatchObject({ additionalProperties: false });
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd extension && pnpm vitest run tests/anthropic-transport-schema.test.ts
```

Expected: FAIL because `toAnthropicTransportSchema` does not exist.

- [ ] **Step 3: Implement the recursive transformer**

Remove unsupported generation constraints:

```ts
const unsupportedKeywords = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'minProperties', 'maxProperties',
]);
```

Keep structural keywords such as `type`, `properties`, `required`, `items`, `enum`, `const`, `anyOf`, and `additionalProperties`. Move unsupported constraints into descriptions and keep local validation unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the isolated transformer**

```bash
git add extension/src/providers/anthropic-transport-schema.ts extension/tests/anthropic-transport-schema.test.ts
git commit -m "feat(extension): transform schemas for Claude output"
```

---

### Task 2: Safe OpenRouter trace metadata

**Files:**
- Create: `extension/src/providers/openrouter-trace.ts`
- Modify: `extension/src/providers/provider-types.ts`
- Modify: `extension/src/providers/provider-diagnostics.ts`
- Modify: `extension/src/analysis/stages/analysis-pipeline.ts`
- Test: `extension/tests/provider-diagnostics.test.ts`
- Test: `extension/tests/analysis-pipeline.test.ts`

**Interfaces:**
- Produces immutable `ProviderTrace` and `parseOpenRouterTrace(payload: unknown): ProviderTrace | null`.
- Adds optional `onTrace?(trace: ProviderTrace): void` to `StructuredGenerationRequest<T>`.
- Adds optional `providerTrace?: ProviderTrace` to `AnalysisStageSnapshot`.

- [ ] **Step 1: Write failing safe-trace tests**

Use a response fixture with generation ID, returned model, provider, usage, summary, strategy, attempts, and pipeline entries. Assert the trace keeps only safe routing scalars and omits arbitrary metadata data, headers, authorization, prompts, response text, and unknown fields.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd extension && pnpm vitest run tests/provider-diagnostics.test.ts tests/analysis-pipeline.test.ts
```

Expected: FAIL because the trace parser and snapshot field do not exist.

- [ ] **Step 3: Implement safe trace parsing and snapshot propagation**

Call `onTrace` once per successful response. In each pipeline stage, attach the trace only to that stage's mutable snapshot. Continue using the existing snapshot sanitizer as defense in depth.

```ts
onTrace(trace) {
  visualStage.providerTrace = trace;
}
```

- [ ] **Step 4: Verify trace tests GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit trace support**

```bash
git add extension/src/providers/openrouter-trace.ts extension/src/providers/provider-types.ts extension/src/providers/provider-diagnostics.ts extension/src/analysis/stages/analysis-pipeline.ts extension/tests/provider-diagnostics.test.ts extension/tests/analysis-pipeline.test.ts
git commit -m "feat(extension): preserve OpenRouter route diagnostics"
```

---

### Task 3: Anthropic Messages structured-output transport

**Files:**
- Modify: `extension/src/providers/openrouter-provider.ts`
- Modify: `extension/src/providers/response-parser.ts`
- Modify: `extension/src/providers/provider-errors.ts`
- Test: `extension/tests/openrouter-provider.test.ts`

**Interfaces:**
- Anthropic model IDs matching `^anthropic/` use `https://openrouter.ai/api/v1/messages`.
- Other OpenRouter models continue using `https://openrouter.ai/api/v1/chat/completions`.
- Produces `extractOpenRouterAnthropicStructuredValue(payload: unknown): unknown`.
- Adds explicit error codes `provider_refusal` and `output_truncated`.

- [ ] **Step 1: Write failing Anthropic request tests**

Assert one fetch to `/api/v1/messages` with `max_tokens: 32000`, top-level `system`, Anthropic text/image content blocks, transformed `output_config.format`, and `provider.require_parameters: true`. Assert the request header includes `X-OpenRouter-Metadata: enabled` and the original schema is unchanged.

- [ ] **Step 2: Write failing Anthropic response tests**

Cover one valid JSON text block, an optional thinking block before it, `stop_reason: refusal`, `stop_reason: max_tokens`, multiple text blocks, missing text, invalid JSON, and schema-invalid JSON. Each case performs exactly one fetch and preserves safe trace data.

- [ ] **Step 3: Run the OpenRouter tests and verify RED**

```bash
cd extension && pnpm vitest run tests/openrouter-provider.test.ts
```

Expected: FAIL because all OpenRouter models currently use Chat Completions.

- [ ] **Step 4: Implement model-family request construction**

Split body construction into Chat Completions and Anthropic Messages variants. Convert the data URL into an Anthropic base64 image source without logging it. Apply `toAnthropicTransportSchema` only to Anthropic requests. Keep cancellation and timeout shared.

- [ ] **Step 5: Implement strict Anthropic envelope parsing**

Accept a completed assistant message with exactly one text block and only documented thinking blocks. Reject unknown blocks, refusals, truncation, missing content, and extra text blocks with precise diagnostics. Parse the text as bare JSON through the shared parser.

- [ ] **Step 6: Verify focused tests GREEN**

Run the command from Step 3. Expected: PASS, including existing Chat Completions tests.

- [ ] **Step 7: Commit the transport**

```bash
git add extension/src/providers/openrouter-provider.ts extension/src/providers/response-parser.ts extension/src/providers/provider-errors.ts extension/tests/openrouter-provider.test.ts
git commit -m "fix(extension): use native Claude structured outputs"
```

---

### Task 4: Described visual Wire Schema

**Files:**
- Create: `extension/src/analysis/stages/visual-wire-schema.ts`
- Modify: `extension/src/analysis/stages/visual-facts-schema.ts`
- Modify: `extension/src/analysis/stages/visual-facts.ts`
- Modify: `extension/src/analysis/stages/normalize-visual-facts.ts`
- Modify: `extension/src/analysis/stages/visual-extraction-prompt.ts`
- Modify: `extension/src/analysis/stages/analysis-pipeline.ts`
- Modify: `extension/tests/three-stage-fixtures.ts`
- Test: `extension/tests/three-stage-contracts.test.ts`
- Test: `extension/tests/three-stage-prompts.test.ts`
- Test: `extension/tests/analysis-pipeline.test.ts`

**Interfaces:**
- Produces `communityVisualWireJsonSchema` and `parseCommunityVisualWireFacts(value)`.
- Produces `toCommunityVisualFacts(wireFacts, context)` as the only Wire-to-Domain converter.
- `CommunityVisualFacts` remains the type consumed by signal extraction and evidence reasoning.

- [ ] **Step 1: Write failing Wire Schema tests**

Require `community-visual-wire-1.0` and descriptions for all provider-facing properties. Remove only deterministic duplicates: model-supplied quality summary, numeric price-anchor label, and chart identity when trusted page context is present. Assert the converter creates stable local values without inventing analytical evidence.

- [ ] **Step 2: Add captured alternate-schema rejection fixtures**

Add minimized fixtures from both captured Claude outputs containing `imageQuality.overall`, `pricePanelBounds.xMin`, and `priceAction.trendDirection`. Assert they remain rejected rather than translated into domain evidence.

- [ ] **Step 3: Run contract and pipeline tests and verify RED**

```bash
cd extension && pnpm vitest run tests/three-stage-contracts.test.ts tests/three-stage-prompts.test.ts tests/analysis-pipeline.test.ts
```

Expected: FAIL because the Wire Schema and converter do not exist.

- [ ] **Step 4: Implement the Wire Schema and deterministic converter**

Keep analytical fields required and strict. Use Zod `.describe()` for every provider-facing field. The converter may derive only chart identity precedence, quality summary, numeric anchor labels, and already-supported canonical localization. It throws for missing price action, evidence, levels, patterns, segments, or invalid coordinates.

- [ ] **Step 5: Update the visual prompt and pipeline**

Change the prompt version to `visual-2.0`, name the wire schema explicitly, and include a compact exact-field skeleton. Pass the Wire Schema/parser to the provider, then convert before signal extraction.

- [ ] **Step 6: Verify focused tests GREEN**

Run the command from Step 3. Expected: PASS.

- [ ] **Step 7: Commit the Wire Schema**

```bash
git add extension/src/analysis/stages/visual-wire-schema.ts extension/src/analysis/stages/visual-facts-schema.ts extension/src/analysis/stages/visual-facts.ts extension/src/analysis/stages/normalize-visual-facts.ts extension/src/analysis/stages/visual-extraction-prompt.ts extension/src/analysis/stages/analysis-pipeline.ts extension/tests/three-stage-fixtures.ts extension/tests/three-stage-contracts.test.ts extension/tests/three-stage-prompts.test.ts extension/tests/analysis-pipeline.test.ts
git commit -m "refactor(extension): separate visual wire contract"
```

---

### Task 5: Full regression and release-candidate verification

**Files:**
- Modify only if verification exposes a regression reproduced by a new failing test.

**Interfaces:**
- No new interfaces; verifies Tasks 1–4 together.

- [ ] **Step 1: Run TypeScript compilation**

```bash
cd extension && pnpm compile
```

Expected: exit 0.

- [ ] **Step 2: Run all tests**

```bash
cd extension && pnpm test
```

Expected: all tests pass with no unhandled errors.

- [ ] **Step 3: Build Chrome and Edge**

```bash
cd extension && pnpm build && pnpm build:edge
```

Expected: both production builds complete successfully.

- [ ] **Step 4: Inspect generated manifests and permissions**

```bash
jq '{name,version,permissions,host_permissions}' extension/.output/chrome-mv3/manifest.json
jq '{name,version,permissions,host_permissions}' extension/.output/edge-mv3/manifest.json
```

Expected: no new permissions or host origins.

- [ ] **Step 5: Run repository hygiene checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended source, test, design, and plan files are modified.

- [ ] **Step 6: Report evidence without publishing**

Report exact test counts, both build results, and remaining limitations. Do not merge, tag, push, deploy, or publish unless separately requested.
