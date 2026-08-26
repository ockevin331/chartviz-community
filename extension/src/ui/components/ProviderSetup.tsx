import { useMemo, useState } from 'react';
import { getDefaultModel, getModelsForProvider } from '../../providers/model-catalog';
import { ProviderError, type AnalysisErrorCode } from '../../providers/provider-errors';
import type { ProviderConfig, ProviderKind } from '../../providers/provider-types';
import { saveProviderConfig } from '../../storage/provider-session';
import { translations, type Language } from './LanguageMenu';

type Props = {
  language: Language;
  onConfigured(config: ProviderConfig): void;
  initialConfig?: ProviderConfig | null;
  saveConfig?: (config: ProviderConfig) => Promise<void>;
  testConnection(config: ProviderConfig, signal: AbortSignal): Promise<void>;
};

function localError(error: unknown, language: Language): string {
  const t = translations[language];
  if (error instanceof ProviderError) return t[error.code];
  const code = error instanceof Error ? error.message as AnalysisErrorCode : '';
  return code in t ? t[code as AnalysisErrorCode] : t.unknownError;
}

function EyeIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
}

function EyeOffIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 3 18 18" /><path d="M10.6 6.1A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.2 2.8M6.6 6.6C4 8.2 2.5 12 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 3.1-.5" /><path d="M10.2 10.2a2.5 2.5 0 0 0 3.6 3.6" /></svg>;
}

export function ProviderSetup({ language, onConfigured, initialConfig = null, saveConfig = saveProviderConfig, testConnection }: Props) {
  const [provider, setProvider] = useState<ProviderKind>(initialConfig?.provider ?? 'openrouter');
  const [apiKey, setApiKey] = useState(initialConfig?.apiKey ?? '');
  const [model, setModel] = useState(initialConfig?.model ?? getDefaultModel('openrouter')!.id);
  const [customModel, setCustomModel] = useState(initialConfig?.customModel ?? false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const t = translations[language];
  const models = useMemo(() => getModelsForProvider(provider), [provider]);
  const config = (): ProviderConfig => ({ provider, apiKey: apiKey.trim(), model: model.trim(), customModel });
  const valid = apiKey.trim() !== '' && model.trim() !== '' && (!customModel || acknowledged);

  function changeProvider(value: ProviderKind) {
    setProvider(value); setCustomModel(false); setAcknowledged(false); setModel(getDefaultModel(value)?.id ?? ''); setMessage(null);
  }

  async function connect() {
    if (!valid) return;
    setTesting(true); setMessage(null);
    try { await testConnection(config(), new AbortController().signal); setMessage({ kind: 'success', text: t.connectionOk }); }
    catch (error) { setMessage({ kind: 'error', text: localError(error, language) }); }
    finally { setTesting(false); }
  }

  async function save() {
    if (!valid) return;
    try { const value = config(); await saveConfig(value); onConfigured(value); }
    catch (error) { setMessage({ kind: 'error', text: localError(error, language) }); }
  }

  return <section className="provider-setup-card">
    <div className="setup-heading"><div><h2>{t.providerSetup}</h2><p>{t.providerSetupHelp}</p></div></div>
    <form className="provider-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>{t.provider}<select aria-label={t.provider} value={provider} onChange={(event) => changeProvider(event.target.value as ProviderKind)}><option value="openrouter">OpenRouter</option><option value="openai">OpenAI</option><option value="gemini">Gemini</option></select></label>
      <label>{t.model}<select aria-label={t.model} value={customModel ? '__custom__' : model} onChange={(event) => { if (event.target.value === '__custom__') { setCustomModel(true); setModel(''); } else { setCustomModel(false); setAcknowledged(false); setModel(event.target.value); } }}>{models.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}<option value="__custom__">{t.customModel}</option></select></label>
      <label className="custom-toggle"><input type="checkbox" aria-label={t.customModel} checked={customModel} onChange={(event) => { setCustomModel(event.target.checked); setAcknowledged(false); setModel(event.target.checked ? '' : getDefaultModel(provider)?.id ?? ''); }} />{t.customModel}</label>
      {customModel && <div className="custom-model-fields"><label>{t.customModelId}<input aria-label={t.customModelId} value={model} onChange={(event) => setModel(event.target.value)} /></label><p className="capture-warning" role="status">⚠ {t.multimodalWarning}</p><label className="acknowledgement"><input type="checkbox" checked={acknowledged} aria-label={t.multimodalAck} onChange={(event) => setAcknowledged(event.target.checked)} />{t.multimodalAck}</label></div>}
      <label>{t.apiKey}<span className="password-field"><input aria-label={t.apiKey} type={showKey ? 'text' : 'password'} autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><button type="button" aria-label={showKey ? t.hideApiKey : t.showApiKey} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOffIcon /> : <EyeIcon />}</button></span></label>
      <p className="cost-notice">{t.connectionCost}</p>
      {message && <p className={message.kind === 'error' ? 'setup-error' : 'setup-success'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <div className="provider-actions"><button className="secondary" type="button" disabled={!valid || testing} onClick={() => void connect()}>{testing ? t.testingConnection : t.testConnection}</button><button className="primary" type="submit" disabled={!valid}>{t.saveContinue}</button></div>
    </form>
  </section>;
}
