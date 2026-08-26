# Task 7 v1.0.0 UI component/style map

## Inspected baseline

- Built reference: `/Users/kevin/data/pn/git/chartviz/dist/chrome/chartviz-v1.0.0-mv3/floating-panel.html`, `assets/floating-panel-DmV3B5k7.css`, and `chunks/floating-panel-CHx1HalZ.js` from the v1.0.0 MV3 artifact.
- Source reference: `/Users/kevin/data/pn/git/chartviz/entrypoints/floating-panel/App.tsx`, `style.css`, and `/Users/kevin/data/pn/git/chartviz/entrypoints/content.ts`.
- Community destination: `extension/entrypoints/panel/App.tsx`, `style.css`, `extension/src/ui/**`, and the existing Stage 5 floating mount.

The Community panel will preserve the reference's dark, single-column, 400–420 px floating composition. It will reuse the reference class vocabulary and measured values where applicable instead of introducing a parallel design system.

## Component and style mapping

| Community v1 area | v1.0.0 source/artifact reference | Reused composition and styling |
|---|---|---|
| Panel shell | `App.tsx` top-level `<main>` and `.drag-handle`; `style.css` `:root`, `body`, `main`, `section`, `.brand`, `.logo`, `.toolbar-button`; `content.ts#createFloatingPanel` | `#111318` shell, `#181b21` cards, 18 px main padding/16 px gap, 14 px card padding, 12 px card radius, 1 px `#292d36` borders, Inter/system stack, logo + “ChartViz Community” header, draggable header, right-side controls. |
| Provider/setup region | v1.0.0 `.community-connection-card`, `.plugin-auth-form`, `.plugin-password-field`, `.plugin-auth-choice`, `.plugin-auth-actions`, `.plugin-model-options` | One bordered setup card; grid labels and 42 px dark fields; provider/model choices as selected dark cards; masked key with in-field eye control; primary/secondary action treatment; compact warning/error/status boxes. Community fields replace the old backend/auth data layer. |
| Language | `App.tsx` `LANGUAGE_OPTIONS` and header picker; `.language-button`, `.language-menu` | Flag + `EN` or flag + `CN`, 94 px toolbar control, dark dropdown, selected check mark, no page link. |
| Source selection | v1.0.0 `.capture-workflow`, `.capture-source`, `.mode-switch`, `.file-input`, `.primary` | Single-source card with two v1-style choice tiles for visible TradingView capture and manual upload. No timeframe or exchange selector. |
| Source preview | `App.tsx` `.preview-stage.zoomable` and `.preview`; `.preview-stage`, `.preview`, `.download-image` | Full-width rounded image in a dark clipped stage, keyboard/click zoom target, secondary full-width download action. |
| Scanning/progress | `App.tsx` analyzing preview and `AnalysisActivity`; `.preview-stage.is-analyzing`, `.analysis-mask`, `.scan-beam`, `.analysis-activity`, `.activity-dots` | Dimmed preview, scan beam overlay, compact progress card, animated dots/check marks. Only Community's three public categories are rendered: reading chart, organizing evidence, preparing result. |
| Errors/cancel | v1.0.0 `.error`, `.analysis-cancelled-message`, `.analysis-running-actions`, `.cancel-analysis` | Bordered red error card, retry/back actions, and the v1 two-column analyze/cancel action row. Cancelled returns to the same preview with a status notice. |
| Report cards | v1.0.0 `section`, `.report-section`, `.grid`, `.decision`, `.level-list`, `.trade-signals`, `.pattern`, `.scenario`, `.muted` | Ordered single-column cards with nested dark rows; green/red directional accents for long/short; compact labels and evidence text. The data is the validated `CommunityReport` directly, with no legacy presentation adapter. |
| Annotated images | v1.0.0 `.signal-annotation`, `.pattern-annotation`, `.preview-stage.zoomable`, `.download-image` | Levels image stays inside support/resistance; each signal image stays inside its signal explanation; each pattern image stays inside its pattern description; each uses the same preview/download composition. |
| Lightbox | v1.0.0 `expandPreviewImage`/`showImagePreview` overlay behavior and `.preview-stage.zoomable` affordance | One reusable fixed, near-black, scrollable overlay for the original and every separated annotation; click backdrop/Escape/close exits; image is contained without restyling the report. |
| Close and floating interaction | `App.tsx` close toolbar + pointer drag bridge; `content.ts#createFloatingPanel`; Stage 5 `mountFloatingPanel` | Header close button posts a close message; header pointer movement posts bounded drag deltas; floating host retains extension-origin iframe isolation, top/right placement, viewport bounds, shadow, capture hide/restore handshake, and explicit unmount. Repeated remount removes the previous visibility listener before replacing the host. |

## Explicit exclusions

The following v1.0.0 integrations are visual-reference-only or excluded entirely and will not be copied into Community v1:

- Cloud login, auth modal, user/account menu, quotas, pricing, plans, and billing links.
- Analysis history/list and persisted reports.
- News tabs/search and website navigation.
- Multi-timeframe controls, timeframe switching, and multiple captures.
- Exchange/site selectors, exchange APIs, compatibility reports, and site adapters.
- Community backend connection/token layer and all Cloud/backend request messages.
- Legacy analysis envelopes, drawing adapters, report sanitizers/presentation adapters, and status-label transformations.

Provider requests instead consume the accepted Stage 2–4 direct interfaces; source intake consumes Stage 5; annotations consume Stages 6/6A.
