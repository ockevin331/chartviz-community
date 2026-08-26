# Task 7 implementation report

## Scope and baseline

- Stage: 7 — v1.0.0-referenced direct Community analysis panel.
- Base commit: `505395db403c20bd1969f1e0796f06b49b3a95ca`.
- Worktree: `/Users/kevin/data/pn/git/chartviz/.worktrees/community-v1-clean`.
- UI mapping: `.superpowers/sdd/2026-08-26-community-v1-convergent-execution/task-7-ui-map.md`.
- The mapping was written before Stage 7 production components. It records the v1.0.0 shell, setup fields, source/preview, scan/progress, report cards, separated images, lightbox, header close/drag, floating mount, and explicit exclusions.

## RED evidence

The initial focused run was:

```text
pnpm vitest run tests/provider-setup.test.tsx tests/analysis-controller.test.tsx tests/report-view.test.tsx tests/panel-workflow.test.tsx tests/panel-visibility.test.ts
```

Expected failures were observed before the Stage 7 production implementation:

- `ProviderSetup`, `use-analysis-controller`, and `ReportView` imports did not exist.
- The placeholder panel failed both source/workflow and v1 close/drag expectations.
- The carried Stage 5 regression reproduced: two successive `mountFloatingPanel` calls left two live `message` listeners (`received 2`, `expected 1`).

These failures named the missing production behavior. The new tests then drove setup/session behavior, controller transitions/request count/cancellation, exact direct-report ordering and image placement, whole-panel workflow, and remount cleanup.

### Fix round RED evidence

The one allowed review fix round began with focused tests for every reported gap, before the fix-round production edits:

```text
cd extension
pnpm exec vitest run tests/provider-setup.test.tsx tests/analysis-controller.test.tsx tests/report-view.test.tsx tests/panel-workflow.test.tsx
4 files failed; 12 tests failed; 10 tests passed
```

The failures reproduced non-cooperative late provider resolution/rejection after cancel, a stale operation blocking or overwriting an immediate new analysis, cancellation during final preparation, raw validation detail reaching the UI, the duplicate language control, password glyphs instead of SVG icons, missing report evidence correlations/pattern bias/copy fields, and missing lightbox focus handling.

## Implemented behavior

- Setup provides OpenRouter/OpenAI/Gemini, provider-specific curated models, custom model IDs, masked session-only API key, eye control, flag + EN/CN language, connection test, cost notice, localized provider errors, and a required visible custom-model image-input acknowledgement.
- The controller implements `setup → source → preview → analyzing → completed/failed/cancelled`; a failed/cancelled result returns to preview only after the explicit UI action.
- Each Analyze action calls `VisionProvider.analyze` once. There is no automatic retry; a second call requires another explicit Analyze action.
- The controller builds the selected-language `buildCommunityPrompt`, supplies the shared `communityJsonSchema`, validates with `parseCommunityReport`, and calls `buildAnnotations` automatically.
- Progress renders only `reading_chart`, `organizing_evidence`, and `preparing_result`, localized without provider payload, prompt, schema, or reasoning detail.
- Source intake directly uses manual upload and TradingView visible capture. The preview reuses the v1 scan beam/activity composition.
- `ReportView` renders `CommunityReport` directly in schema order: chart, market view, evidence, optional volume, optional indicators, optional levels, scenarios, optional patterns, optional signals, risk notice. Empty/null optional sections are omitted.
- Long, short, and wait scenarios show their complete public fields. The levels annotation stays under support/resistance; each signal/pattern annotation stays with its matching explanation.
- The original plus every separated annotation shares one lightbox behavior and has its own download action. Copy produces readable report text without schema/internal fields.
- The header preserves flag language control, close messaging, and pointer drag messaging. The Stage 5 mount now handles those messages and invokes the previous host cleanup before a remount, removing the stale visibility listener.
- No Cloud/login/account/plan/history/news/multi-timeframe/exchange/compatibility/legacy-adapter UI was added.

