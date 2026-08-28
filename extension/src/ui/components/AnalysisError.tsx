import { useEffect, useState } from 'react';
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
  downloadText?: (name: string, value: string) => void;
};

async function defaultCopyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function defaultDownloadText(name: string, value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function AnalysisError({ language, errorCode = 'unknown', cancelled = false, diagnostic = null, onBack, copyText = defaultCopyText, downloadText = defaultDownloadText }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const t = translations[language];
  const messages = t as Record<string, string>;
  const message = cancelled
    ? t.cancelled
    : errorCode && errorCode !== 'unknown'
      ? (messages[errorCode] ?? t.unknownError)
      : t.unknownError;
  const serialized = diagnostic ? JSON.stringify(diagnostic, null, 2) : '';
  useEffect(() => {
    if (copyStatus !== 'success') return undefined;
    const timer = window.setTimeout(() => setCopyStatus('idle'), 3_000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  async function copyDiagnostic(): Promise<void> {
    setCopyStatus('idle');
    try {
      await copyText(serialized);
      setCopyStatus('success');
    } catch {
      setCopyStatus('error');
    }
  }

  return <section className={cancelled ? 'analysis-cancelled-message' : 'error'}>
    <p role={cancelled ? 'status' : 'alert'}>{message}</p>
    {diagnostic && <div className="diagnostic-actions">
      <button className="diagnostic-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? t.hideDiagnostics : t.viewDiagnostics}</button>
      {expanded && <div className="diagnostic-panel">
        <p>{t.diagnosticHelp}</p>
        <dl>
          <div><dt>{t.diagnosticSource}</dt><dd>{diagnostic.source}</dd></div>
          <div><dt>{t.pipelineVersion}</dt><dd>{diagnostic.pipelineVersion}</dd></div>
          <div><dt>{t.diagnosticProvider}</dt><dd>{diagnostic.provider}</dd></div>
          <div><dt>{t.diagnosticModel}</dt><dd>{diagnostic.model}</dd></div>
          <div><dt>{t.requestId}</dt><dd>{diagnostic.requestId}</dd></div>
          <div><dt>{t.occurredAt}</dt><dd>{diagnostic.occurredAt}</dd></div>
          <div><dt>{t.failureStage}</dt><dd>{diagnostic.stage}</dd></div>
          {diagnostic.httpStatus !== undefined && <div><dt>{t.httpStatus}</dt><dd>{diagnostic.httpStatus}</dd></div>}
          <div><dt>{t.duration}</dt><dd>{diagnostic.durationMs} ms</dd></div>
          <div><dt>{t.issues}</dt><dd>{diagnostic.issues.length}</dd></div>
        </dl>
        {diagnostic.issues.length > 0 && <ul className="diagnostic-issues">{diagnostic.issues.map((issue, index) => <li key={`${issue.path}:${issue.code}:${index}`}>{issue.path || 'report'} · {issue.code}{issue.valuePreview ? ` · “${issue.valuePreview}”` : ''}</li>)}</ul>}
        <details className="diagnostic-json">
          <summary>{t.completeDiagnostic}</summary>
          <pre>{serialized}</pre>
        </details>
        <div className="diagnostic-export-actions">
          <button className="secondary" type="button" onClick={() => void copyDiagnostic()}>{t.copyDiagnostics}</button>
          <button className="secondary" type="button" onClick={() => downloadText(`chartviz-diagnostic-${diagnostic.requestId}.json`, serialized)}>{t.downloadDiagnostics}</button>
        </div>
        {copyStatus === 'success' && <p className="diagnostic-copy-status success" role="status">{t.diagnosticsCopied}</p>}
        {copyStatus === 'error' && <p className="diagnostic-copy-status failure" role="alert">{t.diagnosticsCopyFailed}</p>}
      </div>}
    </div>}
    <button className="primary" type="button" onClick={onBack}>{cancelled ? t.backPreview : t.retry}</button>
  </section>;
}
