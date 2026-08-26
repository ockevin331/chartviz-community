import { useState } from 'react';
import type { CommunityReport, Scenario } from '../../analysis/community-report';
import type { AnnotatedReportImages } from '../../annotations/annotation-types';
import type { ProcessedImage } from '../../capture/image-types';
import { copyReport as defaultCopyReport, reportToText } from '../export/copy-report';
import { AnnotatedImage } from './AnnotatedImage';
import { ImageLightbox, type LightboxImage } from './ImageLightbox';
import { translations, type Language } from './LanguageMenu';

type Props = { language: Language; report: CommunityReport; original: ProcessedImage; annotations: AnnotatedReportImages; downloadImage?: (dataUrl: string, filename: string) => void; copyReport?: (text: string) => Promise<void> };

function EvidenceRefs({ context, evidenceIds, language, report }: { context: string; evidenceIds: string[]; language: Language; report: CommunityReport }) {
  const t = translations[language];
  if (evidenceIds.length === 0) return null;
  return <div className="evidence-refs" data-evidence-context={context} aria-label={t.evidence}>
    {evidenceIds.map((id) => {
      const index = report.evidence.findIndex((item) => item.id === id);
      const evidence = report.evidence[index];
      return <span className="evidence-chip" key={id} title={evidence?.observation}>{t.evidence} {index + 1}</span>;
    })}
  </div>;
}

function ScenarioCard({ context, title, scenario, language, report }: { context: string; title: string; scenario: Scenario; language: Language; report: CommunityReport }) {
  const t = translations[language];
  return <article className="scenario"><h3>{title}</h3><p><b>{t.condition}:</b> {scenario.condition}</p><p><b>{t.entry}:</b> {scenario.entry}</p><p><b>{t.stop}:</b> {scenario.stop}</p><div><b>{t.targets}:</b>{scenario.targets.length > 0 ? <ul>{scenario.targets.map((target) => <li key={target}>{target}</li>)}</ul> : ` ${t.none}`}</div><p><b>{t.reason}:</b> {scenario.reason}</p><EvidenceRefs context={context} evidenceIds={scenario.evidenceIds} language={language} report={report} /></article>;
}

