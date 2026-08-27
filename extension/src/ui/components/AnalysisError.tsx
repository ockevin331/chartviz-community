import { useState } from 'react';
import type { AnalysisRuntimeErrorCode } from '../../analysis/runtime/analysis-runtime';
import type { AnalysisDiagnostic } from '../../providers/provider-diagnostics';
import { translations, type Language } from './LanguageMenu';

type Props = {
  language: Language;
  errorCode?: AnalysisRuntimeErrorCode | 'unknown' | null;
  cancelled?: boolean;
  diagnostic?: AnalysisDiagnostic | null;
  onBack(): void;
  copyText?: (value: string) => Promise<void>;
};

async function defaultCopyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function AnalysisError({ language, errorCode = 'unknown', cancelled = false, diagnostic = null, onBack, copyText = defaultCopyText }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = translations[language];
  const message = cancelled ? t.cancelled : errorCode && errorCode !== 'unknown' ? t[errorCode] : t.unknownError;
  const serialized = diagnostic ? JSON.stringify(diagnostic, null, 2) : '';
  return <section className={cancelled ? 'analysis-cancelled-message' : 'error'}>
    <p role={cancelled ? 'status' : 'alert'}>{message}</p>
    {diagnostic && <div className="diagnostic-actions">
      <button className="diagnostic-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? t.hideDiagnostics : t.viewDiagnostics}</button>
      {expanded && <div className="diagnostic-panel">
        <p>{t.diagnosticHelp}</p>
        <dl>
          <div><dt>{t.diagnosticSource}</dt><dd>{diagnostic.source}</dd></div>
          <div><dt>{t.pipelineVersion}</dt><dd>{diagnostic.pipelineVersion}</dd></div>
          <div><dt>{t.requestId}</dt><dd>{diagnostic.requestId}</dd></div>
          <div><dt>{t.failureStage}</dt><dd>{diagnostic.stage}</dd></div>
          <div><dt>{t.duration}</dt><dd>{diagnostic.durationMs} ms</dd></div>
          <div><dt>{t.issues}</dt><dd>{diagnostic.issues.length}</dd></div>
        </dl>
        {diagnostic.issues.length > 0 && <ul className="diagnostic-issues">{diagnostic.issues.map((issue, index) => <li key={`${issue.path}:${issue.code}:${index}`}>{issue.path || 'report'} · {issue.code}</li>)}</ul>}
        <button className="secondary" type="button" onClick={() => { void copyText(serialized).then(() => setCopied(true)); }}>{copied ? t.diagnosticsCopied : t.copyDiagnostics}</button>
      </div>}
    </div>}
    <button className="primary" type="button" onClick={onBack}>{cancelled ? t.backPreview : t.retry}</button>
  </section>;
}
