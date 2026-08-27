# Community Extension Stage 1 Site Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distinguish unsupported domains from unsupported chart URLs, guide unsupported domains to ChartViz screenshot upload, and show one clickable same-site BTC example for supported domains with an unsupported URL.

**Architecture:** A single supported-site registry becomes the source of host classification, exact chart-URL matching, manifest match patterns, host permissions, public site links, and BTC examples. The background process classifies the active URL before contacting a content script and returns a structured availability failure; the panel receives that structure through a typed error and renders the appropriate guidance without comparing English error strings.

**Tech Stack:** TypeScript 7, React 19, WXT 0.21, Vitest 4, Testing Library, Manifest V3.

**Spec:** `docs/superpowers/specs/2026-08-27-community-extension-cloud-direct-modes.md`

## Global Constraints

- This plan implements only Stage 1 site guidance; it does not add Cloud/Direct mode settings, Cloud transport, or multi-timeframe capture.
- Unsupported-domain guidance uses neutral alert styling and a prominent text link to `https://www.chartviz.xyz/`.
- Supported-domain/unsupported-URL guidance shows exactly one clickable BTC example for the current site.
- The in-panel screenshot-upload control is removed from unsupported-page guidance.
- Existing supported chart capture, Direct analysis, provider-key boundaries, drag, refresh, close, and language behavior remain unchanged.
- Raw current URLs, provider keys, screenshots, prompts, and model responses do not enter public availability errors.
- English and Simplified Chinese are both required.
- Use test-driven development: write and observe each failing test before production edits.
- Preserve unrelated dirty-worktree changes and stage only files belonging to the current task.

---

## File structure

- `extension/src/sites/supported-sites.ts`: owns supported-site definitions and URL classification; exports derived manifest/link collections.
- `extension/src/sites/collect-context.ts`: dispatches valid chart URLs to the existing site collectors using the registry classification.
- `extension/src/domain/chart-messages.ts`: carries optional structured availability data on failed inspect/capture responses.
- `extension/entrypoints/background.ts`: classifies the active tab before messaging or screenshot capture.
- `extension/src/capture/active-chart.ts`: converts a structured failed response into a typed panel-facing error.
- `extension/src/ui/components/ChartCaptureSource.tsx`: renders domain guidance, same-site example guidance, or ordinary loading failures.
- `extension/entrypoints/panel/App.tsx`: removes obsolete unsupported-page upload plumbing.
- `extension/src/i18n/en.ts`, `extension/src/i18n/zh-CN.ts`: localized site-guidance copy.
- `extension/entrypoints/panel/style.css`: neutral guidance, prominent ChartViz link, green supported-site chips, and same-site example link.
- Tests named below protect registry derivation, message propagation, UI behavior, and the unchanged supported-chart workflow.

---

### Task 1: Central supported-site registry and URL classification

**Files:**
- Modify: `extension/src/sites/supported-sites.ts`
- Modify: `extension/src/sites/collect-context.ts`
- Modify: `extension/tests/manifest.test.ts`
- Create: `extension/tests/supported-sites.test.ts`

**Interfaces:**
- Produces: `SupportedSiteId`, `SupportedSiteDefinition`, `ChartAvailabilityFailure`, `supportedSites`, `findSupportedSiteByHost(url)`, `findSupportedSiteByChartUrl(url)`, and `classifyChartAvailability(url)`.
- Preserves: `isSupportedChartHost`, `supportedContentMatches`, `supportedChartHosts`, and `supportedSiteLinks` as registry-derived exports for existing consumers.
- Consumes: existing pure URL parsers from each site collector; no DOM collector runs during classification.

- [ ] **Step 1: Add failing registry classification tests**

Create `extension/tests/supported-sites.test.ts` with literal expectations:

