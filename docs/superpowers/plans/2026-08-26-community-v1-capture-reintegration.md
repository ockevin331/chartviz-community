# Community v1 Capture Reintegration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the proven v1.0.0 supported-site chart detection, context collection, visible-tab screenshot, and chart crop flow while keeping the Community extension single-timeframe and backend-free.

**Architecture:** A content script owns page-specific detection and panel visibility. The extension panel asks the background for the active chart; the background asks the content script for a stable `ChartContext`, hides the panel, captures the visible tab, crops to chart bounds, restores the panel, and returns the chart image plus context. The panel processes that image locally and immediately starts the existing direct-to-model analysis.

**Tech Stack:** WXT 0.21, Chrome/Edge Manifest V3, React 19, TypeScript 7, Zod 4, Vitest 4, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-26-community-model-capture-reintegration-design.md`

## Global Constraints

- Reuse the v1.0.0 site collectors and readiness behavior; do not redesign site detection.
- Do not use `document.referrer` to identify the chart page.
- Capture only after an explicit user click.
- Hide the panel before capture and restore it in `finally`.
- Keep exactly one screenshot and one timeframe per analysis.
- Remove extension file upload and its fallback path.
- Do not add Cloud login, tokens, subscriptions, history, news, exchange OHLCV APIs, local models, or multi-timeframe switching.
- Do not request `<all_urls>` or optional capture permissions.
- Keep API keys in extension session storage and keep provider requests inside the extension panel.
- Preserve current Stage 8 working-tree files and do not create ZIPs, publish, deploy, or push.

---

### Task 1: Port the v1 chart context contract and site collectors

**Files:**
- Create: `extension/src/domain/chart-context.ts`
- Create: `extension/src/sites/collect-context.ts`
- Create: `extension/src/sites/tradingview/collect-context.ts`
- Create: `extension/src/sites/binance/collect-context.ts`
- Create: `extension/src/sites/okx/collect-context.ts`
- Create: `extension/src/sites/bybit/collect-context.ts`
- Create: `extension/src/sites/exchanges/collect-context.ts`
- Create: `extension/src/sites/upbit/collect-context.ts`
- Create: `extension/src/sites/upbit/timeframe.ts`
- Create: `extension/src/sites/upbit/frame-timeframe.ts`
- Create: `extension/src/sites/10jqka/collect-context.ts`
- Create: `extension/src/sites/vergex/collect-context.ts`
- Create: `extension/tests/tradingview-site.test.ts`
- Create: `extension/tests/binance-site.test.ts`
- Create: `extension/tests/okx-bybit-site.test.ts`
- Create: `extension/tests/additional-exchanges.test.ts`
- Create: `extension/tests/upbit-site.test.ts`
- Create: `extension/tests/10jqka-site.test.ts`
- Create: `extension/tests/vergex-site.test.ts`

**Interfaces:**
- Produces: `ChartContext`, `chartContextSchema`, `isSupportedChartUrl(value)`, `collectActiveChartContext()`, and `waitForActiveChartReady(timeoutMs?)`.
- `ChartContext` contains `site`, `pageType`, `url`, optional `symbol`, `exchange`, `timeframe`, chart bounds, and viewport dimensions.

- [ ] **Step 1: Port the v1 tests and point them at Community paths**

Copy the listed tests from tag `v1.0.0`, changing source imports from `../src/...` to the Community `extension/src/...` paths only when required. Keep the exact URL parsers, timeframe normalization cases, live-DOM symbol precedence, chart bounds, and retry expectations.

- [ ] **Step 2: Run the site tests and verify failure**

Run:

```bash
pnpm exec vitest run tests/tradingview-site.test.ts tests/binance-site.test.ts tests/okx-bybit-site.test.ts tests/additional-exchanges.test.ts tests/upbit-site.test.ts tests/10jqka-site.test.ts tests/vergex-site.test.ts
```

Expected: FAIL because the site modules and context contract do not exist.

- [ ] **Step 3: Add the minimal Community chart context schema**

Implement:

```ts
export const chartContextSchema = z.object({
  site: z.enum(['tradingview', 'binance', 'okx', 'bybit', 'hyperliquid', 'coinbase', 'bitget', 'gate', 'kucoin', 'mexc', 'crypto-com', 'htx', 'upbit', '10jqka', 'vergex']),
  pageType: z.enum(['advanced-chart', 'spot-trade', 'futures-trade', 'stock-trade', 'web3-token']),
  url: z.string().url(),
  symbol: z.string().optional(),
  exchange: z.string().optional(),
  timeframe: z.string().optional(),
  currentOhlcText: z.string().optional(),
  specializedEvidence: z.array(z.enum(['cost-distribution', 'liquidation-distribution'])).optional(),
  chart: z.object({
    id: z.string(),
    ariaLabel: z.string().optional(),
    bounds: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }),
  }),
  viewport: z.object({ width: z.number().positive(), height: z.number().positive(), devicePixelRatio: z.number().positive() }),
});
export type ChartContext = z.infer<typeof chartContextSchema>;
```

- [ ] **Step 4: Port the v1 collectors with one import-only adaptation**

Copy the listed collector files from tag `v1.0.0` and replace imports of `../../domain/analysis` with `../../domain/chart-context`. Do not alter selectors, URL parsers, normalization tables, retry timing, or symbol/timeframe precedence.

`collectActiveChartContext()` must reject an unsupported URL before choosing a collector; it must not fall through to TradingView on an unrelated page.

- [ ] **Step 5: Run the site tests and verify pass**

Run the command from Step 2.

Expected: all ported site tests PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add extension/src/domain/chart-context.ts extension/src/sites extension/tests/*site.test.ts extension/tests/additional-exchanges.test.ts
git commit -m "feat(community): restore v1 chart collectors"
```

