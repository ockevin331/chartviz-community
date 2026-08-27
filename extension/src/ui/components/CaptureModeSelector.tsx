import { useState } from 'react';
import type { AnalysisCapabilities } from '../../analysis/runtime/analysis-runtime';
import { translations, type Language } from './LanguageMenu';

export type CaptureMode = 'single' | 'multi';

export type CaptureModeSelectorProps = {
  language: Language;
  mode: CaptureMode;
  capabilities: AnalysisCapabilities;
  siteSupportsMultiTimeframe: boolean;
  disabled?: boolean;
  onModeChange(mode: CaptureMode): void;
  onOpenCloudSettings(): void;
};

type Notice = 'cloud' | 'site' | null;

export function CaptureModeSelector({
  language,
  mode,
  capabilities,
  siteSupportsMultiTimeframe,
  disabled = false,
  onModeChange,
  onOpenCloudSettings,
}: CaptureModeSelectorProps) {
  const t = translations[language];
  const [notice, setNotice] = useState<Notice>(null);
  const runtimeSupportsMulti = capabilities.multiTimeframe && capabilities.maxTimeframes > 1;

  function selectSingle() {
    setNotice(null);
    onModeChange('single');
  }

  function selectMulti() {
    if (!runtimeSupportsMulti) {
      setNotice('cloud');
      return;
    }
    if (!siteSupportsMultiTimeframe) {
      setNotice('site');
      return;
    }
    setNotice(null);
    onModeChange('multi');
  }

  return <div className="capture-mode-selector">
    <h3>{t.screenshotMode}</h3>
    <div className="capture-mode-cards" role="group" aria-label={t.screenshotMode}>
      <button
        type="button"
        disabled={disabled}
        className={mode === 'single' ? 'active' : ''}
        aria-pressed={mode === 'single'}
        onClick={selectSingle}
      >
        <strong>{t.singleTimeframe}</strong>
        <span>{t.currentChart}</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        className={mode === 'multi' ? 'active' : ''}
        aria-pressed={mode === 'multi'}
        aria-disabled={runtimeSupportsMulti && !siteSupportsMultiTimeframe ? 'true' : undefined}
        onClick={selectMulti}
      >
        <strong>{t.multiTimeframe}</strong>
        <span className="capture-role-list">
          <span><small>{t.contextRole}</small><b>4h</b></span>
          <span><small>{t.setupRole}</small><b>1h</b></span>
          <span><small>{t.triggerRole}</small><b>15m</b></span>
        </span>
      </button>
    </div>
    {notice && <div className="capture-mode-notice" role="status">
      <span>{notice === 'cloud' ? t.multi_timeframe_requires_cloud : t.multiTimeframeSiteUnsupported}</span>
      {notice === 'cloud' && <button type="button" onClick={onOpenCloudSettings}>{t.openCloudSettings}</button>}
    </div>}
  </div>;
}