```ts
import { describe, expect, it } from 'vitest';
import {
  classifyChartAvailability,
  findSupportedSiteByChartUrl,
  supportedSites,
} from '../src/sites/supported-sites';

describe('supported site registry', () => {
  it('classifies an unknown domain without inventing a site', () => {
    expect(classifyChartAvailability('https://gmgn.ai/sol/token/example')).toEqual({
      code: 'unsupported_site',
      onChartVizSite: false,
    });
  });

  it('classifies ChartViz separately for same-page upload guidance', () => {
    expect(classifyChartAvailability('https://www.chartviz.xyz/')).toEqual({
      code: 'unsupported_site',
      onChartVizSite: true,
    });
  });

  it('returns the current supported site and its BTC example for a wrong URL', () => {
    expect(classifyChartAvailability('https://www.binance.com/en/markets')).toEqual({
      code: 'unsupported_url',
      site: 'binance',
      siteName: 'Binance',
      exampleUrl: 'https://www.binance.com/en/trade/BTC_USDT?type=spot',
    });
  });

  it('accepts valid localized and site-specific chart URLs', () => {
    expect(classifyChartAvailability('https://www.binance.com/zh-CN/trade/BTC_USDT?type=spot')).toBeNull();
    expect(findSupportedSiteByChartUrl('https://vergex.trade/chart?symbol=BTC&exchange=3c1d0438-8a57-4a2e-ad90-68069c247367')?.id).toBe('vergex');
  });

  it('defines one non-empty BTC example and manifest boundary for every advertised site', () => {
    for (const site of supportedSites) {
      expect(new URL(site.exampleBtcUrl).protocol).toBe('https:');
      expect(site.contentMatches.length).toBeGreaterThan(0);
      expect(site.hostPermissions.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Strengthen the existing manifest test before implementation**

Modify `extension/tests/manifest.test.ts` so it proves the exported collections are derived without broadening permissions:

```ts
import {
  isSupportedChartHost,
  supportedContentMatches,
  supportedChartHosts,
  supportedSites,
} from '../src/sites/supported-sites';

expect(supportedContentMatches).toEqual(supportedSites.flatMap((site) => site.contentMatches));
expect(supportedChartHosts).toEqual(supportedSites.flatMap((site) => site.hostPermissions));
expect(new Set(supportedContentMatches).size).toBe(supportedContentMatches.length);
expect(new Set(supportedChartHosts).size).toBe(supportedChartHosts.length);
```

- [ ] **Step 3: Run the focused tests and observe RED**

Run:

```bash
cd extension
pnpm exec vitest run tests/supported-sites.test.ts tests/manifest.test.ts
```

Expected: FAIL because `supportedSites`, `classifyChartAvailability`, and the new registry functions do not exist.

- [ ] **Step 4: Implement the registry and derived exports**

Replace the parallel arrays in `extension/src/sites/supported-sites.ts` with these exact public shapes:

```ts
import type { ChartContext } from '../domain/chart-context';

export type SupportedSiteId = Exclude<ChartContext['site'], 'crypto-com'>;

export type SupportedSiteDefinition = Readonly<{
  id: SupportedSiteId;
  name: string;
  hostSuffixes: readonly string[];
  exactHosts?: readonly string[];
  contentMatches: readonly string[];
  hostPermissions: readonly string[];
  exampleBtcUrl: string;
  multiTimeframe: boolean;
  matchesChartUrl(value: string): boolean;
}>;

export type ChartAvailabilityFailure =
  | Readonly<{ code: 'unsupported_site'; onChartVizSite: boolean }>
  | Readonly<{
      code: 'unsupported_url';
      site: SupportedSiteId;
      siteName: string;
      exampleUrl: string;
    }>;
