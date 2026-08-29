# Contributing

Keep each change focused and write a failing behavior test before implementation changes. The Community product root is `extension/`; do not add a backend, website runtime, account/login flow, analytics, history, news, exchange/market-data feeds, billing, or a local-model integration without a separately approved design.

The accepted runtime boundary is:

- Direct analysis is single-timeframe and uses one captured screenshot plus three sequential requests to the selected provider.
- Multi-timeframe capture belongs only to a runtime advertising the ChartViz Cloud capability; production 1.0.1 Cloud is unavailable and must accept no token or screenshot.
- Direct provider keys remain in `browser.storage.session` and never enter content scripts, URLs, logs, reports, downloads, copied diagnostics, local storage, or sync storage.
- Runtime origins are fixed to reviewed OpenRouter, OpenAI, and Gemini endpoints; custom model IDs never imply custom API origins.
- MV3 code is packaged locally, permissions remain minimal, supported-site content matches come from the public site registry, and no `<all_urls>`, optional host access, or remote code is allowed.
- Provider envelopes, staged evidence, and final report data are validated before rendering.

Before opening a change, run the canonical gate from any working directory:

```bash
bash /path/to/chartviz/scripts/verify-release.sh
```

The gate performs the frozen install, repository and extension tests, TypeScript compilation, Chrome and Edge builds, documentation/package tests, exact manifest/package verification, and `git diff --check`. Both browser builds must exist before package tests run.

Do not put real provider keys, authorization headers, secret-bearing prompts, raw provider bodies, or private chart screenshots in fixtures, logs, issues, or smoke-test evidence. Packaging, signing, publishing, deployment, and GitHub releases require separate explicit maintainer approval.
