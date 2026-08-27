import { useState } from 'react';
import type { CommunityReportV3, CommunityScenarioV3 } from '../../analysis/stages/community-report-v3-schema';
import type { AnnotatedReportImages } from '../../annotations/annotation-types';
import type { ProcessedImage } from '../../capture/image-types';
import { copyReport as defaultCopyReport, reportToText } from '../export/copy-report';
import { AnnotatedImage } from './AnnotatedImage';
import { ImageLightbox, type LightboxImage } from './ImageLightbox';
import { translations, type Language } from './LanguageMenu';

type Props = {
  language: Language;
  report: CommunityReportV3;
  original: ProcessedImage;
  annotations: AnnotatedReportImages;
  downloadImage?: (dataUrl: string, filename: string) => void;
  copyReport?: (text: string) => Promise<void>;
};

const zhMetrics: Record<string, string> = {
  long: '做多', short: '做空', wait: '等待', bullish: '上涨', bearish: '下跌', sideways: '震荡', unclear: '不明确',
  'hh-hl': '高点和低点逐步抬高', 'lh-ll': '高点和低点逐步降低', range: '区间震荡', transition: '转折阶段',
  strong: '强', moderate: '中等', weak: '弱', support: '支撑', resistance: '阻力', nearest: '最近', secondary: '次要', major: '主要',
  holding: '有效', testing: '测试中', broken: '已突破', flip_candidate: '可能转换', forming: '形成中', confirmed: '已确认', invalidated: '已失效', neutral: '中性',
};

const enMetrics: Record<string, string> = {
  long: 'LONG', short: 'SHORT', sideways: 'SIDEWAYS', wait: 'WAIT',
  bullish: 'Bullish', bearish: 'Bearish', unclear: 'Unclear',
  'hh-hl': 'Higher highs and higher lows', 'lh-ll': 'Lower highs and lower lows',
  range: 'Range', transition: 'Transition', strong: 'Strong', moderate: 'Moderate', weak: 'Weak',
  support: 'Support', resistance: 'Resistance', nearest: 'Nearest', secondary: 'Secondary', major: 'Major',
  holding: 'Holding', testing: 'Testing', broken: 'Broken', flip_candidate: 'Possible role reversal',
  forming: 'Forming', confirmed: 'Confirmed', invalidated: 'Invalidated', neutral: 'Neutral',
};

function metric(value: string, language: Language): string {
  return language === 'zh-CN' ? zhMetrics[value] ?? value : enMetrics[value] ?? value.replaceAll('_', ' ');
}

function ScenarioCard({ title, scenario, language }: { title: string; scenario: CommunityScenarioV3; language: Language }) {
  const t = translations[language];
  return <article className="scenario"><h3>{title}</h3><p><b>{t.condition}:</b> {scenario.condition}</p><p><b>{t.entry}:</b> {scenario.entry}</p><p><b>{t.stop}:</b> {scenario.stop}</p><div><b>{t.targets}:</b><ul>{scenario.targets.map((target) => <li key={target}>{target}</li>)}</ul></div><p><b>{t.reason}:</b> {scenario.reason}</p></article>;
}

