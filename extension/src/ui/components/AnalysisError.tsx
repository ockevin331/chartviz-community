import { ProviderError } from '../../providers/provider-errors';
import { translations, type Language } from './LanguageMenu';

export function AnalysisError({ language, error, cancelled = false, onBack }: { language: Language; error?: unknown; cancelled?: boolean; onBack(): void }) {
  const t = translations[language];
  const message = cancelled ? t.cancelled : error instanceof ProviderError ? t[error.code] : error instanceof Error ? error.message : t.unknownError;
  return <section className={cancelled ? 'analysis-cancelled-message' : 'error'}><p role={cancelled ? 'status' : 'alert'}>{message}</p><button className="primary" type="button" onClick={onBack}>{cancelled ? t.backPreview : t.retry}</button></section>;
}