### Task 2: Add the content-script bridge and background crop orchestration

**Files:**
- Create: `extension/src/domain/chart-messages.ts`
- Create: `extension/src/platform/capture/crop.ts`
- Create: `extension/entrypoints/content.ts`
- Modify: `extension/entrypoints/background.ts`
- Modify: `extension/src/capture/mount-floating-panel.ts`
- Create: `extension/tests/crop.test.ts`
- Create: `extension/tests/content-bridge.test.ts`
- Modify: `extension/tests/capture-secret-boundary.test.ts`

**Interfaces:**
- Produces messages: `chartviz/context/get`, `chartviz/chart/ready`, `chartviz/panel/toggle`, `chartviz/panel/visibility`, `chartviz/active-chart/inspect`, and `chartviz/active-chart/capture`.
- Produces response: `{ ok: true, context, previewDataUrl } | { ok: false, error }`.
- Background dependencies remain injectable for unit tests: active-tab lookup, tab messaging, visible-tab capture, crop, data-URL conversion, and content-script injection.

- [ ] **Step 1: Write failing crop and orchestration tests**

Port `tests/crop.test.ts` from v1.0.0. Replace the old sender/referrer capture tests with assertions that:

```ts
expect(events).toEqual([
  'active-tab', 'ready:42', 'hide:42', 'capture:17', 'crop', 'restore:42', 'data-url',
]);
```

Test successful capture, readiness failure without screenshot, crop failure with panel restoration, unknown message returning `undefined`, action-click toggle, and action-click content-script injection fallback.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm exec vitest run tests/crop.test.ts tests/content-bridge.test.ts tests/capture-secret-boundary.test.ts
```

Expected: FAIL against the referrer-based background.

- [ ] **Step 3: Add minimal message types and v1 crop utilities**

Define only the six Community messages listed in Interfaces. Port `bitmapCropRect`, `cropScreenshot`, and `blobToDataUrl` from v1.0.0 without Cloud types.

- [ ] **Step 4: Implement the content script**

Use the exact v1 supported-site match list. On startup, keep the panel hidden until toggled. Handle:

```ts
if (message.type === 'chartviz/context/get') return collectActiveChartContext();
if (message.type === 'chartviz/chart/ready') return waitForActiveChartReady();
if (message.type === 'chartviz/panel/toggle') return setPanelVisible(!isPanelVisible());
if (message.type === 'chartviz/panel/visibility') return setPanelVisible(message.visible, false);
```

Poll `location.href` every 500 ms and notify the iframe of SPA context changes. Keep the current extension-origin iframe panel and current close/drag behavior.

- [ ] **Step 5: Replace background capture orchestration**

For `chartviz/active-chart/capture`:

1. query active tab;
2. request `chartviz/chart/ready` from that tab;
3. hide panel through content script;
4. wait 80 ms;
5. call `captureVisibleTab(tab.windowId, { format: 'png' })`;
6. crop with the returned context;
7. restore the panel in `finally`;
8. return the cropped PNG data URL and context.

Action click first sends `chartviz/panel/toggle`; if there is no receiver, inject `/content-scripts/content.js` and retry once.

- [ ] **Step 6: Run focused tests and verify pass**

Run the command from Step 2.

Expected: all focused tests PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add extension/src/domain/chart-messages.ts extension/src/platform/capture/crop.ts extension/entrypoints/content.ts extension/entrypoints/background.ts extension/src/capture/mount-floating-panel.ts extension/tests/crop.test.ts extension/tests/content-bridge.test.ts extension/tests/capture-secret-boundary.test.ts
git commit -m "feat(community): restore v1 capture bridge"
```

