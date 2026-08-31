# Security

Report vulnerabilities privately to the maintainers. Do not include API keys, authorization headers, raw provider bodies, screenshots containing sensitive information, or other secrets.

## Product and data boundary

ChartViz 1.0.2 is an open-source browser extension with no bundled account service, backend, website runtime, analytics, history, news, exchange-data feed, billing, or local-model runtime. Its optional Cloud mode talks only to the fixed ChartViz service origin and uses a user-created revocable access token.

Direct analysis uses one processed screenshot and three sequential provider requests. The screenshot is sent directly to the selected OpenRouter, OpenAI, or Gemini endpoint in the first two requests; normalized evidence rather than the image is sent in the third. Provider credentials are held only in `browser.storage.session` and must never reach page scripts, URLs, logs, telemetry, reports, downloads, copied diagnostics, local storage, or sync storage.

Multi-timeframe capture is capability-gated for ChartViz Cloud. The Cloud client validates account, capability, capture-setting, task, and report envelopes before use. It accepts one to three captured images, submits them only after an explicit analysis action, and stores the Cloud token in extension local storage so the connection survives browser restarts. Users can disconnect locally or revoke the token on the website.

The extension validates chart inputs, provider HTTP/response envelopes, staged evidence, and final report JSON. MV3 CSP limits executable code to the package. Manifest access includes `activeTab`, `storage`, `scripting`, the reviewed service/provider origins, and `<all_urls>`. Broad host access is used only to capture the currently visible tab after an explicit analysis action, including when a supported chart link opened the panel automatically; the extension does not take background screenshots. There is no optional host access, remote executable code, or custom provider origin.

## Threat and review boundary

Reviewed source, the frozen `pnpm-lock.yaml` graph, WXT/TypeScript output, browser extension globals, and the user's chosen model provider are trusted components. A compromised browser, build machine, registry, dependency publisher, provider, or approved malicious source is outside the automated verification model.

Release gates include focused behavior tests, TypeScript compilation, Chrome/Edge builds, exact parsed-manifest parity checks, package allow/deny listing, documentation consistency checks, and manual browser smoke tests. Package verification parses manifests, paths, and ZIP metadata; it does not prove arbitrary JavaScript semantics.

Block a release for Direct-provider credential exposure or persistence beyond the session boundary, Cloud-token exposure outside the dedicated connection store and authorization header, an undeclared runtime endpoint or permission, invalid untrusted-input handling, remote executable code, package/repository leakage, unintended Direct multi-timeframe behavior, or a real build/install/user-flow failure.

## Reporting guidance

Provide the extension version, browser/version, minimal reproduction steps, and sanitized public error code. Replace every secret with `<redacted>` before saving or sending evidence.