export function ReportView({ language, report, original, annotations, downloadImage, copyReport = defaultCopyReport }: Props) {
  const t = translations[language];
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [copied, setCopied] = useState(false);
  const zoom = (image: LightboxImage) => setLightbox(image);
  const directionClass = report.conclusion.direction === 'long' ? 'bullish' : report.conclusion.direction === 'short' ? 'bearish' : 'neutral';

  return <div className="report-view">
    <section className="original-screenshot">
      <div className="section-heading"><h2>{t.original}</h2><button className="secondary copy-report" type="button" onClick={async () => { await copyReport(reportToText(report, language)); setCopied(true); }}>{copied ? t.copied : t.copyReport}</button></div>
      <AnnotatedImage language={language} image={{ dataUrl: original.dataUrl, title: t.original }} filename="chartviz-original.png" onZoom={zoom} downloadImage={downloadImage} />
      <dl className="metadata"><div><dt>{t.instrument}</dt><dd>{report.chart.instrument ?? t.none}</dd></div><div><dt>{t.timeframe}</dt><dd>{report.chart.timeframe ?? t.none}</dd></div></dl>
    </section>

    <section className={`decision decision-${directionClass}`} data-report-section="conclusion">
      <div className="decision-heading"><div><span>{t.direction}</span><h2>{metric(report.conclusion.direction, language)}</h2></div><strong>{Math.round(report.conclusion.confidence * 100)}%</strong></div>
      <div className="grid conclusion-metrics"><article><span>{t.trend}</span><strong>{metric(report.conclusion.trend, language)}</strong></article><article><span>{t.strength}</span><strong>{metric(report.conclusion.strength, language)}</strong></article></div>
      <p className="decision-summary">{report.conclusion.summary}</p>
      <p><b>{t.structure}:</b> {metric(report.conclusion.structure, language)}</p>
      <p><b>{t.primaryRisk}:</b> {report.conclusion.primaryRisk}</p>
    </section>

    <section className="market-explanation" data-report-section="marketExplanation">
      <h2>{t.marketExplanation}</h2>
      <h3>{t.priceAction}</h3><p>{report.marketExplanation.priceAction.summary}</p><ul>{report.marketExplanation.priceAction.evidence.map((item) => <li key={item}>{item}</li>)}</ul><small>{t.visibleAt}: {report.marketExplanation.priceAction.timeAnchor}</small>
      {report.marketExplanation.volume && <div className="volume-explanation"><h3>{t.priceVolume}</h3><p>{report.marketExplanation.volume.summary}</p><p><b>{t.implication}:</b> {report.marketExplanation.volume.implication}</p><small>{t.visibleAt}: {report.marketExplanation.volume.timeAnchor}</small></div>}
      {report.marketExplanation.indicators.length > 0 && <div className="indicator-explanation"><h3>{t.technicalIndicators}</h3>{report.marketExplanation.indicators.map((indicator) => <article key={indicator.id}><p><b>{indicator.name}:</b> {indicator.state}</p><p><b>{t.implication}:</b> {indicator.implication}</p><small>{t.visibleAt}: {indicator.timeAnchor}</small></article>)}</div>}
    </section>

    {report.levels.length > 0 && <section data-report-section="levels"><h2>{t.supportResistance}</h2><div className="level-list visual-levels">{report.levels.map((level) => <article className={level.type} key={level.id}><span>{metric(level.type, language)} · {metric(level.tier, language)}</span><strong>{level.priceLabel}</strong><p>{level.reason}</p><small>{t.levelStatus}: {metric(level.status, language)} · {t.visibleAt}: {level.timeAnchor} · {Math.round(level.confidence * 100)}%</small></article>)}</div>{annotations.levels && <div className="level-annotation"><AnnotatedImage language={language} image={{ ...annotations.levels, title: t.supportResistance }} filename="chartviz-levels.png" onZoom={zoom} downloadImage={downloadImage} /></div>}</section>}

    <section className="trade-plan" data-report-section="tradePlan"><h2>{t.tradePlan}</h2><p className="trade-plan-summary">{report.tradePlan.summary}</p><ScenarioCard title={t.long} scenario={report.tradePlan.long} language={language} /><ScenarioCard title={t.short} scenario={report.tradePlan.short} language={language} /><article className="scenario"><h3>{t.wait}</h3><p><b>{t.condition}:</b> {report.tradePlan.wait.condition}</p><p><b>{t.reason}:</b> {report.tradePlan.wait.reason}</p></article></section>

    {report.tradeSignals.length > 0 && <section data-report-section="tradeSignals"><h2>{t.signals}</h2><div className="trade-signals">{report.tradeSignals.map((signal) => <article className={signal.direction} data-signal-id={signal.id} key={signal.id}><header><b>{signal.id} · {metric(signal.direction, language)}</b><span>{Math.round(signal.confidence * 100)}%</span></header><h3>{signal.signalType}</h3><p><b>{t.signalTime}:</b> {signal.signalTime}</p><p><b>{t.setupAtSignal}:</b> {signal.thesisAtSignal}</p><ul>{signal.evidenceAtSignal.map((item) => <li key={item}>{item}</li>)}</ul><p><b>{t.entry}:</b> {signal.entry.priceLabel}</p><p><b>{t.stop}:</b> {signal.stopLoss.priceLabel}</p><p><b>{t.targets}:</b> {signal.takeProfits.map(({ priceLabel }) => priceLabel).join(' · ')}</p><p><b>{t.riskReward}:</b> {signal.riskReward ?? t.none}</p>{annotations.signals[signal.id] && <div className="signal-annotation"><AnnotatedImage language={language} image={{ ...annotations.signals[signal.id]!, title: `${signal.id} · ${metric(signal.direction, language)}` }} filename={`chartviz-signal-${signal.id}.png`} onZoom={zoom} downloadImage={downloadImage} /></div>}</article>)}</div></section>}

    {report.patterns.length > 0 && <section className="pattern-section" data-report-section="patterns"><h2>{t.patterns}</h2>{report.patterns.map((pattern) => <article className="pattern" data-pattern-id={pattern.id} key={pattern.id}><h3>{pattern.name}<span>{metric(pattern.status, language)} · {metric(pattern.bias, language)} · {Math.round(pattern.confidence * 100)}%</span></h3><p><b>{t.timeRange}:</b> {pattern.timeRange}</p><p>{pattern.evidence}</p><p><b>{t.confirmation}:</b> {pattern.confirmation}</p><p><b>{t.invalidation}:</b> {pattern.invalidation}</p>{annotations.patterns[pattern.id] && <div className="pattern-annotation"><AnnotatedImage language={language} image={annotations.patterns[pattern.id]!} filename={`chartviz-pattern-${pattern.id}.png`} onZoom={zoom} downloadImage={downloadImage} /></div>}</article>)}</section>}

    <footer className="risk-notice" data-report-section="riskNotice"><b>{t.riskNotice}:</b> {report.riskNotice}</footer>
    {lightbox && <ImageLightbox image={lightbox} language={language} onClose={() => setLightbox(null)} />}
  </div>;
}
