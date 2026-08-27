# ChartViz

ChartViz 1.0.0 is an open-source Chrome and Edge extension that helps people read candlestick charts. It detects a supported chart page, captures the visible chart, and presents evidence-based price-action analysis with separate annotated images. It is an educational chart-reading tool, not financial advice.

The extension contains two explicit analysis modes:

- **ChartViz Cloud** is the default tab for a new installation. The open-source 1.0.0 build states that the Cloud connection will be enabled in a later update; it has no token field and sends no screenshot to an unavailable endpoint.
- **Direct model** sends the captured chart from the browser to a user-selected OpenRouter, OpenAI, or Gemini model. Existing usable Direct configurations remain in Direct mode after an upgrade.

There is no bundled backend, account/login flow, analytics, report history, news search, exchange-data API, billing flow, or local-model runtime.

## Build and install unpacked

Requirements: Node.js 24, pnpm 11.20.0, and Git.

From a clean checkout, run the canonical release verification:

```bash
bash scripts/verify-release.sh
```

Then load one generated browser directory:

- Chrome: open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/.output/chrome-mv3`.
- Edge: open `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/.output/edge-mv3`.

Pin ChartViz if desired. Click its toolbar icon to open the full-height floating panel on the current page.

## Analysis modes

### ChartViz Cloud

The Cloud tab explains the future managed analysis path and owns the multi-timeframe product capability. In this release it is intentionally unavailable: there is no connect button, credential input, production transport, or screenshot submission. The runtime boundary is injectable in tests so the extension can prove the capture contract before the private service is implemented.

When a capable Cloud runtime is injected, multi-timeframe capture uses three ordered roles: Context `4h`, Setup `1h`, and Trigger `15m`. The chart may briefly flicker while ChartViz switches timeframes. A failed switch stops the sequence, attempts to restore the original timeframe, and submits no partial result. Sites can explicitly disable this capability; 10jqka does.

### Direct model

Direct mode is single-timeframe only. Select a curated vision model grouped by OpenAI, Anthropic, Google, or Qwen; optionally use OpenRouter; then enter a key issued by that service. Saving configuration makes no provider request. **Test connection** makes exactly one real request and may consume provider quota.

Each Direct analysis makes three sequential requests. The first two inspect the same screenshot from complementary chart-reading and trade-signal perspectives; the third receives normalized evidence instead of the image and prepares the validated report. A failed request stops immediately and is never retried silently. Direct mode rejects multiple captures before contacting a provider.

Keys and Direct settings are stored only in `browser.storage.session`. They are not written to local/sync storage, logs, reports, downloads, copied diagnostics, or page scripts. Fully quitting and restarting the browser clears the session key.

The curated catalog includes `openai/gpt-5.6-terra`, `openai/gpt-5.6-sol`, `openai/gpt-5.6-luna`, `google/gemini-3.7-flash`, Claude 5/4.5 variants, and Qwen 3.7/VL variants. Custom OpenRouter model IDs are allowed, but custom API origins are not. A custom model must support image input and strict structured output.

## Capture and page guidance

Open a supported chart page, keep the chart visible, open ChartViz, and choose **Capture and analyze**. The panel hides only while the visible tab is captured and then restores. The extension does not read an exchange API.

Supported chart sites are TradingView, Binance, OKX, Bybit, Hyperliquid, Coinbase, Bitget, Gate, KuCoin, MEXC, HTX, Upbit, 10jqka, and VergeX.

- A supported chart URL shows the detected instrument, exchange, and timeframe plus single/multi capture cards.
- A supported domain with an unsupported URL explains that the current page is not a chart page and links to one BTC chart example for that site.
- An unsupported domain links to [ChartViz](https://www.chartviz.xyz/) for website screenshot analysis and shows green links to supported sites. It does not place a file picker in the extension.
- On `chartviz.xyz`, the same link tells the user to use the screenshot upload area on the current page.

The original screenshot and generated annotation images can be zoomed and downloaded. Support/resistance, patterns, and each trade signal use separate annotations so multiple plans are not combined into one crowded signal image.

## Privacy and permissions

In Direct mode, the screenshot is sent to the selected provider in the first two requests. The third request contains normalized chart evidence, requested output language, and the final reasoning prompt. The provider's retention, billing, and privacy terms apply. Avoid charts containing account details, personal data, or private indicators.

Manifest permissions are limited to `activeTab`, `storage`, and `scripting`; supported chart hosts; and the three fixed Direct provider origins. There is no `<all_urls>`, optional host access, remote executable code, or custom API origin. See [SECURITY.md](SECURITY.md) for the exact boundary and [docs/manual-smoke-test.md](docs/manual-smoke-test.md) for the release checklist.

## Troubleshooting

- **This page is not a supported chart page:** follow the displayed same-site BTC example, then reopen ChartViz.
- **Unable to detect the active chart:** wait until the chart and timeframe controls finish loading, then refresh chart detection.
- **Timeframe switch failed:** keep the chart tab visible and let the site finish loading before retrying.
- **`invalid_api_key`:** confirm the key belongs to the selected Direct provider and re-enter it after a browser restart.
- **`model_not_found` / `model_not_multimodal`:** choose a current vision-capable model or verify the custom OpenRouter model ID.
- **`insufficient_balance` / `rate_limited`:** check the provider account's billing, quota, and limits.
- **`network_timeout`:** check connectivity and provider availability, then start a new explicit analysis.
- **`invalid_response`:** retry with a clear chart and a curated model; the result must match the Community report contract.

## Development

```bash
pnpm --dir extension install --frozen-lockfile
pnpm --dir extension test
pnpm --dir extension compile
pnpm --dir extension build
pnpm --dir extension build:edge
node --test tests/package-contents.test.mjs tests/release-docs.test.mjs
node scripts/verify-package.mjs extension/.output/chrome-mv3 extension/.output/edge-mv3
```

Packaging, signing, publishing, deployment, and GitHub releases are separate maintainer actions.
