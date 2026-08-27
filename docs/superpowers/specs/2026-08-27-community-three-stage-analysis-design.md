# ChartViz Open-Source Extension Three-Stage Analysis Design

Date: 2026-08-27
Status: Proposed for implementation
Target: open-source, extension-only ChartViz edition

## 1. Objective

Replace the current one-call screenshot analysis with a three-stage pipeline modeled on the Cloud analysis architecture:

1. visual evidence extraction;
2. trade-signal extraction;
3. evidence reasoning and final report generation.

The open-source extension must remain self-contained. It sends requests directly from the browser extension to the user-selected multimodal provider using the user's API key. It does not depend on the ChartViz Cloud backend.

The final result should align with the Cloud product's visible report structure while remaining smaller than the Cloud backend contract.

## 2. Goals

- Improve factual grounding by separating screenshot observation from interpretation.
- Give trade signals a dedicated image-aware pass instead of making them compete with the full report in one request.
- Apply an explicit price-action evidence hierarchy during final reasoning.
- Keep internal fact extraction language-stable and generate only the final narrative in the user's selected language.
- Keep support/resistance, signals, and patterns traceable to independently annotated images.
- Show a direct top-level conclusion: `LONG`, `SHORT`, or `SIDEWAYS` (做多、做空、震荡).
- Preserve direct-provider support for OpenAI, OpenRouter, and Gemini.
- Provide stage-specific safe diagnostics without exposing API keys, screenshots, prompts, or full model responses in the normal UI.

## 3. Non-goals

The open-source edition will not add:

- multi-timeframe analysis;
- Binance, OKX, Bybit, or other exchange OHLCV APIs;
- server-calculated indicators;
- Cloud tokens or ChartViz account authentication;
- analysis history;
- news search;
- local models;
- billing, quota, plans, or subscriptions;
- Cloud-only site-specific analysis such as VergeX cost/liquidation maps;
- Cloud database, Redis, background tasks, or server-side image storage.

## 4. Architectural Choice

The extension will use a lightweight Cloud-compatible analysis contract rather than copy Cloud `AnalysisReport 1.3` verbatim.

Reasons:

- the Cloud report contains external data-source, multi-timeframe, account, and deterministic server fields that have no valid source in a pure extension;
- copying those fields would create empty placeholders and misleading claims;
- visible module alignment provides the user benefit without coupling the two repositories;
- the open-source and Cloud repositories remain independently versioned and independently deployable.

The final open-source schema version will become `community-3.0`. Compatibility with `community-2.0` is not required because this edition has not been formally released and stores no analysis history.

## 5. Pipeline

```text
captured screenshot
        |
        v
Stage 1: Visual Evidence Extraction (image + English prompts)
        |
        v
local validation and coordinate normalization
        |
        v
Stage 2: Trade-Signal Extraction (image + Stage 1 facts + English prompts)
        |
        v
local signal-set validation and evidence merge
        |
        v
Stage 3: Evidence Reasoning (structured facts only + English prompts)
        |
        v
local semantic/risk validation and annotation rendering
        |
        v
Cloud-aligned user report in English or Simplified Chinese
```

A successful single-timeframe analysis makes exactly three semantic model calls. The extension will not perform silent semantic repair or signal recheck calls. A user-initiated retry starts a new three-stage analysis.

No model call is needed for site detection, screenshot capture, image processing, deterministic validation, coordinate calibration, risk arithmetic, or annotation rendering.

## 6. Provider Interface

The existing provider interface returns only a final `CommunityReport`, which prevents staged schemas. Replace it with one generic structured-generation operation:

```ts
type StructuredGenerationRequest<T> = {
  systemPrompt: string;
  userPrompt: string;
  image?: ProcessedImageReference;
  schemaName: string;
  jsonSchema: JsonSchema;
  parse(value: unknown): T;
  signal: AbortSignal;
};

interface VisionProvider {
  generateStructured<T>(
    config: ProviderConfig,
    request: StructuredGenerationRequest<T>,
  ): Promise<T>;
}
```

Each provider remains responsible only for transport and response-envelope parsing:

- OpenAI Responses API;
- OpenRouter Chat Completions API;
- Gemini `generateContent` API.

The stage owns its schema and domain validation. Provider code must not contain community-report-specific parsing.

The optional connection test remains a separate request and is not part of an analysis.

## 7. Stage 1: Visual Evidence Extraction

### 7.1 Role

Stage 1 is a conservative evidence extractor, not a market-direction recommender. This avoids early directional anchoring.

System prompt, always in English:

```text
You are a conservative visual evidence extractor for candlestick charts.
Return only schema-valid observations that are directly supported by the supplied screenshot.
Do not make a trading recommendation.
```

### 7.2 Responsibilities

Extract only screenshot-visible information:

- instrument and timeframe when readable;
- image quality and limitations;
- price panel bounds and readable price-axis anchors;
- current price-action trend and market structure;
- meaningful swing behavior;
- volume expansion/contraction and price-volume confirmation or disagreement;
- visibly identifiable RSI, MACD, and other indicators;
- support and resistance candidates;
- credible chart patterns and their defining coordinates;
- two to eight meaningful price-action segments for internal reasoning;
- visible time anchors or conservative relative chart regions;
- drawing candidates for levels and patterns.

### 7.3 Guardrails

- Never infer unreadable metadata from candle shape.
- Never invent a price, timestamp, indicator name, or indicator value.
- Distinguish a live candle from closed candles when visually possible.
- Use relative positions when the time scale is unreadable.
- Do not emit `unavailable`, placeholder, or guessed observations.
- Keep all human-readable internal facts in English.
- Use full-image normalized coordinates from 0 through 1.
- Prefer zones over false precision when a level is visibly broad.

### 7.4 Output

`CommunityVisualFacts` contains:

- `schemaVersion: "community-visual-1.0"`;
- chart metadata;
- image quality;
- price panel bounds and price scale anchors;
- price action and structure;
- volume analysis;
- indicator readings;
- level candidates;
- pattern candidates;
- internal segments;
- non-signal drawing candidates.

The schema has strict keys, bounded arrays, non-empty strings, normalized coordinate ranges, and explicit nullable fields.

## 8. Local Normalization After Stage 1

Before Stage 2:

- validate the complete Stage 1 schema;
- reject duplicate IDs;
- reject invalid panel bounds and out-of-range coordinates;
- calibrate price-positioned drawing heights from two or more monotonic price-axis anchors;
- remove drawings whose coordinates cannot be validated;
- deduplicate overlapping level candidates;
- preserve the entry-candle coordinate rule for later signal arrows;
- preserve the original screenshot without modification.

This processing is deterministic and does not call a model.

## 9. Stage 2: Trade-Signal Extraction

### 9.1 Role

Stage 2 is an image-aware trade-signal extractor. It receives the same screenshot and validated Stage 1 facts.

System prompt, always in English:

```text
You are a focused candlestick-chart trade-signal visual extractor.
Return only complete, schema-valid educational signal sets containing entry, structural stop, and target levels.
```

### 9.2 Responsibilities

Inspect:

- reversal signals;
- breakout and breakdown signals;
- rejection and failed-breakout signals;
- trend-pullback signals;
- RSI confirmation when visible;
- MACD confirmation when visible;
- traded-volume confirmation or disagreement.

For every signal return:

- stable ID `S01` through `S99`;
- `long` or `short` direction;
- signal candle/time anchor;
- point-in-time thesis;
- evidence available at or before that candle;
- entry price and signal-candle coordinate;
- structural stop;
- one to three targets;
- estimated risk/reward when numeric values are readable;
- complete entry, stop, and target drawing candidates.

### 9.3 Guardrails

- Ignore every candle to the right when evaluating whether a historical setup existed.
- Later price action cannot change a signal's original direction or levels.
- Do not emit an incomplete signal.
- Return zero signals when no defensible complete setup is visible.
- Do not force a signal because the final report expects one.
- A top-level sideways conclusion does not suppress a valid historical signal.
- For a Long signal, the arrow points upward from below the signal candle toward its low; for a Short signal, it points downward from above the candle toward its high.
- One signal will later render to one annotated image.

### 9.4 Output

`CommunitySignalFacts` contains:

- `schemaVersion: "community-signals-1.0"`;
- zero to four complete signals;
- matched entry/stop/target drawing sets;
- strict signal IDs, directions, normalized coordinates, and price labels.

## 10. Local Evidence Merge After Stage 2

The extension deterministically:

- validates complete entry/stop/target sets;
- rejects orphaned or duplicate signal drawings;
- calibrates stop and target heights from Stage 1 price-axis anchors;
- preserves the signal candle-edge coordinate for entry arrows;
- calculates numeric risk/reward when entry, stop, and target prices are available;
- combines Stage 1 facts and Stage 2 signals into `CommunityEvidenceBundle`;
- attaches stable evidence references used only by structured fields, never visible narrative.

## 11. Stage 3: Evidence Reasoning

### 11.1 Role

Stage 3 receives no image. It reasons only from the validated evidence bundle.

System prompt, always in English:

```text
You are a conservative price-action analyst and trade-setup classifier.
Return one schema-valid, beginner-readable analysis grounded only in the supplied validated evidence.
```

### 11.2 Evidence Hierarchy

Apply evidence in this order:

1. market regime and swing structure;
2. price location relative to ranked support and resistance zones;
3. close, acceptance, continuation, rejection, and held retest;
4. traded volume or one independent readable indicator;
5. individual candle or named chart pattern.