```

Build `supportedSites` from the current 14 advertised sites and their existing literal URLs. Use the current parser functions for `matchesChartUrl`:

- TradingView: `/chart/` URL predicate;
- Binance: existing spot, futures, stock, and web3 parsers;
- OKX: `parseOkxTradeUrl`;
- Bybit: `parseBybitTradeUrl`;
- Hyperliquid, Coinbase, Bitget, Gate, KuCoin, MEXC, HTX: `parseAdditionalExchangeUrl(value)?.site === id`;
- Upbit: `parseUpbitExchangeUrl`;
- 10jqka: `parse10jqkaStockUrl`;
- VergeX: `parseVergexChartUrl`.

Keep `multiTimeframe: false` only for `10jqka`; this field is registry data for a later stage and has no Stage 1 UI behavior.

Implement exact helpers:

```ts
export function findSupportedSiteByHost(value: string): SupportedSiteDefinition | null;
export function findSupportedSiteByChartUrl(value: string): SupportedSiteDefinition | null;
export function classifyChartAvailability(value: string): ChartAvailabilityFailure | null;
export function isSupportedChartHost(value: string): boolean;
```

`classifyChartAvailability` returns `null` for a valid chart URL, checks `chartviz.xyz` and subdomains only for `onChartVizSite`, and returns the registry's literal example metadata for a supported host with the wrong URL.

Derive the old exports exactly:

```ts
export const supportedContentMatches = supportedSites.flatMap((site) => [...site.contentMatches]);
export const supportedChartHosts = supportedSites.flatMap((site) => [...site.hostPermissions]);
export const supportedSiteLinks = supportedSites.map(({ id, name, exampleBtcUrl }) => ({
  id,
  name,
  url: exampleBtcUrl,
}));
```

The literal arrays must remain duplicate-free so manifest permissions do not expand accidentally.

- [ ] **Step 5: Make context dispatch consume registry classification**

In `extension/src/sites/collect-context.ts`, replace `isSupportedChartUrl`'s parallel parser expression with:

```ts
export function isSupportedChartUrl(value: string): boolean {
  return findSupportedSiteByChartUrl(value) !== null;
}
```

At the start of `collectActiveChartContext` and `waitForActiveChartReady`, use the registry result to reject invalid pages. Preserve the current bounded internal error text for content-script callers; structured public availability is introduced at the background boundary in Task 2.

- [ ] **Step 6: Run focused tests and observe GREEN**

Run:

```bash
cd extension
pnpm exec vitest run tests/supported-sites.test.ts tests/manifest.test.ts
```

Expected: both test files PASS.

- [ ] **Step 7: Compile and commit Task 1**

Run:

```bash
cd extension
pnpm compile
git diff --check
cd ..
git add extension/src/sites/supported-sites.ts extension/src/sites/collect-context.ts extension/tests/supported-sites.test.ts extension/tests/manifest.test.ts
git commit -m "refactor(community): centralize supported site registry"
```

Expected: compile exits 0; commit contains only the four listed files.

---

### Task 2: Structured availability propagation

**Files:**
- Modify: `extension/src/domain/chart-messages.ts`
- Modify: `extension/entrypoints/background.ts`
- Modify: `extension/src/capture/active-chart.ts`
- Modify: `extension/tests/capture-secret-boundary.test.ts`
- Modify: `extension/tests/active-chart-capture.test.ts`

**Interfaces:**
- Consumes: `ChartAvailabilityFailure` and `classifyChartAvailability(url)` from Task 1.
- Produces: `ChartAvailabilityError`, `isChartAvailabilityError(error)`, and failed background responses with an optional `availability` field.
- Preserves: ordinary readiness/crop errors as bounded message-only failures and exact background message validation.

- [ ] **Step 1: Add failing background classification tests**

Update the current unsupported-URL table in `extension/tests/capture-secret-boundary.test.ts` into two explicit cases.

Unknown domain expectation:

```ts
expect(await handlers.onMessage({ type: 'chartviz/active-chart/inspect' })).toEqual({
  ok: false,
  error: 'This site is not supported.',
  availability: { code: 'unsupported_site', onChartVizSite: false },
});
expect(dependencies.sendTabMessage).not.toHaveBeenCalled();
```

Supported Binance host with the wrong path expectation:

```ts
expect(await handlers.onMessage({ type: 'chartviz/active-chart/inspect' })).toEqual({
  ok: false,
  error: 'This page is not a supported chart URL.',
  availability: {
    code: 'unsupported_url',
    site: 'binance',
    siteName: 'Binance',
    exampleUrl: 'https://www.binance.com/en/trade/BTC_USDT?type=spot',
  },
});
expect(dependencies.sendTabMessage).not.toHaveBeenCalled();
```

Add a ChartViz-domain case expecting `onChartVizSite: true`.

- [ ] **Step 2: Add a failing active-client propagation test**

In `extension/tests/active-chart-capture.test.ts`, return a structured failure and assert the typed error:

```ts
const client = createActiveChartClient({
  sendMessage: async () => ({
    ok: false,
    error: 'This page is not a supported chart URL.',
    availability: {
      code: 'unsupported_url',
      site: 'binance',
      siteName: 'Binance',
      exampleUrl: 'https://www.binance.com/en/trade/BTC_USDT?type=spot',
    },
  }),
  dataUrlToBlob: () => new Blob(),
  processImage: async () => processed,
});

