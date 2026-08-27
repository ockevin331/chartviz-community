import { useId } from 'react';
import type { AnalysisMode } from '../../analysis/analysis-mode';
import type { CloudAnalysisGateway } from '../../cloud/cloud-gateway';
import type { ProviderConfig } from '../../providers/provider-types';
import { translations, type Language } from './LanguageMenu';
import { ProviderSetup } from './ProviderSetup';

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

export function AnalysisModeSettings({
  language,
  variant,
  activeMode,
  selectedMode,
  onSelectedModeChange,
  initialDirectConfig,
  saveDirectConfig,
  saveMode,
  onDirectActivated,
  testConnection,
  cloudGateway,
}: AnalysisModeSettingsProps) {
  const t = translations[language];
  const cloudTabId = useId();
  const directTabId = useId();
  const panelId = useId();
  const availability = cloudGateway.availability();

  async function saveDirect(config: ProviderConfig) {
    await saveDirectConfig(config);
    await saveMode('direct');
  }

  return <section className="analysis-mode-settings">
    <div className="analysis-mode-tabs" role="tablist" aria-label={t.analysisMode}>
      <button id={cloudTabId} type="button" role="tab" aria-selected={selectedMode === 'cloud'} aria-current={activeMode === 'cloud' ? 'true' : undefined} aria-controls={panelId} onClick={() => onSelectedModeChange('cloud')}>{t.chartVizCloud}</button>
      <button id={directTabId} type="button" role="tab" aria-selected={selectedMode === 'direct'} aria-current={activeMode === 'direct' ? 'true' : undefined} aria-controls={panelId} onClick={() => onSelectedModeChange('direct')}>{t.directModel}</button>
    </div>
    <div id={panelId} role="tabpanel" aria-labelledby={selectedMode === 'cloud' ? cloudTabId : directTabId}>
      {selectedMode === 'cloud'
        ? <section className="cloud-mode-card">
          <div><h2>{t.cloudSetupTitle}</h2><p>{t.cloudSetupHelp}</p></div>
          <p className="cloud-timeframe-note">{t.cloudMultiTimeframe}</p>
          {!availability.available && <p className="cloud-unavailable" role="status">{t.cloudUnavailable}</p>}
          <a href="https://www.chartviz.xyz/" target="_blank" rel="noreferrer">{t.visitChartViz}</a>
        </section>
        : <ProviderSetup language={language} mode={variant} initialConfig={initialDirectConfig} saveConfig={saveDirect} onConfigured={onDirectActivated} testConnection={testConnection} />}
    </div>
  </section>;
}
