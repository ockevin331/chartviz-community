# Community Structured Output Reliability Design

## Goal

Make direct-model chart analysis resilient to provider-specific structured-output behavior while preserving strict ChartViz domain validation, complete failure diagnostics, and exactly three normal LLM calls.

## Confirmed Failure

The captured `anthropic/claude-opus-5` request completed with HTTP 200 and valid JSON, but the visual extraction result used a different object shape from `community_visual_facts`. The failure occurred at `visual_extraction_shape`; semantic validation was not reached. Qwen migration was not involved because it only applies to OpenRouter model IDs beginning with `qwen/`.

## Constraints

- Keep the current three-stage analysis pipeline.
- Do not add a fourth LLM call in this change.
- Do not weaken domain checks for price coordinates, timeframes, IDs, geometry, screenshot-only evidence, or risk semantics.
- Do not silently invent missing evidence during normalization.
- Do not store API keys, image Base64 data, or other secrets in diagnostics.
- Keep OpenAI and OpenRouter transport adapters independent.
- Keep model output language mismatch as a non-fatal warning.

## Architecture

### 1. OpenRouter routing diagnostics

Every OpenRouter request sends `X-OpenRouter-Metadata: enabled`. The response parser separates assistant content from safe routing metadata and preserves:

- generation ID and returned model;
- selected provider and routing summary;
- attempt/fallback count;
- pipeline stage names;
- finish reason and usage totals;
- schema name, schema version, and deterministic schema hash.

The data is attached to the existing failure snapshot when parsing, shape validation, or semantic validation fails. Unknown metadata fields are ignored.

### 2. Model-family native structured-output transport

OpenRouter requests use the endpoint and output contract native to the selected model family:

- Anthropic models use `POST /api/v1/messages` with `output_config.format.type = json_schema` and parse the single JSON text content block from the Anthropic response envelope.
- OpenAI models keep the OpenAI-compatible structured-output transport currently used by the OpenRouter adapter.

The Anthropic transport converts the application JSON Schema into the subset supported by Claude structured outputs before sending it. Unsupported generation constraints such as numeric and string length bounds are removed from the transport schema and copied into property descriptions. Every object keeps `additionalProperties: false`. The unmodified application schema is still applied locally after the response, so transport simplification cannot weaken domain validation.

Refusal and `max_tokens` stop reasons are handled as explicit provider failures rather than shape failures.

### 3. Wire contract and domain contract

The provider-facing visual extraction schema is an explicit Wire Schema. It contains only values the model must observe from the image. The existing `CommunityVisualFacts` schema remains the strict Domain Schema consumed by later stages.

The Wire Schema removes or simplifies deterministically derived values:

- chart identity uses trusted page context when available and screenshot values only as a fallback;
- price labels are formatted locally from numeric prices;
- quality summary is derived locally from `usable` and limitations;
- standard pattern display names are localized locally from `canonicalType`;
- no duplicate textual alias is required when a numeric or enum value is authoritative.

The converter is deterministic. Missing required evidence remains an error; it does not ask another model or create analytical claims.

### 4. Schema guidance

Every Wire Schema field has a concise JSON Schema description. The prompt includes a compact structural skeleton and exact coordinate conventions, but does not duplicate the full JSON Schema. Model-facing and domain schema versions are recorded independently.

### 5. No broad alternate-schema compatibility layer

The two captured Claude responses changed nearly every nested object, not only coordinate aliases. ChartViz will not maintain or silently accept that provider-invented schema. In particular it will not translate arbitrary structures such as:

- `overallStructure/trendDirection/swingBehavior` into domain price action;
- free-form indicator and level objects into strict evidence objects;
- provider-created pattern geometry into ChartViz geometry;
- compact price strings into numeric prices without an explicit, independently tested parser.

Correctness comes from using native constrained output plus a smaller, described Wire Schema. If a response still violates the Wire Schema, the analysis fails with the original output and routing metadata preserved. A future compatibility rule requires its own captured fixture, deterministic semantics, and explicit test before it can be added.

## Error Handling

Failures remain separated into transport, response envelope, refusal/truncation, JSON parsing, wire shape, and domain semantics. User-facing errors remain concise; copied diagnostics contain the detailed safe snapshot.

OpenRouter Response Healing is not enabled for this problem because it repairs JSON syntax, not schema adherence.

## Testing

- Contract tests reproduce both captured Claude alternate output shapes and prove they remain rejected instead of being silently reinterpreted.
- Anthropic transport tests prove `/api/v1/messages`, `output_config.format`, image blocks, routing metadata, refusal handling, and `max_tokens` handling.
- Schema transformation tests prove unsupported transport constraints are removed while the original local schema still rejects violations.
- Tests prove ambiguous or incomplete output still fails.
- OpenRouter transport tests verify the metadata header and safe metadata extraction.
- Diagnostics tests verify secrets and image data are excluded.
- Existing three-stage, UI, Chrome, and Edge build checks remain required.

## Acceptance Criteria

- Claude requests use native constrained JSON output rather than relying on Chat Completions schema translation.
- Both captured provider-invented output shapes remain visible in diagnostics and are never silently accepted.
- An output missing core price-action, volume, level, pattern, or segment evidence still fails.
- Diagnostics identify the actual OpenRouter route selected for successful HTTP responses.
- Normal analysis still performs exactly three model calls.
- Full TypeScript compilation, all tests, Chrome build, Edge build, and `git diff --check` pass.
