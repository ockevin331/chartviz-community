# Community Model Setup and Capture Reintegration

**Date:** 2026-08-26
**Status:** Approved for implementation planning

## 1. Objective

Make the open-source ChartViz extension understandable on first use and restore the proven v1.0.0 chart-detection and screenshot flow without restoring Cloud-only product features.

The work has two independently reviewable parts:

1. Replace the provider-first setup screen with a model-first setup experience.
2. Reintegrate the v1.0.0 supported-site detection, chart-context collection, and chart-cropping flow.

## 2. Scope

### In scope

- A first-run explanation of what the user must configure and where screenshots are sent.
- A model selector grouped by OpenAI, Anthropic, Google, and Qwen.
- Short model labels such as Recommended, Strongest, Fast, and Cost-effective.
- An OpenRouter checkbox, enabled by default.
- Direct official API access for supported OpenAI and Google models when OpenRouter is disabled.
- Custom OpenRouter model IDs with a clear text warning that the model must accept image input.
- The v1.0.0 site adapters, chart readiness checks, chart context, screenshot capture, and crop behavior.
- Displaying the detected instrument, exchange or venue, and timeframe before capture.
- Single-timeframe capture and direct analysis from a supported chart page.
- Exact supported-site host permissions.
- Chrome and Edge builds and tests.

### Out of scope

- File upload inside the extension.
- Multi-timeframe capture or analysis.
- Cloud login, Cloud tokens, subscriptions, quotas, analysis history, or news.
- Binance or other exchange OHLCV APIs.
- Local models.
- Drawing annotations back onto the website.
- Broad `<all_urls>` permission.

## 3. First-run model setup

### 3.1 User experience

The setup screen begins with a short explanation:

- Select a vision-capable model.
- Enter an API key for OpenRouter or the selected model provider.
- ChartViz sends the captured chart directly to that API and stores the key only in extension session storage.

The form order is:

1. Model selector.
2. OpenRouter checkbox.
3. API key field.
4. Privacy and storage note.
5. Test and save action.

There is no separate Provider field and no “I confirm this model supports image input” checkbox.

### 3.2 Model selector

The model selector is a custom, non-native control. Models are grouped visually by vendor:

| Vendor | Model | User-facing guidance |
| --- | --- | --- |
| OpenAI | `openai/gpt-5.6-terra` | Recommended · balanced |
| OpenAI | `openai/gpt-5.6-sol` | Strongest quality |
| OpenAI | `openai/gpt-5.6-luna` | Fast · cost-effective |
| Google | `google/gemini-3.7-flash` | Fast · strong image understanding |
| Anthropic | `anthropic/claude-sonnet-5` | Balanced alternative |
| Anthropic | `anthropic/claude-opus-5` | Strongest Anthropic model |
| Anthropic | `anthropic/claude-haiku-4.5` | Fast |
| Qwen | `qwen/qwen3.7-plus` | Strong Chinese understanding · balanced |
| Qwen | `qwen/qwen3-vl-235b-a22b-instruct` | Strongest Qwen vision model |
| Qwen | `qwen/qwen3-vl-8b-instruct` | Fast · cost-effective |

The catalog stores UI metadata separately from the transport configuration:

- vendor and group label;
- OpenRouter model ID;
- optional direct provider and direct model ID;
- localized description and badges;
- recommended/default status.

### 3.3 OpenRouter and direct-provider behavior

OpenRouter is enabled by default.

- When enabled, the saved provider is `openrouter` and the selected OpenRouter model ID is used.
- When disabled for an OpenAI model, the saved provider is `openai` and its direct OpenAI model ID is used.
- When disabled for a Google model, the saved provider is `gemini` and its direct Google model ID is used.
- Anthropic and Qwen choices require OpenRouter in this version. Selecting either keeps OpenRouter enabled and shows a short inline explanation.
- A custom model also requires OpenRouter. The UI shows a warning that custom models must support image input, but does not require a confirmation checkbox.

The existing normalized provider configuration can remain the persistence format. The UI derives it from the selected model plus the OpenRouter checkbox, preventing transport details from becoming the primary user decision.

## 4. Supported-chart capture

### 4.1 Root cause being removed

The current Community implementation determines the page from `document.referrer`. In a cross-origin extension iframe, the site referrer policy may reduce this to an origin and remove `/chart/`. A valid TradingView chart then fails with “Open a TradingView chart before capturing.”