One candle or named pattern cannot override contradictory structure or poor location. Correlated indicators do not count as independent confirmation.

### 11.3 Analysis Rules

- Classify the visible market conclusion as `long`, `short`, or `sideways`.
- Explain strength, structure, location, supporting evidence, opposing evidence, and the main risk.
- For every important conclusion, express the causal chain: visible observation, market implication, and effect on the conclusion.
- Explain low or contracting volume in its actual price context; never treat it as automatically bearish.
- Explain the market meaning of readable RSI and MACD behavior rather than listing indicator states.
- Rank no more than two supports and two resistances in the final visible report.
- Merge overlapping levels into a zone rather than duplicate them.
- Include no more than three credible patterns.
- Create conditional Long, Short, and Wait scenarios.
- Keep entry, trigger, confirmation, stop, target, and pending conditions out of the top conclusion summary.
- Preserve valid Stage 2 signals without hindsight modification.
- Never include internal segment IDs or evidence IDs in user-facing text.
- Never promise profit or provide personalized investment advice.

### 11.4 Language Boundary

All Stage 3 instructions remain English. The request includes exactly one output-language directive:

```text
Output language: English.
```

or:

```text
Output language: Simplified Chinese.
```

Requirements:

- every user-facing string uses the selected output language;
- JSON property names and enum values remain fixed English identifiers;
- instrument symbols, timeframe tokens, prices, coordinates, and IDs are not translated;
- internal English facts must be paraphrased naturally, not copied into Chinese output;
- enum display translation happens in the UI, not in the model output.

### 11.5 Output

The final `CommunityReportV3` contains:

- `schemaVersion: "community-3.0"`;
- chart metadata;
- top conclusion;
- market explanation;
- ranked support and resistance;
- conditional trade plan;
- educational trade signals;
- chart patterns;
- risk notice.

It does not contain Cloud-only multi-timeframe, external-source, billing, task, or storage fields.

## 12. Final Report Presentation

The visible order is:

1. original screenshot and chart metadata;
2. direct conclusion card;
3. market explanation;
4. support and resistance cards;
5. support/resistance annotated image;
6. conditional Long, Short, and Wait scenarios;
7. educational trade signals, each followed by its own annotated image;
8. chart patterns, each followed by its own annotated image;
9. risk notice.

### 12.1 Direct Conclusion

Remove `Current view` and `当前观点` from the visible report and copied text.

The conclusion heading is:

| Enum | English | Simplified Chinese |
|---|---|---|
| `long` | `LONG` | `做多` |
| `short` | `SHORT` | `做空` |
| `sideways` | `SIDEWAYS` | `震荡` |

The card also shows confidence, trend strength, market structure, summary, and primary risk. It does not repeat a separate direction metric.

`sideways` describes the market conclusion. `wait` remains an action inside the conditional trade plan. The two concepts are never translated into each other.

### 12.2 Images

- The original screenshot remains unchanged.
- Support/resistance annotations render in a separate image.
- Each signal renders in a separate image.
- Each pattern renders in a separate image.
- Every image supports click-to-zoom and download.
- Download controls remain hidden during active analysis.

## 13. Local Risk and Semantic Validation

The extension performs deterministic checks after Stage 3:

- strict `community-3.0` schema validation;
- output-language consistency checks for user-facing text;
- no internal evidence or segment IDs in visible text;
- referenced level, pattern, signal, and drawing IDs exist;
- Long entry/stop/target price ordering is coherent when numeric prices are available;
- Short entry/stop/target ordering is coherent when numeric prices are available;
- risk/reward is recomputed locally when numeric inputs are available;
- incomplete signal sets are omitted, not repaired by another model call;
- invalid drawing coordinates are omitted without removing otherwise valid narrative;
- external data-source claims are rejected because the open-source edition is screenshot-only.

The local checker does not return Cloud `TRADE`, `WAIT`, or `NO_TRADE` execution states and does not calculate position size.

## 14. Progress and Error Handling

The normal user interface shows concise progress messages rather than internal implementation details:

- reading the chart;
- reviewing the evidence;
- preparing the result.

Internally, diagnostics identify the exact failure stage:

- `visual_extraction_transport`;
- `visual_extraction_shape`;
- `visual_extraction_semantics`;
- `signal_extraction_transport`;
- `signal_extraction_shape`;
- `signal_extraction_semantics`;
- `evidence_reasoning_transport`;
- `report_shape`;
- `report_semantics`;
- `annotation_rendering`.

Safe diagnostics may contain request ID, provider, model, stage, duration, HTTP status, and validation issue paths. They must not contain:

- API keys;
- screenshot bytes or data URLs;
- full prompts;
- full model responses;
- provider authorization headers.