await expect(client.inspect()).rejects.toMatchObject({
  name: 'ChartAvailabilityError',
  availability: { code: 'unsupported_url', site: 'binance' },
});
```

- [ ] **Step 3: Run focused tests and observe RED**

Run:

```bash
cd extension
pnpm exec vitest run tests/capture-secret-boundary.test.ts tests/active-chart-capture.test.ts
```

Expected: FAIL because response types and client errors do not retain availability data.

- [ ] **Step 4: Extend failed response contracts**

In `extension/src/domain/chart-messages.ts`, import `ChartAvailabilityFailure` as a type and define:

```ts
export type ChartFailure = {
  ok: false;
  error: string;
  availability?: ChartAvailabilityFailure;
};

export type ChartContextResponse =
  | { ok: true; context: ChartContext }
  | ChartFailure;

export type CaptureResponse =
  | { ok: true; context: ChartContext; previewDataUrl: string }
  | ChartFailure;
```

Do not add raw URL, browser tab ID, provider, model, or secret fields.

- [ ] **Step 5: Classify before contacting content scripts**

In `extension/entrypoints/background.ts`, replace `supportedActiveTab`'s host-only check with registry classification:

```ts
function availabilityMessage(failure: ChartAvailabilityFailure): string {
  return failure.code === 'unsupported_site'
    ? 'This site is not supported.'
    : 'This page is not a supported chart URL.';
}

async function supportedActiveTab(): Promise<ActiveTab | ChartFailure> {
  const tab = await activeTab();
  const availability = classifyChartAvailability(tab.url ?? '');
  return availability
    ? { ok: false, error: availabilityMessage(availability), availability }
    : tab;
}
```

Both inspect and capture return the structured failure immediately. They must not call `sendTabMessage`, request capture permission, hide the panel, or capture the tab for either availability failure.

- [ ] **Step 6: Preserve the structure in a typed client error**

In `extension/src/capture/active-chart.ts`, add:

```ts
export class ChartAvailabilityError extends Error {
  readonly name = 'ChartAvailabilityError';

  constructor(
    message: string,
    readonly availability: ChartAvailabilityFailure,
  ) {
    super(message);
  }
}

export function isChartAvailabilityError(error: unknown): error is ChartAvailabilityError {
  return error instanceof ChartAvailabilityError;
}
```

`responseError` returns this class only when the response contains a valid structured availability object. All other failures remain ordinary `Error` instances.

- [ ] **Step 7: Run focused tests and observe GREEN**

Run:

```bash
cd extension
pnpm exec vitest run tests/capture-secret-boundary.test.ts tests/active-chart-capture.test.ts
```

Expected: both test files PASS and no capture action occurs for invalid pages.

- [ ] **Step 8: Compile and commit Task 2**

Run:

```bash
cd extension
pnpm compile
git diff --check
cd ..
git add extension/src/domain/chart-messages.ts extension/entrypoints/background.ts extension/src/capture/active-chart.ts extension/tests/capture-secret-boundary.test.ts extension/tests/active-chart-capture.test.ts
git commit -m "feat(community): propagate chart availability guidance"
```

Expected: compile exits 0; commit contains only the five listed files.

---

### Task 3: Localized panel guidance and obsolete upload removal

**Files:**
- Modify: `extension/src/ui/components/ChartCaptureSource.tsx`
- Modify: `extension/entrypoints/panel/App.tsx`
- Modify: `extension/src/i18n/en.ts`
- Modify: `extension/src/i18n/zh-CN.ts`
- Modify: `extension/entrypoints/panel/style.css`
- Modify: `extension/tests/chart-capture-source.test.tsx`
- Modify: `extension/tests/panel-workflow.test.tsx`

**Interfaces:**
- Consumes: `ChartAvailabilityError`, `isChartAvailabilityError`, `ChartAvailabilityFailure`, and registry-derived `supportedSiteLinks`.
- Produces: three explicit panel states—unsupported site, unsupported same-site URL, and ordinary chart loading/capture error.
- Removes: `processUpload` and `onUploaded` from `ChartCaptureSourceProps`, plus the now-unused upload dependency and handler from `App`.

- [ ] **Step 1: Replace the unsupported-page component test with two failing guidance tests**

In `extension/tests/chart-capture-source.test.tsx`, remove `processUpload` and `onUploaded` from every render call. Import `ChartAvailabilityError` and add an unsupported-domain test:

```tsx
const inspect = vi.fn().mockRejectedValue(new ChartAvailabilityError(
  'This site is not supported.',
  { code: 'unsupported_site', onChartVizSite: false },
));

