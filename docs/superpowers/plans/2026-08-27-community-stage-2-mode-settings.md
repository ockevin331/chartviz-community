# Community Extension Stage 2 Mode Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add truthful ChartViz Cloud and Direct model settings tabs, default new installations to Cloud, and migrate existing usable Direct configurations without changing Direct analysis.

**Architecture:** A local-storage module owns the non-secret active mode and performs migration from the session-only provider configuration. AnalysisModeSettings wraps the existing ProviderSetup; an unavailable Cloud gateway exposes only a stable availability result and accepts no credentials or screenshots. App loads configuration before mode migration and activates the current controller only for Direct.

**Tech Stack:** TypeScript 7, React 19, WXT 0.21, browser.storage.local/session, Vitest 4, Testing Library, Manifest V3.

**Spec:** docs/superpowers/specs/2026-08-27-community-extension-cloud-direct-modes.md

## Global Constraints

- Implement only delivery stage 2: mode settings, migration, persistence, and unavailable Cloud state.
- Do not add Cloud tokens, screenshot transport, authentication, task polling, quota, billing, or website changes.
- Direct keys remain only in browser.storage.session.
- Store the selected mode only in browser.storage.local under analysisMode.
- Existing usable Direct configurations migrate to direct when no valid mode exists.
- New installations with no mode and no Direct configuration default to cloud.
- Tab switching changes only the pending tab; Cloud cannot become active in this stage.
- Direct activates only after its current save flow succeeds.
- English and Simplified Chinese are required.
- Follow TDD and preserve unrelated dirty changes.

---

### Task 1: Analysis-mode storage and Direct migration

**Files:**
- Create: extension/src/analysis/analysis-mode.ts
- Create: extension/src/storage/analysis-mode-storage.ts
- Create: extension/tests/analysis-mode-storage.test.ts

**Interfaces:**
- Produce AnalysisMode = cloud | direct.
- Produce loadAnalysisMode(directConfig: ProviderConfig | null): Promise<AnalysisMode>.
- Produce saveAnalysisMode(mode: AnalysisMode): Promise<void>.

    export type AnalysisMode = 'cloud' | 'direct';

    export function isAnalysisMode(value: unknown): value is AnalysisMode {
      return value === 'cloud' || value === 'direct';
    }

    export async function loadAnalysisMode(
      directConfig: ProviderConfig | null,
    ): Promise<AnalysisMode>;

    export async function saveAnalysisMode(mode: AnalysisMode): Promise<void>;

- [ ] Write failing tests proving a new install returns cloud without writing storage; a usable Direct configuration returns direct and writes { analysisMode: direct }; a saved valid mode wins; malformed state migrates only with a Direct config; saving cloud writes no provider secret.

    expect(await loadAnalysisMode(null)).toBe('cloud');
    expect(browserMock.storage.local.set).not.toHaveBeenCalled();

    expect(await loadAnalysisMode(directConfig)).toBe('direct');
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      analysisMode: 'direct',
    });

- [ ] Run pnpm exec vitest run tests/analysis-mode-storage.test.ts and observe missing-module RED.
- [ ] Implement isAnalysisMode, bounded local-storage reads, migration, and validation. Invalid save input throws TypeError.
- [ ] Run the new tests plus tests/provider-session.test.ts, pnpm compile, and git diff --check.
- [ ] Commit only these files as feat(community): persist analysis mode.

---

### Task 2: Cloud/Direct mode settings component

**Files:**
- Create: extension/src/cloud/cloud-gateway.ts
- Create: extension/src/ui/components/AnalysisModeSettings.tsx
- Create: extension/tests/analysis-mode-settings.test.tsx
- Modify exact hunks: extension/src/i18n/en.ts
- Modify exact hunks: extension/src/i18n/zh-CN.ts
- Modify exact hunks: extension/entrypoints/panel/style.css

**Interfaces:**
- CloudAnalysisGateway.availability() returns exactly { available: false, code: cloud_not_available }.
- AnalysisModeSettings is controlled by selectedMode and onSelectedModeChange.
- Direct form behavior is delegated unchanged to ProviderSetup.

    export type CloudAvailability = Readonly<{
      available: false;
      code: 'cloud_not_available';
    }>;

    export interface CloudAnalysisGateway {
      availability(): CloudAvailability;
    }

    export type AnalysisModeSettingsProps = {
      language: Language;
      variant: 'setup' | 'settings';
      activeMode: AnalysisMode;
      selectedMode: AnalysisMode;
      onSelectedModeChange(mode: AnalysisMode): void;
      initialDirectConfig: ProviderConfig | null;
      saveDirectConfig(config: ProviderConfig): Promise<void>;
      saveMode(mode: AnalysisMode): Promise<void>;
      onDirectActivated(config: ProviderConfig): void;
      testConnection(config: ProviderConfig, signal: AbortSignal): Promise<void>;
      cloudGateway: CloudAnalysisGateway;
    };