## Fix-round hardening

- Every analysis action now owns a generation token. Cancel, back/navigation, provider reconfiguration, and source changes invalidate that generation and abort the cooperative request; every state write after an asynchronous boundary checks that it still owns the current generation. Cancel also releases the request slot immediately, so a new explicit analysis can start without waiting for a non-cooperative provider.
- Provider report validation is always exposed as the stable localized `invalid_response` error. Annotation/image construction failure is exposed as stable localized `invalid_image`; arbitrary exception messages are never rendered.
- Market view, volume, each indicator, each level, long/short/wait scenarios, each pattern, and each signal now show readable evidence-number chips. Pattern bias is visible, and copied text includes all non-geometric report content and readable evidence correlations while excluding schema and coordinate internals.
- The panel header is the sole language control. The API-key visibility control uses accessible eye/eye-off SVG icons.
- The lightbox focuses its close button on open, traps forward and reverse Tab in the simple modal, and restores focus to the invoking zoom control on close.

## Dependency boundary

Only the plan-authorized DOM test packages were added, all under `devDependencies`:

- `@testing-library/react`
- `@testing-library/user-event`
- `jsdom`

Production dependencies are unchanged. Chrome and Edge production builds completed with the UI bundled as ordinary extension assets.

## Changed files

- Evidence: `.superpowers/sdd/2026-08-26-community-v1-convergent-execution/task-7-ui-map.md`, `task-7-report.md`.
- Dependencies: `extension/package.json`, `extension/pnpm-lock.yaml`.
- Panel: `extension/entrypoints/panel/App.tsx`, `extension/entrypoints/panel/style.css`.
- Controller: `extension/src/ui/state/use-analysis-controller.ts`.
- Components: `ProviderSetup.tsx`, `LanguageMenu.tsx`, `ImageSourcePicker.tsx`, `ImagePreview.tsx`, `AnalysisProgress.tsx`, `AnalysisError.tsx`, `ReportView.tsx`, `AnnotatedImage.tsx`, `ImageLightbox.tsx`.
- Export helpers: `extension/src/ui/export/download-image.ts`, `copy-report.ts`.
- Localization: `extension/src/i18n/en.ts`, `zh-CN.ts`.
- Stage 5 minor: `extension/src/capture/mount-floating-panel.ts`, `extension/tests/panel-visibility.test.ts`.
- Stage 7 tests/fixtures: `extension/tests/provider-setup.test.tsx`, `analysis-controller.test.tsx`, `report-view.test.tsx`, `panel-workflow.test.tsx`, `community-ui-fixtures.ts`.

## GREEN and verification evidence

All commands below use the repository root unless prefixed with `cd extension`:

```text
cd extension && pnpm exec vitest run tests/provider-setup.test.tsx tests/analysis-controller.test.tsx tests/report-view.test.tsx tests/panel-workflow.test.tsx
4 files passed; 22 tests passed

cd extension && pnpm test
23 files passed; 478 tests passed

cd extension && pnpm compile
exit 0

cd extension && pnpm build
Chrome MV3 build exit 0; panel HTML/JS/CSS, background, manifest, and icons emitted

cd extension && pnpm build:edge
Edge MV3 build exit 0; matching panel HTML/JS/CSS, background, manifest, and icons emitted

node --test tests/built-manifest.test.mjs tests/repository-structure.test.mjs
3 tests passed; 0 failed

git diff --check
exit 0
```

## Remaining risks

- Automated DOM tests use synthetic images/provider responses. Real provider credentials and browser screenshot/lightbox/download behavior remain part of the separately approved Stage 8 manual smoke test.
- `document.referrer` supplies the embedding TradingView URL to the Stage 5 capture guard. Host pages with unusually restrictive referrer behavior may surface the existing localized capture failure and require verification in the manual smoke test; no broader host permission or compatibility adapter was added.
- No packaging, publishing, deployment, website navigation, or real-key testing was performed.
