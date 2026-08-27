# ChartViz 1.0.0 manual smoke test

Run this checklist after `bash scripts/verify-release.sh` passes. Stage 6 page checks require no provider key, paid request, or working Cloud API. Keep evidence limited to `PASS`, `FAIL`, or `PENDING`, browser/version, extension commit, and a short secret-free note.

## Test URLs

- Supported chart: `https://www.tradingview.com/chart/?symbol=BITSTAMP%3ABTCUSD`
- Supported domain, unsupported URL: `https://www.tradingview.com/symbols/BTCUSD/`
- Unsupported domain: `https://gmgn.ai/`
- ChartViz domain: `https://www.chartviz.xyz/`

## Chrome release smoke

- [ ] `PENDING` — Open `chrome://extensions`, enable Developer mode, load `extension/.output/chrome-mv3`, and record the Chrome version and tested commit.
- [ ] `PENDING` — Confirm the extension is named **ChartViz**, the icon opens a full-height floating panel, Close hides it, and the toolbar icon reopens it.
- [ ] `PENDING` — With no saved mode/configuration, confirm **ChartViz Cloud** opens first, says Cloud will be enabled later, has no token/connect field, and links to ChartViz.
- [ ] `PENDING` — Open **Direct model** and confirm the curated model selector, OpenRouter option, masked API-key field, language selector, test action, and save action are present.
- [ ] `PENDING` — On the supported TradingView `/chart/` URL, confirm detected instrument/exchange/timeframe and the single/multi screenshot cards appear.
- [ ] `PENDING` — In Direct mode, select multi-timeframe and confirm it does not capture; it explains that multi-timeframe analysis requires ChartViz Cloud.
- [ ] `PENDING` — On the TradingView `/symbols/` URL, confirm the primary alert says the page is not a supported chart page and exactly one clickable TradingView BTC chart example is shown.
- [ ] `PENDING` — On `gmgn.ai`, confirm the neutral unsupported-site guidance includes a prominent ChartViz website link plus green supported-site links, with no in-panel file picker.
- [ ] `PENDING` — On `chartviz.xyz`, confirm the link copy tells the user to use the screenshot upload area on the current page.
- [ ] `PENDING` — Confirm the browser console contains no Cloud network request, provider credential, screenshot payload, or uncaught panel error during these checks.

## Edge release smoke

- [ ] `PENDING` — Open `edge://extensions`, enable Developer mode, load `extension/.output/edge-mv3`, and record the Edge version and tested commit.
- [ ] `PENDING` — Repeat the open/close, Cloud-default, Direct-settings, supported TradingView `/chart/`, TradingView `/symbols/`, `gmgn.ai`, and `chartviz.xyz` checks.
- [ ] `PENDING` — Confirm the Edge behavior and generated manifest match Chrome and no Cloud/provider request occurs during page-guidance checks.

## Optional provider smoke before publishing

Use only a maintainer-owned low-value test key. Enter it only in the masked extension field and never record the key, authorization header, prompt, raw response, or chart image.

- [ ] `PENDING` — Complete one English and one Simplified Chinese Direct analysis with a curated model; confirm exactly three visible progress phases and one validated report.
- [ ] `PENDING` — Cancel once during each Direct phase; confirm no silent retry and no later phase starts.
- [ ] `PENDING` — Use an invalid test credential and confirm only a sanitized public error is shown.
- [ ] `PENDING` — Confirm original and annotation images open in the lightbox, downloads open locally, report copy contains no secret/internal prompt, and each signal has a separate annotation image.
- [ ] `PENDING` — Fully quit and restart the browser; confirm the Direct provider key is no longer present.

## Sanitized evidence

| Check | Result | Browser/version | Extension commit | Secret-free note |
|---|---|---|---|---|
| Chrome install/open/close | PENDING | PENDING | PENDING | PENDING |
| Chrome Cloud/Direct settings | PENDING | PENDING | PENDING | PENDING |
| Chrome supported chart | PENDING | PENDING | PENDING | PENDING |
| Chrome supported-domain unsupported URL | PENDING | PENDING | PENDING | PENDING |
| Chrome unsupported domain / ChartViz domain | PENDING | PENDING | PENDING | PENDING |
| Edge parity | PENDING | PENDING | PENDING | PENDING |
| Optional provider flow | PENDING | PENDING | PENDING | PENDING |