- [ ] Write failing tests: Cloud-selected render has tab semantics, unavailable copy, and https://www.chartviz.xyz/ link; it has no API-key/password/token/connect input. Switching to Direct exposes the real model selector, OpenRouter checkbox, API key, test action, and save action. Merely switching tabs invokes no persistence. Add Chinese assertions.

    expect(screen.getByRole('tab', { name: 'ChartViz Cloud' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(
      'Cloud connection will be enabled in a later update.',
    )).toBeTruthy();
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();

- [ ] Run tests/analysis-mode-settings.test.tsx and tests/provider-setup.test.tsx and observe RED.
- [ ] Implement a no-input unavailableCloudGateway. Its interface must expose no token, connect, upload, analyze, fetch, or screenshot argument.
- [ ] Implement two role=tab buttons and one role=tabpanel. Direct save must call saveDirectConfig(config), then saveMode(direct); only then may ProviderSetup invoke onDirectActivated(config).
- [ ] Add localized keys:
  - chartVizCloud: ChartViz Cloud / ChartViz Cloud
  - directModel: Direct model / 直连模型
  - cloudSetupTitle: Managed chart analysis / 托管式图表分析
  - cloudSetupHelp: Use ChartViz Cloud without managing provider keys in the extension. / 使用 ChartViz Cloud，无需在插件中管理模型密钥。
  - cloudMultiTimeframe: Multi-timeframe analysis is provided through ChartViz Cloud. / 多周期分析由 ChartViz Cloud 提供。
  - cloudUnavailable: Cloud connection will be enabled in a later update. / Cloud 连接将在后续版本开放。
  - visitChartViz: Visit ChartViz / 访问 ChartViz
  - analysisMode: Analysis mode / 分析模式
- [ ] Style a compact dark two-tab control and neutral unavailable state.
- [ ] Run focused tests, compile, diff check, and commit exact hunks as feat(community): add cloud and direct settings tabs.

---

### Task 3: App bootstrap, migration, and active-mode behavior

**Files:**
- Modify exact hunks: extension/entrypoints/panel/App.tsx
- Modify exact hunks: extension/tests/panel-workflow.test.tsx

**Interfaces:**
- Consume loadAnalysisMode(config), saveAnalysisMode(mode), AnalysisModeSettings, and unavailableCloudGateway.
- Add AppDependencies loadMode(config), saveMode(mode), and cloudGateway.
- Preserve Direct capture, analysis, diagnostics, settings, drag, close, refresh, and language behavior.

    loadMode(config: ProviderConfig | null): Promise<AnalysisMode>;
    saveMode(mode: AnalysisMode): Promise<void>;
    cloudGateway: CloudAnalysisGateway;

- [ ] Add failing tests for: new install defaults to Cloud without chart inspection; existing Direct config opens chart capture; saved Direct with missing session config opens the Direct setup form; settings opens on active Direct and inspecting Cloud does not save or clear configuration; Direct activation persists config then mode before entering source state.
- [ ] Give every existing App test a deterministic loadMode dependency; save tests receive saveMode.
- [ ] Run tests/panel-workflow.test.tsx and observe RED.
- [ ] Bootstrap in strict order: await loadConfig(), then await loadMode(config). Configure the controller only for mode direct with a usable config.

    const config = await dependencies.loadConfig();
    const mode = await dependencies.loadMode(config);
    if (mode === 'direct' && config) controller.configure(config);

- [ ] Render AnalysisModeSettings in setup and settings. Settings resets its selected tab to activeMode whenever opened. Cloud selection never changes activeMode.
- [ ] Successful initial Direct activation calls controller.configure. Saving Direct while already active calls controller.updateConfig; a change from a non-Direct state calls controller.configure.
- [ ] Run focused tests: panel workflow, mode settings, ProviderSetup, and analysis controller.
- [ ] Run pnpm test, pnpm compile, pnpm build, pnpm build:edge, and git diff --check.
- [ ] Commit exact hunks as feat(community): bootstrap cloud and direct modes.
- [ ] Stop before Stage 3 for user review.

## Stage 2 review checklist

1. New install opens Cloud with no token input or connect button.
2. Direct tab retains the complete current setup.
3. Existing Direct session opens chart capture directly.
4. Settings opens on active Direct; inspecting Cloud does not activate it.
5. No Cloud request, screenshot, key, or token is emitted.
6. Chrome and Edge builds pass.