The replacement must not depend on `document.referrer`.

### 4.2 Reused v1.0.0 architecture

The implementation ports the proven v1.0.0 flow with minimal adaptation:

1. A content script runs only on exact supported-site URL patterns.
2. The relevant v1 site adapter detects whether the URL is a supported chart page.
3. The adapter waits for the chart to be ready and stable.
4. It collects a small chart context: site, URL support state, instrument, exchange or venue, timeframe, and chart bounds.
5. The panel displays the detected context before capture.
6. After an explicit Capture and analyze click, the content script hides the floating panel.
7. The background captures the visible tab.
8. The image is cropped to the chart bounds using the v1 crop utilities.
9. The panel is restored even if capture fails.
10. The cropped image and chart context are passed directly to the Community analysis controller.

The chart collectors and readiness checks are reused from the v1.0.0 tag rather than reimplemented. Only Cloud-specific types and behavior are removed or replaced with minimal Community equivalents.

### 4.3 Panel behavior

On a supported chart URL, the panel shows:

- instrument;
- exchange or venue when available;
- timeframe;
- refresh detection action;
- Capture and analyze action.

There is no upload option. Successful capture immediately starts the single-timeframe analysis.

The prompt receives the collected chart context instead of `null`, reducing ambiguity in screenshot interpretation.

### 4.4 Errors and loading states

- Supported site and valid chart URL still loading: show a neutral “Waiting for chart…” state and retry detection.
- Supported site but unsupported URL: use the v1-style explanation and link to an example supported chart URL for that site.
- Unsupported site: explain that the extension works only on supported chart pages and list supported sites.
- Detection failure after readiness retries: keep the panel usable and expose a Refresh action.
- Capture failure: always restore the panel and show a specific, readable error.
- The extension does not offer file upload as a fallback.

## 5. Permissions and privacy

- Restore only the exact supported-site content-script matches and host permissions used by the v1 adapters.
- Keep the API provider origins required by the selected model transports.
- Keep `activeTab` for user-initiated visible-tab capture.
- Do not request optional `<all_urls>`, Cloud API hosts, identity, or unrelated permissions.
- Capture occurs only after the user clicks Capture and analyze.
- Content scripts read only the chart-page DOM state required for URL support, chart context, readiness, and crop bounds.
- Screenshots are not persisted by the extension and no analysis history is created.
- API keys remain in extension session storage under the current Community security model.

## 6. Implementation boundaries

The reintegration may copy or adapt these v1.0.0 responsibilities:

- site registry and individual site collectors;
- chart-context collection and readiness helpers;
- content-script message bridge;
- screenshot crop utilities;
- background capture message handler;
- supported-site manifest matches and host permissions;
- focused unit tests for URL support, context collection, capture orchestration, and panel restoration.

It must not copy Cloud analysis orchestration, authentication, subscriptions, history, news, multi-timeframe workflows, or backend requests.

## 7. Delivery and review stages

### Stage A — Model-first setup

- Add model metadata and direct/OpenRouter mapping.
- Replace Provider and Model controls with one grouped model selector.
- Add the first-run explanation and OpenRouter checkbox.
- Remove the multimodal confirmation checkbox.
- Update English and Chinese copy and focused tests.
- Build and present for review before starting Stage B.

### Stage B — v1 capture reintegration

- Port the v1 site adapters and minimal chart-context contract.
- Restore content-script context and readiness messaging.
- Restore background visible-tab capture and chart cropping.
- Remove upload UI and the referrer-based capture path.
- Adapt v1 tests and add regression coverage for the exact TradingView URL.
- Manually smoke-test the supplied TradingView URL in Chrome.
- Verify Chrome and Edge builds.

## 8. Acceptance criteria

- A first-time user understands why a model and API key are required before entering them.
- The main choice is a grouped model list; Provider is not shown.
- OpenRouter is a checkbox and defaults to enabled.
- No multimodal acknowledgement checkbox is present.
- The exact TradingView URL supplied by the user is recognized without relying on referrer data.
- Instrument and timeframe are visible before capture.
- Clicking Capture and analyze captures only the chart area and starts analysis.
- No upload option appears in the extension.
- The extension requests only exact supported-site and selected-provider permissions.
- All focused tests, the full test suite, Chrome build, Edge build, package verification, and manual TradingView smoke test pass before completion is claimed.
