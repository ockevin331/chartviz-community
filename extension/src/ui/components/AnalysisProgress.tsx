import type { ProgressMessage } from '../state/use-analysis-controller';
import { translations, type Language } from './LanguageMenu';

function visibleProgress(progress: readonly ProgressMessage[]): ProgressMessage[] {
  const distinct = progress.filter((message, index) => index === 0 || progress[index - 1] !== message);
  return distinct.slice(-3);
}

export function AnalysisProgress({ language, progress, onCancel }: { language: Language; progress: ProgressMessage[]; onCancel(): void }) {
  const t = translations[language];
  const visible = visibleProgress(progress);
  return <><div className="analysis-activity" role="status" aria-live="polite">{visible.map((category, index) => {
    const current = index === visible.length - 1;
    return <p className={current ? 'current' : 'complete'} key={`${category}-${index}`}><span aria-hidden="true">{current ? <i className="activity-dots"><b /><b /><b /></i> : '✓'}</span>{t[category]}</p>;
  })}</div><button className="secondary cancel-analysis" type="button" onClick={onCancel}>{t.cancel}</button></>;
}
