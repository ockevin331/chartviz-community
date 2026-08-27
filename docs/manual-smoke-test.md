# ChartViz Community 1.0.0 manual smoke test

Run this checklist only after `bash scripts/verify-release.sh` passes. Product release ZIPs are not part of this checklist and must not be created without separate explicit approval.

## Evidence safety

- Use dedicated low-value test accounts/keys and provider-approved test images.
- Enter real keys only into the extension setup field. Never paste them into a terminal, issue, screenshot, evidence row, prompt, or chat.
- Never record authorization headers, raw request/response bodies, secret-bearing prompts, or key prefixes/suffixes.
- Evidence may contain only `PASS`/`FAIL`/`PENDING`, browser/version, extension commit, sanitized public error codes, and a short secret-free note.
- Stop and sanitize immediately if a key or private chart/account detail appears anywhere outside the masked extension field.

## Preparation

- [ ] `PENDING` — From the repository root, run `bash scripts/verify-release.sh` without creating ZIPs.
- [ ] `PENDING` — Record the commit under test with `git rev-parse HEAD`; do not record keys or environment values.
- [ ] `PENDING` — Prepare one non-sensitive TradingView HTTPS `/chart/` page with a single visible timeframe.
- [ ] `PENDING` — Prepare one non-sensitive PNG, JPEG, or WebP chart image between 320×180 and 10 MB.
- [ ] `PENDING` — Prepare user-owned OpenRouter, OpenAI, and Gemini test keys. Keep them outside all evidence.

## Chrome unpacked install and flow

- [ ] `PENDING` — Record the Chrome version. Open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `extension/.output/chrome-mv3`.
- [ ] `PENDING` — Confirm the extension is named **ChartViz**, opens from its toolbar action, closes, and can be reopened.
- [ ] `PENDING` — On the prepared TradingView chart, choose capture. Confirm the panel hides, captures only the visible tab once, restores, and shows a one-image preview for the visible timeframe.
- [ ] `PENDING` — Choose another image and upload exactly one prepared PNG/JPEG/WebP file. Confirm its preview replaces the prior source.
- [ ] `PENDING` — Start an analysis and cancel during the initial chart-reading request. Confirm the localized cancelled state returns to the same preview without an automatic retry.
- [ ] `PENDING` — Repeat cancellation during the signal-review request and during final report preparation. Each cancellation must stop the active provider request and must not start another request.
- [ ] `PENDING` — Trigger one safe error using a deliberately invalid provider credential. Record only the sanitized public error code (expected `invalid_api_key` or another mapped code) and confirm retry requires a new explicit action.
- [ ] `PENDING` — Select a deliberately unsupported custom model ID, review the multimodal warning, and confirm a sanitized `model_not_multimodal`, `model_not_found`, or `invalid_response` result. Do not record the model response body.
- [ ] `PENDING` — Complete one three-request analysis with the curated default OpenRouter model. Confirm one report renders; record no prompt, response body, image, or credential.
- [ ] `PENDING` — Complete one three-request analysis with the curated default OpenAI model under the same evidence restrictions.
- [ ] `PENDING` — Complete one three-request analysis with the curated default Gemini model under the same evidence restrictions.
- [ ] `PENDING` — With English selected, confirm all final report prose is English while chart labels, symbols, and quoted indicator names remain faithful to the screenshot.
- [ ] `PENDING` — With Simplified Chinese selected, confirm all final report prose is Chinese while chart labels, symbols, and quoted indicator names remain faithful to the screenshot.
- [ ] `PENDING` — Use a chart that produces at least two trade signals. Confirm each signal is paired with one separate annotated image and no image combines multiple signal plans.
- [ ] `PENDING` — Open the original image and every generated annotation in the lightbox; close by button, backdrop, and Escape.
- [ ] `PENDING` — Download the original and at least one annotation and confirm each file opens locally. Do not attach them to evidence.
- [ ] `PENDING` — Copy the report and confirm the clipboard contains report text but no API key, authorization header, hidden prompt/schema, or raw provider body. Clear the clipboard afterward.
- [ ] `PENDING` — Fully quit every Chrome window, restart Chrome, reopen ChartViz, and confirm provider setup is shown with no restored key.

## Edge unpacked install and flow

- [ ] `PENDING` — Record the Edge version. Open `edge://extensions`, enable Developer mode, choose Load unpacked, and select `extension/.output/edge-mv3`.
- [ ] `PENDING` — Confirm the extension is named **ChartViz**, opens from its toolbar action, closes, and can be reopened.
- [ ] `PENDING` — Repeat TradingView visible-tab capture and one manual upload; confirm the same single-image preview behavior.
- [ ] `PENDING` — Repeat cancellation in each of the three request phases and the safe invalid-credential error; record only sanitized public error codes and confirm there is no automatic retry.
- [ ] `PENDING` — Complete one three-request analysis through OpenRouter, one through OpenAI, and one through Gemini.
- [ ] `PENDING` — Repeat English and Simplified Chinese final-output checks and the one-signal-per-image check.
- [ ] `PENDING` — Repeat custom unsupported-model handling and record only `model_not_multimodal`, `model_not_found`, or `invalid_response` if exposed.
- [ ] `PENDING` — Repeat lightbox zoom/close, original and annotation download, and report copy checks.
- [ ] `PENDING` — Fully quit every Edge window, restart Edge, reopen ChartViz, and confirm provider setup is shown with no restored key.

## Sanitized evidence table

Keep every result `PENDING` until a person performs the matching browser step. Duplicate rows if a step needs separate provider/browser evidence.

| Check | Result | Browser/version | Extension commit | Sanitized error code | Secret-free note |
|---|---|---|---|---|---|
| Chrome unpacked install/action | PENDING | PENDING | PENDING | N/A | PENDING |
| Chrome TradingView capture/upload | PENDING | PENDING | PENDING | N/A | PENDING |
| Chrome OpenRouter/OpenAI/Gemini | PENDING | PENDING | PENDING | N/A | PENDING |
| Chrome cancel/error/custom model | PENDING | PENDING | PENDING | PENDING | PENDING |
| Chrome zoom/download/copy | PENDING | PENDING | PENDING | N/A | PENDING |
| Chrome restart clears key | PENDING | PENDING | PENDING | N/A | PENDING |
| Edge unpacked install/action | PENDING | PENDING | PENDING | N/A | PENDING |
| Edge TradingView capture/upload | PENDING | PENDING | PENDING | N/A | PENDING |
| Edge OpenRouter/OpenAI/Gemini | PENDING | PENDING | PENDING | N/A | PENDING |
| Edge cancel/error/custom model | PENDING | PENDING | PENDING | PENDING | PENDING |
| Edge zoom/download/copy | PENDING | PENDING | PENDING | N/A | PENDING |
| Edge restart clears key | PENDING | PENDING | PENDING | N/A | PENDING |
