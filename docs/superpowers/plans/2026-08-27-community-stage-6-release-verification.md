# Community Stage 6 Release Verification Plan

> **For agentic workers:** Use `superpowers:executing-plans` and stop at the final review checkpoint. Do not publish, deploy, merge, or push.

**Goal:** Produce release-quality Chrome and Edge 1.0.0 builds, prove their manifest/package boundaries, and record supported/unsupported-page smoke evidence for the approved Cloud/Direct extension design.

**Architecture:** Treat the generated MV3 artifacts as the release source of truth. Automated gates validate source behavior, TypeScript, browser builds, exact manifest capabilities, package contents, and documentation consistency. Browser smoke checks exercise only public page guidance and configuration UI; no provider key, paid request, or unavailable Cloud transport is required.

**Spec:** `docs/superpowers/specs/2026-08-27-community-extension-cloud-direct-modes.md`

## Constraints

- Preserve the working Direct three-stage pipeline and the capability-gated Cloud/multi-timeframe boundary.
- Do not add a Cloud token field, Cloud endpoint, login, backend, history, or Direct multi-timeframe analysis.
- Do not publish, sign, deploy, merge, push, or create a GitHub release.
- Do not place real provider credentials, raw provider responses, or private screenshots in test or smoke evidence.
- Preserve unrelated pre-existing working-tree changes and stage only Stage 6 files.

## Task 1: Align the release manifest and package contract

- [ ] Add a failing package test for the panel HTML plus generated chunk/asset web resources.
- [ ] Update the package verifier's exact manifest allowlist and referenced-resource checks.
- [ ] Run package tests against fresh Chrome and Edge builds.
- [ ] Commit the focused release-contract change.

## Task 2: Align user and maintainer documentation

- [ ] Update README installation, Cloud/Direct, page guidance, and single/multi-timeframe behavior.
- [ ] Remove obsolete manual-upload, one-request, and no-multi-timeframe claims from contributor/security docs.
- [ ] Replace the stale manual smoke checklist with the approved no-secret Stage 6 page matrix plus optional provider checks.
- [ ] Run documentation consistency scans and `git diff --check`.
- [ ] Commit the documentation change.

## Task 3: Run the automated release gate

- [ ] Run the frozen install, repository tests, full extension tests, TypeScript compile, Chrome build, Edge build, package tests, package verifier, and whitespace check through `scripts/verify-release.sh`.
- [ ] Inspect both generated manifests for version, permissions, host scope, content-script scope, CSP, and Chrome/Edge parity.
- [ ] Verify no backend, source map, environment file, test, source, or repository metadata enters either artifact.

## Task 4: Perform supported/unsupported-page smoke checks

- [ ] Load the Chrome unpacked build and verify toolbar open/close plus full-height floating panel behavior.
- [ ] Verify a supported TradingView `/chart/` URL reaches chart detection/capture UI.
- [ ] Verify a supported-domain unsupported URL shows one clickable same-site BTC example.
- [ ] Verify an unsupported domain shows the ChartViz upload link and green supported-site links without an in-panel upload control.
- [ ] Verify a new configuration opens on unavailable Cloud and Direct mode exposes the existing provider/model/key controls.
- [ ] Record only sanitized PASS/FAIL evidence; leave Edge UI smoke pending if Edge control is unavailable.

## Task 5: Review checkpoint

- [ ] Report test/build/package results, exact artifact paths, smoke evidence, commits, and any remaining manual release work.
- [ ] Stop without starting Cloud API implementation or publishing.
