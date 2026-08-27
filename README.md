# ChartViz Community

ChartViz Community 1.0.0 is a direct Chrome and Edge extension for educational analysis of a chart screenshot. It captures the visible TradingView tab or accepts one uploaded image, sends that image directly to the provider you select, and displays the validated report and separate annotations in the extension panel.

It has no ChartViz-operated server, login, account, analytics, analysis history, news, exchange/market-data feed, or multi-timeframe workflow. It is not financial advice.

## Build and install unpacked

Requirements: Node.js 24, pnpm 11.20.0, and Git.

From a clean checkout, run the canonical release verification. It installs from the frozen lockfile, tests, compiles, and builds Chrome before Edge:

```bash
bash scripts/verify-release.sh
```

Then install one generated directory without creating a release ZIP:

- Chrome: open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/.output/chrome-mv3`.
- Edge: open `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/.output/edge-mv3`.

Pin ChartViz if desired. Click its toolbar icon to open the floating panel on the current page.

## Provider setup

You supply and own the API key. In the setup panel:

1. Select a curated vision model, grouped by OpenAI, Anthropic, Google, or Qwen.
2. Keep **Use OpenRouter** enabled to use an OpenRouter key, or disable it for models that support a direct OpenAI or Gemini connection.
3. Paste a key issued by the selected service. ChartViz sends the key only to that service's fixed API endpoint; it does not proxy requests through a ChartViz server.
4. Optionally run **Test connection**. This makes exactly one real provider request and may incur provider cost or quota usage. Saving configuration makes no provider request.
5. Choose English or Simplified Chinese from the panel header and save.

Keys and provider settings are stored only in `browser.storage.session`. They are not written to local/sync storage, logs, reports, downloads, or the clipboard. Fully quit and restart the browser to clear the session key; the manual release checklist verifies this behavior in both browsers.

The curated catalog contains `openai/gpt-5.6-terra`, `openai/gpt-5.6-sol`, `openai/gpt-5.6-luna`, `google/gemini-3.7-flash`, Claude 5 and 4.5 variants, and Qwen 3.7/VL variants. Anthropic and Qwen models use OpenRouter; the listed OpenAI and Gemini models can also use their direct APIs. You may enter a custom OpenRouter model ID, but custom API origins are not supported. A custom model must support image input and strict structured output; an incompatible model can fail with `model_not_multimodal` or `invalid_response`.

## Analyze one image

- **TradingView capture:** open an HTTPS TradingView `/chart/` page, make the desired single timeframe visible, open ChartViz, and choose capture. The panel hides, captures the visible tab once, and restores itself. It does not change timeframe or read an exchange API.
- **Manual upload:** choose exactly one PNG, JPEG, or WebP file up to 10 MB. The extension decodes, scales the longest edge to at most 2048 px, and re-encodes the image before analysis.

Each Analyze action uses exactly one processed screenshot and one visible timeframe, then makes three sequential requests to the selected provider. The first two requests inspect the same screenshot from complementary chart-reading and trade-signal perspectives; the third receives the normalized evidence rather than the image and prepares the final report. A failed request stops the analysis and is never retried silently; choosing **Try again** starts a new three-request analysis.

All internal prompts are English. The selected output language is applied to the final evidence reasoning and report, so English/Chinese UI selection does not weaken the screenshot-extraction contract. ChartViz does not combine screenshots, fetch hidden chart data, add news, or retrieve market-data feeds. The original and generated annotation images can be zoomed and downloaded, every trade signal receives its own annotation image, and the report text can be copied.

## Privacy boundary

The screenshot is sent directly to the selected provider in the first two analysis requests. The third request contains normalized chart evidence, the requested report language, and the final reasoning prompt. The provider's own retention, billing, and privacy terms apply. ChartViz Community has no first-party backend, telemetry, or persistent report store. Avoid screenshots that contain account details, personal data, private indicators, or other sensitive information.

Manifest host access is limited to the three fixed provider origins required for direct calls: OpenRouter (`https://openrouter.ai`), OpenAI (`https://api.openai.com`), and Gemini (`https://generativelanguage.googleapis.com`). They are declared with the exact manifest patterns `https://openrouter.ai/api/*`, `https://api.openai.com/v1/*`, and `https://generativelanguage.googleapis.com/*`; browser host permissions grant origin-level access rather than enforcing API path scoping. There are no optional provider origins, custom API origins, or `<all_urls>` access.

See [SECURITY.md](SECURITY.md) for the precise threat and review boundary and [docs/manual-smoke-test.md](docs/manual-smoke-test.md) for the release checklist.

## Troubleshooting

- **Open a TradingView chart before capturing:** use an HTTPS `tradingview.com/chart/...` page and keep the target chart visible. Otherwise use manual upload.
- **Image must be PNG, JPEG, or WebP / no larger than 10 MB / invalid image:** choose one supported, decodable image within the limit. Images smaller than 320×180 cannot be annotated.
- **`invalid_api_key`:** confirm the key belongs to the selected provider and re-enter it after a browser restart.
- **`model_not_found`:** choose a current curated model or verify the custom model ID for that provider.
- **`model_not_multimodal`:** choose a model that accepts images and structured output.
- **`insufficient_balance` or `rate_limited`:** check the selected provider's billing, quota, and rate limits.
- **`network_timeout`:** check connectivity and provider availability, then start a new explicit request; ChartViz does not retry automatically.
- **`invalid_response` or `invalid_image`:** retry with a clear chart screenshot and a curated model. Provider output must match the Community report contract.
- **Panel or permissions changed after rebuilding:** remove the unpacked extension and load the correct generated browser directory again.

## Development

```bash
pnpm --dir extension install --frozen-lockfile
pnpm --dir extension test
pnpm --dir extension compile
pnpm --dir extension build
pnpm --dir extension build:edge
node --test tests/package-contents.test.mjs
node scripts/verify-package.mjs extension/.output/chrome-mv3 extension/.output/edge-mv3
```

Packaging and publishing are separate maintainer actions. Do not create release ZIPs, hashes, packages, GitHub releases, or deployments as part of ordinary verification.