### Task 3: Replace upload/referrer UI with detected-chart capture

**Files:**
- Create: `extension/src/capture/active-chart.ts`
- Create: `extension/src/ui/components/ChartCaptureSource.tsx`
- Create: `extension/tests/active-chart-capture.test.ts`
- Create: `extension/tests/chart-capture-source.test.tsx`
- Modify: `extension/entrypoints/panel/App.tsx`
- Modify: `extension/entrypoints/panel/style.css`
- Modify: `extension/src/i18n/en.ts`
- Modify: `extension/src/i18n/zh-CN.ts`
- Modify: `extension/tests/panel-workflow.test.tsx`
- Delete: `extension/src/capture/manual-upload.ts`
- Delete: `extension/src/capture/panel-visibility.ts`
- Delete: `extension/src/capture/tradingview-capture.ts`
- Delete: `extension/src/ui/components/ImageSourcePicker.tsx`
- Delete: `extension/tests/manual-upload.test.ts`
- Delete: `extension/tests/panel-visibility.test.ts`
- Delete: `extension/tests/tradingview-capture.test.ts`

**Interfaces:**
- Produces `CapturedChart = { image: ProcessedImage; context: ChartContext }`.
- `ChartCaptureSource` consumes `inspect()` and `capture(signal)` and calls `onCaptured(CapturedChart)`.
- `App` immediately calls `controller.selectImage(image)` and `controller.analyze({ instrument: context.symbol ?? null, timeframe: context.timeframe ?? null }, language)` after capture.

- [ ] **Step 1: Write failing active-capture and source UI tests**

Test that the client:

- sends only `chartviz/active-chart/inspect` and `chartviz/active-chart/capture` messages;
- converts the returned cropped data URL to a Blob and runs `processImage`;
- preserves `ChartContext`;
- rejects an aborted signal and bounded background errors.