Cancellation aborts the active request and prevents later stages from starting. Refreshing or selecting another image invalidates the entire pipeline generation.

## 15. Retry and Cost Behavior

- No silent semantic retry is performed.
- No automatic signal recheck is performed.
- A transient provider error fails at the current stage with an actionable message.
- A user-initiated retry starts again from Stage 1 and therefore can make three additional calls.
- The setup screen states that one analysis uses three model requests.
- The connection test remains optional and consumes one separate provider request.

This policy avoids unexpected charges when users supply their own API keys.

## 16. Prompt Quality Improvements Relative to Cloud

The open-source prompts are rewritten from the Cloud requirements rather than copied as one accumulated string.

They will:

- remove multi-timeframe instructions and roles;
- remove external market-data precedence rules;
- remove Cloud-only risk-state and evidence-storage language;
- remove site-specific backend instructions;
- eliminate incomplete fragments such as `where bullish...` and `each impulse...`;
- avoid duplicate time, drawing, and signal requirements;
- keep extraction, signal detection, and reasoning responsibilities in separate files;
- attach an explicit version to every stage prompt;
- keep all instructions grammatically complete and testable.

## 17. Source Layout

The implementation should use bounded modules:

```text
src/analysis/
  visual-facts.ts
  visual-facts-schema.ts
  visual-extraction-prompt.ts
  signal-facts.ts
  signal-facts-schema.ts
  signal-extraction-prompt.ts
  evidence-bundle.ts
  evidence-reasoning-prompt.ts
  community-report-v3.ts
  community-report-v3-schema.ts
  analysis-pipeline.ts
  report-semantics.ts

src/providers/
  provider-types.ts
  structured-response.ts
  openai-provider.ts
  openrouter-provider.ts
  gemini-provider.ts

src/ui/state/
  use-analysis-controller.ts
```

Prompt builders contain no provider-specific logic. Providers contain no chart-analysis rules.

## 18. Testing Strategy

Implementation follows test-driven development.

### 18.1 Prompt tests

- prompts are provider-neutral and English-only;
- Stage 1 forbids recommendation and unsupported facts;
- Stage 2 enforces complete point-in-time signal sets;
- Stage 3 contains the evidence hierarchy and output-language directive;
- no prompt contains multi-timeframe, API, news, Cloud, billing, or broken sentence fragments;
- prompt-injected page labels remain untrusted data.

### 18.2 Schema and semantic tests

- valid Stage 1, Stage 2, and final reports parse;
- additional keys, empty strings, invalid IDs, duplicate IDs, and invalid ratios fail;
- unsupported external-source claims fail;
- language leakage fails final semantic validation;
- malformed signal sets are omitted or rejected according to the contract;
- price-axis calibration and signal-arrow positioning remain deterministic.

### 18.3 Provider tests

- every provider can issue image and text-only structured requests;
- schema names and strict schemas reach the provider correctly;
- response envelopes parse independently from domain schemas;
- abort, timeout, HTTP error, invalid JSON, and invalid schema responses map to safe error codes;
- secrets, images, prompts, and full responses do not enter diagnostics.

### 18.4 Pipeline tests

- successful analysis calls stages in order exactly once;
- Stage 3 never receives the screenshot;
- failure or cancellation prevents later stages;
- retry restarts from Stage 1;
- stale responses cannot overwrite a newer analysis;
- annotation rendering happens only after a valid final report.

### 18.5 UI tests

- visible module order aligns with the Cloud report;
- no `Current view` or `当前观点` heading remains;
- top conclusion renders LONG/SHORT/SIDEWAYS or 做多/做空/震荡;
- direction is not duplicated below the heading;
- all result images zoom and download;
- one signal produces one annotated image;
- copied report mirrors visible modules and language.

### 18.6 Release verification

- focused tests for each implementation stage;
- full extension test suite;
- TypeScript compile;
- Chrome MV3 production build;
- Edge MV3 production build;
- manual smoke test using at least English and Simplified Chinese outputs.

## 19. Acceptance Criteria

The work is complete when:

1. one screenshot analysis makes three ordered semantic model calls;
2. only Stage 1 and Stage 2 receive the screenshot;
3. all prompt instructions are English;
4. only Stage 3 controls final English or Simplified Chinese output;
5. no multi-timeframe or external market-data logic exists in the open-source pipeline;
6. the final report uses `community-3.0` and passes strict local validation;
7. the visible report follows the Cloud-aligned module order;
8. the top heading directly displays LONG, SHORT, or SIDEWAYS and its Chinese equivalent;
9. support/resistance, each signal, and each pattern have separate annotated images;
10. malformed output reports the precise safe failure stage without automatic extra model calls;
11. all automated tests, compile checks, and Chrome/Edge builds pass.
