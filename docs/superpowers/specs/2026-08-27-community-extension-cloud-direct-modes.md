# ChartViz Open-Source Extension Cloud/Direct Modes

**Date:** 2026-08-27

**Status:** Approved in chat; pending written-spec review

## Objective

Prepare the open-source ChartViz extension for two analysis modes while keeping
the currently usable Direct analysis path intact:

- **ChartViz Cloud**, the default product tab and future managed-analysis path;
- **Direct model**, the existing browser-to-provider path using the user's own
  provider key.

This phase changes only the open-source extension. It does not implement,
merge, deploy, or modify the private ChartViz Cloud API. The extension must not
claim that Cloud is connected, store an unusable Cloud token, or transmit a
token or screenshot until a real Cloud gateway is added in a later phase.

The same phase improves unsupported-page guidance and restores the proven
v1.0.0 multi-timeframe capture interaction. Direct analysis remains strictly
single-timeframe. Multi-timeframe analysis is reserved for Cloud.

## Scope

### Included

- distinguish unsupported domains from supported domains with unsupported URLs;
- link unsupported domains to `https://www.chartviz.xyz/` for screenshot upload;
- show a clickable site-specific BTC chart example for an unsupported URL on a
  supported domain;
- centralize supported-site metadata, domain matching, URL matching, and example
  links in one registry;
- add Cloud and Direct tabs to initial setup and the settings dialog;
- make the Cloud tab the default selection for a new installation;
- retain the complete existing Direct provider/model/API-key configuration;
- introduce a mode-neutral analysis-runtime boundary;
- show the v1.0.0 single/multi-timeframe mode cards;
- restore the proven v1.0.0 Context/Setup/Trigger timeframe switching and
  screenshot capture behavior;
- keep Direct analysis limited to one screenshot and one timeframe;
- show a Cloud guidance message when a Direct user selects multi-timeframe;
- add English and Simplified Chinese copy and behavior tests;
- build and verify Chrome and Edge artifacts.

### Excluded

- private Cloud API routes, authentication, token generation, plan lookup,
  quota charging, hosted task processing, history, and billing;
- a working production Cloud network transport;
- storing or validating `cv_live_*` tokens in this phase;
- Cloud report parsing or Cloud task polling against a live server;
- changing the Direct three-stage prompts or analysis semantics;
- Direct multi-timeframe analysis;
- multi-timeframe support on sites for which v1.0.0 explicitly disables it;
- website changes.

## Design decisions

### 1. One extension, two explicit modes

The extension introduces a discriminated mode without placing mode checks
throughout the UI:

```ts
type AnalysisMode = 'cloud' | 'direct';

type AnalysisRuntime = {
  mode: AnalysisMode;
  capabilities(): AnalysisCapabilities;
  analyze(input: AnalysisInput): Promise<AnalysisOutcome>;
  cancel(): void;
};
```

The existing three-stage local pipeline is wrapped by `DirectAnalysisRuntime`.
The Cloud implementation is represented by an injected `CloudAnalysisGateway`
interface. The production gateway for this phase returns a stable
`cloud_not_available` result before accepting credentials or screenshots. Tests
may inject a fake Cloud gateway to verify capability-driven UI and three-image
submission without a network service.

The panel depends on the runtime interface. Provider selection, provider keys,
and local prompt details remain inside the Direct runtime and its setup panel.

### 2. Configuration state and secret handling

The selected mode is non-secret preference data stored in
`browser.storage.local`. A new installation defaults to `cloud`.

The Direct provider key keeps the existing security rule:

- stored only in `browser.storage.session`;
- never sent to content scripts;
- never included in diagnostics, logs, URLs, or exported reports;
- lost when the browser session ends.

Because the Cloud service is not implemented in this phase, the Cloud tab does
not persist a token. It displays the future connection purpose, a link to
ChartViz, and an explicit localized availability message. A later Cloud phase
will replace the gateway and add `cv_live_*` token persistence under a separate
storage key without changing the setup tabs or analysis-runtime interface.