render(<ChartCaptureSource
  language="en"
  inspect={inspect}
  capture={async () => captured}
  onCaptured={() => undefined}
/>);

expect(await screen.findByRole('heading', { name: 'This site is not supported' })).toBeTruthy();
expect(screen.getByRole('link', { name: 'Upload a screenshot on ChartViz' })).toHaveProperty(
  'href',
  'https://www.chartviz.xyz/',
);
expect(screen.getByRole('link', { name: 'TradingView' })).toBeTruthy();
expect(document.querySelector('input[type="file"]')).toBeNull();
expect(screen.queryByRole('button', { name: /upload/i })).toBeNull();
```

Add a supported-domain/unsupported-URL test:

```tsx
const inspect = vi.fn().mockRejectedValue(new ChartAvailabilityError(
  'This page is not a supported chart URL.',
  {
    code: 'unsupported_url',
    site: 'binance',
    siteName: 'Binance',
    exampleUrl: 'https://www.binance.com/en/trade/BTC_USDT?type=spot',
  },
));

expect(await screen.findByRole('heading', { name: 'This page is not a supported chart page' })).toBeTruthy();
expect(screen.getByRole('link', { name: 'Open Binance BTC chart' })).toHaveProperty(
  'href',
  'https://www.binance.com/en/trade/BTC_USDT?type=spot',
);
expect(screen.queryByRole('link', { name: 'TradingView' })).toBeNull();
expect(screen.queryByRole('link', { name: 'Upload a screenshot on ChartViz' })).toBeNull();
```

Add a ChartViz-domain assertion that the same canonical link is labeled `Use the screenshot upload area on this page`.

- [ ] **Step 2: Replace the panel workflow upload test with a non-analysis guidance test**

In `extension/tests/panel-workflow.test.tsx`, replace `offers screenshot upload and analyzes it` with:

```tsx
it('guides an unsupported site to ChartViz without invoking analysis', async () => {
  const analyze = vi.fn(async () => communityReport);
  render(<App dependencies={{
    loadConfig: async () => ({
      provider: 'openrouter',
      apiKey: 'key',
      model: 'google/gemini-3.7-flash',
      customModel: false,
    }),
    inspect: async () => {
      throw new ChartAvailabilityError(
        'This site is not supported.',
        { code: 'unsupported_site', onChartVizSite: false },
      );
    },
    getProvider: () => provider,
    runAnalysis: analyze,
  }} />);

  expect(await screen.findByRole('link', { name: 'Upload a screenshot on ChartViz' })).toBeTruthy();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(analyze).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run UI tests and observe RED**

Run:

```bash
cd extension
pnpm exec vitest run tests/chart-capture-source.test.tsx tests/panel-workflow.test.tsx
```

Expected: FAIL because the panel still compares one English string and renders the upload control.

- [ ] **Step 4: Add the exact localized copy**

Add matching keys to `extension/src/i18n/en.ts` and `extension/src/i18n/zh-CN.ts`:

| Key | English | Simplified Chinese |
|---|---|---|
| `unsupportedSiteTitle` | `This site is not supported` | `当前站点暂不支持` |
| `unsupportedSiteHelp` | `Analyze a clear candlestick screenshot on ChartViz, or open one of the supported chart sites below.` | `你可以前往 ChartViz 上传清晰的 K 线截图，或打开下方任一已支持的图表站点。` |
| `unsupportedUrlTitle` | `This page is not a supported chart page` | `当前页面不是受支持的图表页面` |
| `unsupportedUrlHelp` | `Open a chart page containing candlesticks, price, volume, and a visible timeframe.` | `请打开包含 K 线、价格、成交量和可见周期的图表页面。` |
| `uploadOnChartViz` | `Upload a screenshot on ChartViz` | `前往 ChartViz 上传截图` |
| `uploadOnCurrentChartViz` | `Use the screenshot upload area on this page` | `使用当前页面的截图上传区域` |
| `openSiteBtcChart` | `Open {site} BTC chart` | `打开 {site} 的 BTC 图表` |

Remove obsolete `unsupportedPage`, `unsupportedChartHelp`, `uploadScreenshot`, `uploadingScreenshot`, and `uploadError` keys only after all consumers are removed. Keep `supportedSites`.

- [ ] **Step 5: Render the structured states**

In `ChartCaptureSource.tsx`:

- store `ChartAvailabilityFailure | null` separately from ordinary `error` text;
- use `isChartAvailabilityError` in `refresh` to populate it;
- reset availability on refresh;
- render ordinary errors with the existing refresh action;
- render unsupported site guidance with the ChartViz link and all registry-derived supported-site chips;
- render unsupported URL guidance with exactly one `exampleUrl` link labeled by replacing `{site}` with `siteName`;
- never display the raw internal error string in either structured guidance state;
- use `target="_blank" rel="noreferrer"` for every external link;
- remove `uploadInput`, `uploading`, `uploadError`, `uploadFile`, file input, and upload button.

The ChartViz target remains exactly `https://www.chartviz.xyz/` in both unsupported-site variants.

- [ ] **Step 6: Remove obsolete App upload plumbing**

In `extension/entrypoints/panel/App.tsx`:

- remove `processImage` and `ProcessedImage` imports that are used only by manual upload;
- remove `processUpload` from `AppDependencies` and `defaultDependencies`;
- remove `analyzeUploaded`;
- stop passing `processUpload` and `onUploaded` to `ChartCaptureSource`;
- keep automatic capture and analysis unchanged.

- [ ] **Step 7: Apply focused guidance styling**

In `extension/entrypoints/panel/style.css`:

- keep `.chart-guidance` neutral amber rather than red;
- add `.chartviz-upload-link` as a prominent 12px semibold text link with an underline/focus-visible state, not a button;
- retain green supported-site chips;
- add `.site-example-link` as one full-width readable link below the explanation;
- remove `.unsupported-upload` because the upload control no longer exists;
- preserve panel width and height rules.

- [ ] **Step 8: Run UI tests and observe GREEN**

Run:

```bash
cd extension
pnpm exec vitest run tests/chart-capture-source.test.tsx tests/panel-workflow.test.tsx tests/panel-layout.test.ts
```

Expected: all three test files PASS.

- [ ] **Step 9: Run the complete Stage 1 verification gate**

Run:

```bash
cd extension
pnpm test
pnpm compile
pnpm build
pnpm build:edge
git diff --check
```

Expected:

- every Vitest file passes with zero failures;
- TypeScript exits 0;
- Chrome MV3 production build exits 0;
- Edge MV3 production build exits 0;
- `git diff --check` emits no errors.

- [ ] **Step 10: Commit Task 3**

Run:

```bash
cd ..
git add extension/src/ui/components/ChartCaptureSource.tsx extension/entrypoints/panel/App.tsx extension/src/i18n/en.ts extension/src/i18n/zh-CN.ts extension/entrypoints/panel/style.css extension/tests/chart-capture-source.test.tsx extension/tests/panel-workflow.test.tsx
git commit -m "feat(community): guide unsupported chart pages"
```

Expected: commit contains only the seven listed files; unrelated existing changes remain unstaged.

---

## Stage 1 review checklist

After all three tasks:

1. Open a supported TradingView chart and confirm detection and capture remain unchanged.
2. Open `https://www.binance.com/en/markets` and confirm one clickable Binance BTC example appears, with no full supported-site list.
3. Open `https://gmgn.ai/` and confirm the prominent ChartViz upload link plus green supported-site links appear.
4. Open `https://www.chartviz.xyz/` and confirm the same-page upload wording appears.
5. Switch English and Simplified Chinese in each guidance state.
6. Confirm no file input or screenshot-upload button appears in unsupported-page guidance.
7. Confirm no raw URL, provider key, screenshot, prompt, or model response appears in the rendered guidance or background failure structure.
8. Stop for user review; do not start Stage 2 without explicit approval.