export function ReportView({ language, report, original, annotations, downloadImage, copyReport = defaultCopyReport }: Props) {
  const t = translations[language];
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [copied, setCopied] = useState(false);
  const zoom = (image: LightboxImage) => setLightbox(image);
  return <div className="report-view">
    <section className="original-screenshot"><div className="section-heading"><h2>{t.original}</h2><button className="secondary copy-report" type="button" onClick={async () => { await copyReport(reportToText(report, language)); setCopied(true); }}>{copied ? t.copied : t.copyReport}</button></div><AnnotatedImage language={language} image={{ dataUrl: original.dataUrl, title: t.original }} filename="chartviz-original.png" onZoom={zoom} downloadImage={downloadImage} /></section>
    <section data-report-section="chart"><h2>{t.chart}</h2><dl className="metadata"><div><dt>{t.instrument}</dt><dd>{report.chart.instrument ?? t.none}</dd></div><div><dt>{t.timeframe}</dt><dd>{report.chart.timeframe ?? t.none}</dd></div>{report.chart.limitations.length > 0 && <div><dt>{t.limitations}</dt><dd>{report.chart.limitations.join(' · ')}</dd></div>}</dl></section>
    <section className={`decision decision-${report.marketView.bias}`} data-report-section="marketView"><h2>{t.marketView}</h2><div className="grid"><article><span>{t.bias}</span><strong>{report.marketView.bias}</strong></article><article><span>{t.phase}</span><strong>{report.marketView.phase}</strong></article><article><span>{t.strength}</span><strong>{report.marketView.strength}</strong></article></div><p className="decision-summary">{report.marketView.summary}</p><EvidenceRefs context="marketView" evidenceIds={report.marketView.evidenceIds} language={language} report={report} /></section>
    <section data-report-section="evidence"><h2>{t.evidence}</h2><div className="analysis-list">{report.evidence.map((item, index) => <article key={item.id}><header><b>{t.evidence} {index + 1} · {item.category}</b><span>{Math.round(item.confidence * 100)}%</span></header><p><b>{t.observation}:</b> {item.observation}</p><p><b>{t.implication}:</b> {item.implication}</p><footer>{t.visibleAt}: {item.timeAnchor}</footer></article>)}</div></section>
    {report.volume && <section data-report-section="volume"><h2>{t.volume}</h2><p>{report.volume.summary}</p><EvidenceRefs context="volume" evidenceIds={report.volume.evidenceIds} language={language} report={report} /></section>}
    {report.indicators.length > 0 && <section data-report-section="indicators"><h2>{t.indicators}</h2><div className="analysis-list">{report.indicators.map((item, index) => <article key={`${item.name}-${index}`}><b>{item.name}</b><p>{item.summary}</p><p><b>{t.implication}:</b> {item.implication}</p><EvidenceRefs context={`indicator-${item.name}`} evidenceIds={item.evidenceIds} language={language} report={report} /></article>)}</div></section>}
    {report.levels.length > 0 && <section data-report-section="levels"><h2>{t.supportResistance}</h2><div className="level-list visual-levels">{report.levels.map((level) => <article className={level.type} key={level.id}><span>{level.type}</span><strong>{level.priceLabel}</strong><p>{level.reason}</p><small>{level.timeAnchor}</small><EvidenceRefs context={`level-${level.id}`} evidenceIds={level.evidenceIds} language={language} report={report} /></article>)}</div>{annotations.levels && <div className="level-annotation"><AnnotatedImage language={language} image={annotations.levels} filename="chartviz-levels.png" onZoom={zoom} downloadImage={downloadImage} /></div>}</section>}
    <section data-report-section="scenarios"><h2>{t.scenarios}</h2><ScenarioCard context="scenario-long" title={t.long} scenario={report.scenarios.long} language={language} report={report} /><ScenarioCard context="scenario-short" title={t.short} scenario={report.scenarios.short} language={language} report={report} /><article className="scenario"><h3>{t.wait}</h3><p><b>{t.condition}:</b> {report.scenarios.wait.condition}</p><p><b>{t.reason}:</b> {report.scenarios.wait.reason}</p><EvidenceRefs context="scenario-wait" evidenceIds={report.scenarios.wait.evidenceIds} language={language} report={report} /></article></section>
    {report.patterns.length > 0 && <section className="report-section pattern-section" data-report-section="patterns"><h2>{t.patterns}</h2>{report.patterns.map((pattern) => <article className="pattern" data-pattern-id={pattern.id} key={pattern.id}><h3>{pattern.name}<span>{pattern.status} · {pattern.bias} · {Math.round(pattern.confidence * 100)}%</span></h3><p><b>{t.timeRange}:</b> {pattern.timeRange}</p><p>{pattern.explanation}</p><EvidenceRefs context={`pattern-${pattern.id}`} evidenceIds={pattern.evidenceIds} language={language} report={report} />{annotations.patterns[pattern.id] && <div className="pattern-annotation"><AnnotatedImage language={language} image={annotations.patterns[pattern.id]!} filename={`chartviz-pattern-${pattern.id}.png`} onZoom={zoom} downloadImage={downloadImage} /></div>}</article>)}</section>}
    {report.signals.length > 0 && <section data-report-section="signals"><h2>{t.signals}</h2><div className="trade-signals">{report.signals.map((signal) => <article className={signal.direction} data-signal-id={signal.id} key={signal.id}><header><b>{signal.id} · {signal.direction}</b><span>{Math.round(signal.confidence * 100)}%</span></header><p><b>{t.visibleAt}:</b> {signal.timeAnchor}</p><p><b>{t.reason}:</b> {signal.reason}</p><p><b>{t.entry}:</b> {signal.entry.priceLabel}</p><p><b>{t.stop}:</b> {signal.stop.priceLabel}</p><p><b>{t.targets}:</b> {signal.targets.map(({ priceLabel }) => priceLabel).join(' · ')}</p><p><b>{t.riskReward}:</b> {signal.riskReward ?? t.none}</p><EvidenceRefs context={`signal-${signal.id}`} evidenceIds={signal.evidenceIds} language={language} report={report} />{annotations.signals[signal.id] && <div className="signal-annotation"><AnnotatedImage language={language} image={annotations.signals[signal.id]!} filename={`chartviz-signal-${signal.id}.png`} onZoom={zoom} downloadImage={downloadImage} /></div>}</article>)}</div></section>}
    <footer className="risk-notice" data-report-section="riskNotice"><b>{t.riskNotice}:</b> {report.riskNotice}</footer>
    {lightbox && <ImageLightbox image={lightbox} language={language} onClose={() => setLightbox(null)} />}
  </div>;
}