Switching tabs edits a pending choice. A mode becomes active only after the
corresponding action succeeds. Direct activates after its existing connection
test and save operation. Cloud cannot activate in this phase. Existing Direct
users remain in Direct mode after upgrade; the Cloud default applies only when
no prior usable Direct configuration and no saved mode exist.

### 3. Setup and settings UI

The initial setup screen and settings dialog reuse one mode-settings component:

```text
[ ChartViz Cloud ] [ Direct model ]
```

The Cloud tab is selected initially for a new installation and contains:

- a concise explanation of managed Cloud analysis;
- a note that multi-timeframe analysis belongs to Cloud;
- a link to `https://www.chartviz.xyz/`;
- a clear `Cloud connection will be enabled in a later update` state;
- no API-token input and no misleading connect button in this phase.

The Direct tab contains the current custom model selector, OpenRouter option,
provider key input, connection test, and save action. Existing styling and
custom select components are retained.

The settings dialog opens on the active mode. A user may inspect the other tab
without clearing the active configuration. Saving a new active mode resets
capture, report, errors, and in-memory analysis state so one mode cannot resume
another mode's task.

### 4. Supported-site registry and page guidance

The extension replaces separate host arrays and link arrays with one public
registry. Every entry contains:

```ts
type SupportedSiteDefinition = {
  id: SiteId;
  name: string;
  hostPatterns: readonly string[];
  contentMatches: readonly string[];
  exampleBtcUrl: string;
  multiTimeframe: boolean;
};
```

The registry is the source for host detection, manifest match generation,
supported-site links, the current site's example link, and multi-timeframe site
capability. Site-specific context collectors remain separate.

Chart inspection returns structured availability errors:

```ts
type ChartAvailabilityFailure =
  | { code: 'unsupported_site' }
  | {
      code: 'unsupported_url';
      site: SiteId;
      siteName: string;
      exampleUrl: string;
    };
```

Raw current URLs are not needed in the UI and are not displayed as the alert.

For an unsupported domain, the panel shows neutral alert styling, a prominent
text link to upload a screenshot at ChartViz, and the green supported-site
links. It removes the in-panel upload control from this state.

For a supported domain with an unsupported URL, the main message says that the
current page is not a supported chart page. It explains briefly that a chart is
missing or the URL pattern is not supported, then shows exactly one clickable
BTC example for the current site. It does not distract the user with every
other supported site.

If the current domain is already `chartviz.xyz`, the website link copy becomes
`Use the screenshot upload area on this page` while retaining the canonical
homepage target.

### 5. Single/multi-timeframe interaction

The capture screen restores the v1.0.0 two-card layout:

```text
Screenshot mode

[ Single timeframe ] [ Multi-timeframe ]
  Current chart         Context · Setup · Trigger
```

Single timeframe is the default capture mode. The multi-timeframe card remains
visible so users can discover the Cloud capability.

When Direct is active, selecting the multi-timeframe card does not change the
capture mode and does not start capture. It opens an inline localized notice:

- English: `Multi-timeframe analysis is available through ChartViz Cloud.`
- Simplified Chinese: `多周期分析由 ChartViz Cloud 提供，直连模型暂不支持。`

The notice includes an action that opens settings on the Cloud tab. In this
phase the Cloud tab truthfully shows that connection is not yet available.

When tests inject a Cloud runtime advertising `multiTimeframe: true` and
`maxTimeframes: 3`, the multi card becomes selectable and displays the default
roles:

- Context: `4h`;
- Setup: `1h`;
- Trigger: `15m`.

Cloud capability is a runtime property, not inferred from a hostname, token,
or plan name. A later real Cloud gateway will populate it from the server.

### 6. Multi-timeframe capture

The extension ports the v1.0.0 timeframe-switching implementation and its site
adapters rather than redesigning selector logic. The capture sequence is:

1. remember the current normalized timeframe when readable;
2. switch to Context and wait for the chart to report that exact timeframe;
3. wait for chart readiness and stable bounds;
4. hide the floating panel, crop the visible chart, and restore the panel;
5. repeat for Setup and Trigger;
6. restore the original timeframe in a `finally` path when possible;
7. return three labeled captures in Context/Setup/Trigger order.

The screen warns that the page may flicker while timeframes change. A failed
switch stops the sequence, restores the original timeframe when possible, and
returns a readable error naming the failed timeframe. Partial captures are not
submitted.

The capture API accepts a maximum of three distinct timeframes. Direct runtime
validates exactly one image before invoking any provider. The Cloud gateway
contract validates one to three images, but only an injected Cloud capability
can enable the three-image UI.

The role options remain:

- Context: `4h` or `1d`;
- Setup: `1h` or `4h`;
- Trigger: `5m` or `15m`.

This phase exposes the defaults but does not add a separate timeframe-settings
editor. That remains a later product decision.

### 7. Error handling

New stable UI errors include:

- `unsupported_site`;
- `unsupported_url`;
- `cloud_not_available`;
- `multi_timeframe_requires_cloud`;
- `multi_timeframe_site_unsupported`;
- `timeframe_switch_failed`;
- `multi_capture_incomplete`.

Errors are localized at the UI boundary. Internal selectors, schema names,
provider payloads, API keys, and future Cloud tokens are never included in
public messages or copied diagnostics.

### 8. Testing

Implementation follows test-driven development. Required behavior tests cover:

- registry-based domain and URL classification;
- one current-site BTC example for supported-domain/unsupported-URL failures;
- ChartViz upload link and supported-site links for unsupported domains;
- existing Direct users remaining in Direct mode after upgrade;
- new installations opening the Cloud tab by default;
- Direct setup and settings retaining current model/provider behavior;
- Cloud tab not accepting or storing secrets in this phase;
- Direct multi selection showing Cloud guidance without capture;
- fake Cloud capabilities enabling the v1.0.0 multi card;
- Context/Setup/Trigger capture order and original-timeframe restoration;
- stop-and-restore behavior on a failed switch;
- Direct runtime rejecting multiple images before a provider call;
- panel reset when the active mode changes;
- English and Simplified Chinese copy;
- Chrome and Edge manifest/build verification.

No paid provider request or real Cloud endpoint is required by automated tests.

## Delivery stages

Each stage ends with tests, TypeScript compilation, Chrome/Edge builds when
relevant, and a user review before the next stage starts.

1. **Site guidance:** registry, structured availability errors, ChartViz link,
   and current-site BTC example.
2. **Mode settings:** Cloud/Direct tabs, migration of existing Direct state,
   mode persistence, and unavailable Cloud gateway.
3. **Runtime boundary:** wrap the existing Direct controller behind the common
   runtime and add fake-Cloud contract tests without changing Direct output.
4. **Multi-timeframe UI:** restore the v1.0.0 mode cards and Direct-to-Cloud
   guidance.
5. **Multi-timeframe capture:** port proven switching/capture modules and test
   three-frame capture through an injected Cloud runtime.
6. **Release verification:** full tests, compile, Chrome/Edge builds, manifest
   audit, and manual supported/unsupported-page smoke checks.

## Acceptance criteria

- A new installation opens the ChartViz Cloud tab but cannot mistake the
  unimplemented Cloud service for a connected service.
- An existing Direct configuration continues working after upgrade.
- Direct mode performs the current three-stage single-image analysis with no
  extra provider call.
- Direct mode cannot capture or analyze multiple timeframes.
- Multi-timeframe is visible and explains that it requires Cloud.
- An injected capable Cloud runtime can drive the three-image capture UI,
  proving the extension boundary before the server phase.
- Unsupported domains link prominently to ChartViz screenshot upload.
- Supported domains with unsupported URLs show a clickable BTC example for
  that same site.
- The panel never stores an unusable Cloud token or sends a screenshot to an
  unavailable Cloud endpoint.
- Chrome and Edge production builds pass.

