import { useId, useMemo, useState } from 'react';
import {
  findModelChoiceForConfig,
  getDefaultModelChoice,
  getModelChoice,
  modelChoices,
  resolveModelChoice,
  type ModelVendor,
} from '../../providers/model-catalog';
import { ProviderError, type AnalysisErrorCode } from '../../providers/provider-errors';
import { getProviderFailureDetail } from '../../providers/provider-diagnostics';
import type { ProviderConfig } from '../../providers/provider-types';
import { saveProviderConfig } from '../../storage/provider-session';
import { SettingsSaveError } from '../../storage/settings-save-error';
import { translations, type Language } from './LanguageMenu';
import { SelectMenu, type SelectOption } from './SelectMenu';

type Props = {
  language: Language;
  onConfigured?(config: ProviderConfig): void;
  initialConfig?: ProviderConfig | null;
  mode?: 'setup' | 'settings';
  saveConfig?: (config: ProviderConfig) => Promise<void>;
  testConnection(config: ProviderConfig, signal: AbortSignal): Promise<void>;
};

async function saveConfigAndContinue(config: ProviderConfig): Promise<void> {
  await saveProviderConfig(config);
}

function localError(error: unknown, language: Language): string {
  const t = translations[language];
  if (error instanceof SettingsSaveError) return t.settingsSaveInterrupted;
  if (error instanceof ProviderError) {
    const message = t[error.code];
    if (error.code !== 'provider_request_rejected') return message;
    const preview = getProviderFailureDetail(error)?.issues
      .find((issue) => issue.path === 'provider.http.error')?.valuePreview;
    return preview ? `${message} ${preview}` : message;
  }
  const code = error instanceof Error ? error.message as AnalysisErrorCode : '';
  return code in t ? t[code as AnalysisErrorCode] : t.unknownError;
}

function EyeIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
}

function EyeOffIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 3 18 18" /><path d="M10.6 6.1A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.2 2.8M6.6 6.6C4 8.2 2.5 12 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 3.1-.5" /><path d="M10.2 10.2a2.5 2.5 0 0 0 3.6 3.6" /></svg>;
}

function LockIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v2" /></svg>;
}

export function ProviderSetup({ language, onConfigured, initialConfig = null, mode = 'setup', saveConfig = saveConfigAndContinue, testConnection }: Props) {
  const privacyTitleId = useId();
  const initialChoice = findModelChoiceForConfig(initialConfig);
  const [selectedModelKey, setSelectedModelKey] = useState(initialChoice?.key ?? getDefaultModelChoice().key);
  const [useOpenRouter, setUseOpenRouter] = useState(initialConfig
    ? initialConfig.provider === 'openrouter'
    : true);
  const [apiKey, setApiKey] = useState(initialConfig?.apiKey ?? '');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const t = translations[language];
  const selectedChoice = getModelChoice(selectedModelKey);
  const openRouterRequired = !selectedChoice?.direct;
  const vendorLabels: Record<ModelVendor, string> = {
    openai: 'OpenAI', anthropic: 'Anthropic', qwen: 'Qwen',
  };
  const modelOptions = useMemo<readonly SelectOption<string>[]>(() =>
    modelChoices.map((item) => ({
      value: item.key,
      label: item.label,
      group: vendorLabels[item.vendor],
      description: item.description[language],
      badge: item.badge?.[language],
    })), [language]);

  function config(): ProviderConfig {
    const resolved = resolveModelChoice(selectedChoice ?? getDefaultModelChoice(), useOpenRouter);
    return { ...resolved, apiKey: apiKey.trim() };
  }

  const valid = apiKey.trim() !== '' && selectedChoice !== null;

  function changeModel(value: string) {
    setSelectedModelKey(value);
    const nextChoice = getModelChoice(value);
    if (!nextChoice?.direct) setUseOpenRouter(true);
    setMessage(null);
  }

  async function connect() {
    if (!valid) return;
    setTesting(true); setMessage(null);
    try { await testConnection(config(), new AbortController().signal); setMessage({ kind: 'success', text: t.connectionOk }); }
    catch (error) { setMessage({ kind: 'error', text: localError(error, language) }); }
    finally { setTesting(false); }
  }

  async function save() {
    if (!valid || saving) return;
    setSaving(true); setMessage(null);
    try {
      const value = config();
      await saveConfig(value);
      setMessage({ kind: 'success', text: t.settingsSaved });
      onConfigured?.(value);
    }
    catch (error) { setMessage({ kind: 'error', text: localError(error, language) }); }
    finally { setSaving(false); }
  }

  return <section className="provider-setup-card">
    <div className="setup-intro">
      <h2>{mode === 'settings' ? t.analysisSettings : t.providerSetup}</h2>
      <p>{mode === 'settings' ? t.analysisSettingsHelp : t.providerSetupHelp}</p>
      {mode === 'setup' && <ol className="setup-steps">
        <li>{t.setupChooseModel}</li>
        <li>{t.setupEnterKey}</li>
        <li>{t.setupDirectSend}</li>
      </ol>}
    </div>
    <form className="provider-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label><span>{t.model}</span><SelectMenu ariaLabel={t.model} value={selectedModelKey} options={modelOptions} onChange={changeModel} /></label>
      <div className="openrouter-row">
        <label>
          <input
            type="checkbox"
            checked={useOpenRouter || openRouterRequired}
            disabled={openRouterRequired}
            aria-label={t.useOpenRouter}
            onChange={(event) => { setUseOpenRouter(event.target.checked); setMessage(null); }}
          />
          <span><strong>{t.useOpenRouter}</strong><small>{openRouterRequired ? t.openRouterRequired : t.openRouterHelp}</small></span>
        </label>
      </div>
      <label>{t.apiKey}<span className="password-field"><input aria-label={t.apiKey} type={showKey ? 'text' : 'password'} autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><button type="button" aria-label={showKey ? t.hideApiKey : t.showApiKey} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOffIcon /> : <EyeIcon />}</button></span></label>
      <aside className="privacy-notice" role="note" aria-labelledby={privacyTitleId}>
        <span className="privacy-notice-icon"><LockIcon /></span>
        <span className="privacy-notice-copy">
          <strong id={privacyTitleId}>{t.privacyTitle}</strong>
          <span>{t.sessionKeyPrivacy}</span>
        </span>
      </aside>
      <p className="cost-notice">{t.analysisRequestNotice}</p>
      <p className="cost-notice">{t.connectionCost}</p>
      {message && <p className={message.kind === 'error' ? 'setup-error' : 'setup-success'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <div className="provider-actions"><button className="secondary" type="button" disabled={!valid || testing} onClick={() => void connect()}>{testing ? t.testingConnection : t.testConnection}</button><button className="primary" type="submit" disabled={!valid || saving}>{saving ? t.savingSettings : t.saveAndSetDefault}</button></div>
    </form>
  </section>;
}
