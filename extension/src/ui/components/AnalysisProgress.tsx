import type { ProgressMessage } from '../state/use-analysis-controller';
import { translations, type Language } from './LanguageMenu';

const categories: ProgressMessage[] = ['reading_chart', 'organizing_evidence', 'preparing_result'];

export function AnalysisProgress({ language, progress, onCancel }: { language: Language; progress: ProgressMessage[]; onCancel(): void }) {
  const t = translations[language];
  return <><div className="analysis-activity" role="status" aria-live="polite">{categories.map((category, index) => {
    const activeIndex = Math.max(0, progress.length - 1); const reached = progress.includes(category); const current = index === activeIndex;
    return <p className={current ? 'current' : reached ? 'complete' : ''} key={category}><span aria-hidden="true">{current ? <i className="activity-dots"><b /><b /><b /></i> : reached ? '✓' : '○'}</span>{t[category]}</p>;
  })}</div><button className="secondary cancel-analysis" type="button" onClick={onCancel}>{t.cancel}</button></>;
}