Test that the source UI displays instrument, exchange, and timeframe, contains no file input or upload button, shows a waiting state, exposes Refresh, and labels the action “Capture and analyze”.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm exec vitest run tests/active-chart-capture.test.ts tests/chart-capture-source.test.tsx tests/panel-workflow.test.tsx
```

Expected: FAIL because the new client and UI do not exist.

- [ ] **Step 3: Implement the active-chart client and source component**

The client validates the background response shape and uses the existing `processImage` function. The source component inspects on mount and on Refresh, shows detected metadata, and starts capture only from the button click.

For unsupported or invalid URLs, display a neutral alert, an example supported-chart link when available, and the supported-site list. Do not offer upload.

- [ ] **Step 4: Wire context through App and start analysis immediately**

Remove `readUpload`, `document.referrer`, `createPanelVisibility`, and `ImageSourcePicker`. After a successful capture, store the context, select the image, and immediately analyze using symbol and timeframe. The analyzing view continues to show the captured chart and scanning animation.

Header Refresh increments a context revision so the source component reinspects even when the controller remains in `source` state. Listen for `chartviz-page/context-changed` from the content script and trigger the same refresh.

- [ ] **Step 5: Remove upload/referrer modules and tests**

Delete only the files listed under Delete. Confirm:

```bash
rg -n "document\.referrer|readManualUpload|ImageSourcePicker|captureTradingView|type=\"file\"" extension
```

Expected: no matches in product code.

- [ ] **Step 6: Run focused tests and compile**

Run:

```bash
pnpm exec vitest run tests/active-chart-capture.test.ts tests/chart-capture-source.test.tsx tests/panel-workflow.test.tsx
pnpm compile
```

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 7: Commit Task 3**

```bash
git add -- extension/entrypoints/panel/App.tsx extension/entrypoints/panel/style.css extension/src/capture/active-chart.ts extension/src/ui/components/ChartCaptureSource.tsx extension/src/i18n/en.ts extension/src/i18n/zh-CN.ts extension/tests/active-chart-capture.test.ts extension/tests/chart-capture-source.test.tsx extension/tests/panel-workflow.test.tsx
git add -u -- extension/src/capture/manual-upload.ts extension/src/capture/panel-visibility.ts extension/src/capture/tradingview-capture.ts extension/src/ui/components/ImageSourcePicker.tsx extension/tests/manual-upload.test.ts extension/tests/panel-visibility.test.ts extension/tests/tradingview-capture.test.ts
git commit -m "feat(community): analyze detected chart capture"
```

### Task 4: Restore exact supported-site permissions and packaging checks

**Files:**
- Modify: `extension/wxt.config.ts`
- Modify: `extension/tests/manifest.test.ts`
- Modify: `tests/built-manifest.test.mjs`
- Modify: `extension/tests/capture-secret-boundary.test.ts`

**Interfaces:**
- Exports `supportedChartMatches` and `supportedChartHosts` from `wxt.config.ts` for tests.
- Manifest keeps provider origins plus exact chart hosts and has no `<all_urls>` or optional host permissions.

- [ ] **Step 1: Write failing manifest expectations**

Assert all v1 sites are represented: TradingView, Binance, OKX, Bybit, Hyperliquid, Coinbase, Bitget, Gate, KuCoin, MEXC, HTX, Upbit, 10jqka, and VergeX. Assert built `content_scripts[0].matches` equals the exact content-script match list and `optional_host_permissions` is absent.

- [ ] **Step 2: Run manifest tests and verify failure**

Run: `pnpm exec vitest run tests/manifest.test.ts`

Expected: FAIL because chart hosts and content script are absent from the current manifest.

- [ ] **Step 3: Add exact chart hosts**

Keep permissions exactly:

```ts
['activeTab', 'storage', 'scripting']
```

Set `host_permissions` to provider origins plus the exact v1 chart hosts. Do not add Cloud hosts, `identity`, `<all_urls>`, or optional permissions.

- [ ] **Step 4: Build and validate generated manifests**

Run:

```bash
pnpm build
pnpm build:edge
node --test ../tests/built-manifest.test.mjs
```

Expected: Chrome and Edge manifests contain the content script and exact permission boundary.

- [ ] **Step 5: Commit Task 4**

```bash
git add extension/wxt.config.ts extension/tests/manifest.test.ts extension/tests/capture-secret-boundary.test.ts tests/built-manifest.test.mjs
git commit -m "chore(community): scope supported chart permissions"
```

### Task 5: Complete Stage B verification and TradingView smoke test

**Files:**
- Modify only if verification exposes a Stage B regression.

**Interfaces:**
- Verifies the supplied URL: `https://www.tradingview.com/chart/3c8vMvO3/?symbol=BITSTAMP%3ABTCUSD`.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
pnpm test
pnpm compile
pnpm build
pnpm build:edge
node --test ../tests/built-manifest.test.mjs ../tests/package-contents.test.mjs
```

Expected: every command exits 0.

- [ ] **Step 2: Run static boundary checks**

Run:

```bash
rg -n "document\.referrer|readManualUpload|captureTradingView|<all_urls>|chartviz\.xyz" extension/src extension/entrypoints extension/wxt.config.ts
git diff --check
```

Expected: no referrer, upload, broad permission, or Cloud endpoint in product code; no whitespace errors.

- [ ] **Step 3: Smoke-test the exact TradingView URL in Chrome**

Load `.output/chrome-mv3`, open the supplied URL, click the extension, and verify:

1. panel opens;
2. instrument shows `BTCUSD` and exchange shows `BITSTAMP` when readable;
3. timeframe is detected from the visible toolbar;
4. Capture and analyze hides the panel briefly;
5. the returned preview contains the chart area and not the floating panel;
6. analysis starts immediately.

- [ ] **Step 4: Report Stage B for review**

Report test counts, build paths, smoke-test result, commits, and any remaining site-specific limitation. Do not generate ZIP, push, publish, or deploy.
