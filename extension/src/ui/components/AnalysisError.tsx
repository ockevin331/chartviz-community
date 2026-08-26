import type { AnalysisErrorCode } from '../../providers/provider-errors';
import { translations, type Language } from './LanguageMenu';

export function AnalysisError({ language, errorCode = 'unknown', cancelled = false, onBack }: { language: Language; errorCode?: AnalysisErrorCode | 'unknown' | null; cancelled?: boolean; onBack(): void }) {
  const t = translations[language];
  const message = cancelled ? t.cancelled : errorCode && errorCode !== 'unknown' ? t[errorCode] : t.unknownError;
  return <section className={cancelled ? 'analysis-cancelled-message' : 'error'}><p role={cancelled ? 'status' : 'alert'}>{message}</p><button className="primary" type="button" onClick={onBack}>{cancelled ? t.backPreview : t.retry}</button></section>;
}
