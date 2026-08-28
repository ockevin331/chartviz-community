import { useId, useState } from 'react';
import type { AnalysisMode } from '../../analysis/analysis-mode';
import type { CloudConnectionState } from '../../cloud/cloud-connection';
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
  cloudConnection: CloudConnectionState;
  cloudBusy: boolean;
  onCloudConnect(token: string): Promise<boolean>;
  onCloudDisconnect(): Promise<void>;
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
  cloudConnection,
  cloudBusy,
  onCloudConnect,
  onCloudDisconnect,
}: AnalysisModeSettingsProps) {
  const t = translations[language];
  const [cloudToken, setCloudToken] = useState('');
  const cloudTabId = useId();
  const directTabId = useId();
  const panelId = useId();

  async function saveDirect(config: ProviderConfig) {
    await saveDirectConfig(config);
    await saveMode('direct');
  }

  async function connectCloud() {
    const token = cloudToken.trim();
    if (!token || cloudBusy) return;
    if (await onCloudConnect(token)) setCloudToken('');
  }

  const cloudError = cloudConnection.status === 'error'
    ? ({
        authentication_required: t.cloudErrorAuthentication,
        invalid_token: t.cloudErrorInvalid,
        token_revoked: t.cloudErrorRevoked,
        token_expired: t.cloudErrorExpired,
        insufficient_scope: t.cloudErrorScope,
      } as Partial<Record<string, string>>)[cloudConnection.errorCode] ?? t.cloudErrorService
    : null;
  const cloudAccount = cloudConnection.account;
  const expiry = cloudAccount?.currentPeriodEnd
    ? new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
        dateStyle: 'medium',
      }).format(new Date(cloudAccount.currentPeriodEnd))
    : null;

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
          {cloudError && <p className="cloud-unavailable" role="alert">{cloudError}</p>}
          {cloudAccount ? <>
            <section className="cloud-account-summary">
              <header><strong>{t.cloudConnected}</strong><span>{cloudAccount.emailMasked}</span></header>
              <dl>
                <div><dt>{t.cloudPlan}</dt><dd>{cloudAccount.plan.toUpperCase()}</dd></div>
                {expiry && <div><dt>{t.cloudPlanExpires}</dt><dd>{expiry}</dd></div>}
                <div><dt>{t.cloudQuota}</dt><dd>{cloudAccount.quota.unlimited ? t.cloudUnlimited : `${cloudAccount.quota.remaining ?? 0} / ${cloudAccount.quota.limit ?? 0}`}</dd></div>
                <div><dt>{t.cloudModel}</dt><dd>{cloudAccount.selectedModel.name}</dd></div>
              </dl>
              <p>{cloudAccount.entitlements.multiTimeframe ? t.cloudMultiEnabled : t.cloudMultiDisabled}</p>
            </section>
            <p className="cloud-stage-notice">{t.cloudC1Notice}</p>
            <button className="secondary" type="button" disabled={cloudBusy} onClick={() => void onCloudDisconnect()}>{t.cloudDisconnect}</button>
            <small className="cloud-disconnect-help">{t.cloudDisconnectHelp}</small>
          </> : <form className="cloud-token-form" onSubmit={(event) => { event.preventDefault(); void connectCloud(); }}>
            <label><span>{t.cloudToken}</span><input type="password" autoComplete="off" value={cloudToken} disabled={cloudBusy} onChange={(event) => setCloudToken(event.target.value)} /></label>
            <small>{t.cloudTokenHelp}</small>
            <button className="primary" type="submit" disabled={cloudBusy || !cloudToken.trim()}>{cloudBusy ? t.cloudConnecting : t.cloudConnect}</button>
          </form>}
          <a href="https://www.chartviz.xyz/settings" target="_blank" rel="noreferrer">{t.cloudTokenWebsite}</a>
        </section>
        : <ProviderSetup language={language} mode={variant} initialConfig={initialDirectConfig} saveConfig={saveDirect} onConfigured={onDirectActivated} testConnection={testConnection} />}
    </div>
  </section>;
}
