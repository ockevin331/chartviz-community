import { useId, useState } from 'react';
import type { AnalysisMode } from '../../analysis/analysis-mode';
import type { CloudConnectionState } from '../../cloud/cloud-connection';
import { CLOUD_API_BASE_URL } from '../../cloud/cloud-client';
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
  activateDirect(config: ProviderConfig): Promise<boolean>;
  testConnection(config: ProviderConfig, signal: AbortSignal): Promise<void>;
  cloudConnection: CloudConnectionState;
  cloudBusy: boolean;
  onCloudConnect(token: string): Promise<boolean>;
  onCloudActivate(): Promise<boolean>;
  onCloudDisconnect(): Promise<void>;
};

export function AnalysisModeSettings({
  language,
  variant,
  activeMode,
  selectedMode,
  onSelectedModeChange,
  initialDirectConfig,
  activateDirect,
  testConnection,
  cloudConnection,
  cloudBusy,
  onCloudConnect,
  onCloudActivate,
  onCloudDisconnect,
}: AnalysisModeSettingsProps) {
  const t = translations[language];
  const [cloudToken, setCloudToken] = useState('');
  const cloudTabId = useId();
  const directTabId = useId();
  const panelId = useId();

  async function connectCloud() {
    const token = cloudToken.trim();
    if (!token || cloudBusy) return;
    if (await onCloudConnect(token)) setCloudToken('');
  }

  function closePanelForWebsite() {
    window.parent.postMessage({ source: 'chartviz', type: 'panel-close' }, '*');
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
          <label><span>{t.cloudApiUrl}</span><input value={CLOUD_API_BASE_URL} readOnly aria-readonly="true" /></label>
          {cloudError && <p className="cloud-unavailable" role="alert">{cloudError}</p>}
          {cloudAccount ? <>
            <section className="cloud-account-summary">
              <header><strong>{t.cloudConnected}</strong><span>{cloudAccount.emailMasked}</span></header>
              {activeMode === 'cloud' && <span className="current-default">{t.currentDefault}</span>}
              <dl>
                <div><dt>{t.cloudPlan}</dt><dd>{cloudAccount.plan.toUpperCase()}</dd></div>
                {expiry && <div><dt>{t.cloudPlanExpires}</dt><dd>{expiry}</dd></div>}
                <div><dt>{t.cloudQuota}</dt><dd>{cloudAccount.quota.unlimited ? t.cloudUnlimited : `${cloudAccount.quota.remaining ?? 0} / ${cloudAccount.quota.limit ?? 0}`}</dd></div>
                <div><dt>{t.cloudModel}</dt><dd>{cloudAccount.selectedModel.name}</dd></div>
              </dl>
              <p>{t.cloudMultiDisabled}</p>
            </section>
            {activeMode !== 'cloud' && <button className="primary" type="button" disabled={cloudBusy} onClick={() => void onCloudActivate()}>{t.setCloudDefault}</button>}
            <button className="secondary" type="button" disabled={cloudBusy} onClick={() => void onCloudDisconnect()}>{t.cloudDisconnect}</button>
            <small className="cloud-disconnect-help">{t.cloudDisconnectHelp}</small>
            <a href="https://www.chartviz.xyz/settings" target="_blank" rel="noreferrer" onClick={closePanelForWebsite}>{t.cloudTokenWebsite}</a>
          </> : <form className="cloud-token-form" onSubmit={(event) => { event.preventDefault(); void connectCloud(); }}>
            <label><span>{t.cloudToken}</span><input type="password" autoComplete="off" value={cloudToken} disabled={cloudBusy} onChange={(event) => setCloudToken(event.target.value)} /></label>
            <small>{t.cloudTokenHelp}</small>
            <a href="https://www.chartviz.xyz/settings" target="_blank" rel="noreferrer" onClick={closePanelForWebsite}>{t.cloudTokenWebsite}</a>
            <button className="primary" type="submit" disabled={cloudBusy || !cloudToken.trim()}>{cloudBusy ? t.cloudConnecting : t.cloudConnect}</button>
          </form>}
        </section>
        : <ProviderSetup language={language} mode={variant} initialConfig={initialDirectConfig} saveConfig={activateDirect} testConnection={testConnection} />}
    </div>
  </section>;
}
