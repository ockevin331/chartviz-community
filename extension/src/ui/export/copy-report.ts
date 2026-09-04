import type { ReportPresentationModel } from '../../presentation/report-presentation-model';
import { translations, type Language } from '../components/LanguageMenu';

const enMetric: Record<string, string> = {
  long: 'LONG', short: 'SHORT', sideways: 'SIDEWAYS', bullish: 'Bullish', bearish: 'Bearish', unclear: 'Unclear',
  'hh-hl': 'Higher highs and higher lows', 'lh-ll': 'Lower highs and lower lows', range: 'Range', transition: 'Transition',
  strong: 'Strong', moderate: 'Moderate', weak: 'Weak', support: 'Support', resistance: 'Resistance',
  nearest: 'Nearest', secondary: 'Secondary', major: 'Major', holding: 'Holding', testing: 'Testing', broken: 'Broken',
  flip_candidate: 'Possible role reversal', forming: 'Forming', confirmed: 'Confirmed', invalidated: 'Invalidated', neutral: 'Neutral',
};
const zhMetric: Record<string, string> = {
  long: '做多', short: '做空', sideways: '震荡', bullish: '上涨', bearish: '下跌', unclear: '不明确',
  'hh-hl': '高点和低点逐步抬高', 'lh-ll': '高点和低点逐步降低', range: '区间震荡', transition: '转折阶段',
  strong: '强', moderate: '中等', weak: '弱', support: '支撑', resistance: '阻力', nearest: '最近', secondary: '次要', major: '主要',
  holding: '有效', testing: '测试中', broken: '已突破', flip_candidate: '可能转换', forming: '形成中', confirmed: '已确认', invalidated: '已失效', neutral: '中性',
};

function metric(value: string, language: Language): string {
  return (language === 'zh-CN' ? zhMetric : enMetric)[value] ?? value.replaceAll('_', ' ');
}

export function reportToText(report: ReportPresentationModel, language: Language): string {
  const t = translations[language];
  const capture = report.context.captures[0];
  const lines = [
    `ChartViz — ${metric(report.conclusion.trend, language)}`,
    `${t.instrument}: ${report.context.instrument ?? capture?.instrument ?? t.none}`,
    `${t.timeframe}: ${capture?.timeframe ?? t.none}`,
    `${t.structure}: ${metric(report.conclusion.structure, language)} · ${t.strength}: ${metric(report.conclusion.strength, language)} · ${t.confidence}: ${Math.round(report.conclusion.confidence * 100)}%`,
    report.conclusion.summary,
    `${t.primaryRisk}: ${report.conclusion.primaryRisk}`,
    '', t.marketExplanation, `${t.priceAction}: ${report.marketExplanation.priceAction.summary}`,
    ...report.marketExplanation.priceAction.evidence,
    `${t.visibleAt}: ${report.marketExplanation.priceAction.timeAnchor}`,
  ];
  if (report.marketExplanation.volume) lines.push(
    t.priceVolume, report.marketExplanation.volume.summary,
    `${t.implication}: ${report.marketExplanation.volume.implication}`,
    `${t.visibleAt}: ${report.marketExplanation.volume.timeAnchor}`,
  );
  report.marketExplanation.indicators.forEach((indicator) => lines.push(
    `${t.technicalIndicators} · ${indicator.name}: ${indicator.state}`,
    `${t.implication}: ${indicator.implication}`,
    `${t.visibleAt}: ${indicator.timeAnchor}`,
  ));
  report.levels.forEach((level) => lines.push(
    `${t.supportResistance}: ${metric(level.type, language)} · ${metric(level.tier, language)} · ${level.priceLabel}`,
    `${t.levelStatus}: ${metric(level.status, language)} · ${level.reason} · ${t.visibleAt}: ${level.timeAnchor}`,
  ));
  lines.push('', t.tradePlan, report.tradePlan.summary);
  for (const [title, scenario] of [[t.long, report.tradePlan.long], [t.short, report.tradePlan.short]] as const) {
    lines.push(title, `${t.condition}: ${scenario.condition}`, `${t.entry}: ${scenario.entry}`, `${t.stop}: ${scenario.stop}`, `${t.targets}: ${scenario.targets.join(' · ')}`, `${t.reason}: ${scenario.reason}`);
  }
  lines.push(t.wait, `${t.condition}: ${report.tradePlan.wait.condition}`, `${t.reason}: ${report.tradePlan.wait.reason}`);
  report.tradeSignals.forEach((signal) => lines.push(
    '', `${t.signals}: ${signal.id} · ${metric(signal.direction, language)} · ${signal.signalType}`,
    `${t.signalTime}: ${signal.signalTime}`, `${t.setupAtSignal}: ${signal.thesisAtSignal}`,
    ...signal.evidenceAtSignal, `${t.entry}: ${signal.entry.priceLabel}`, `${t.stop}: ${signal.stopLoss.priceLabel}`,
    `${t.targets}: ${signal.takeProfits.map(({ priceLabel }) => priceLabel).join(' · ')}`, `${t.riskReward}: ${signal.riskReward ?? t.none}`,
  ));
  report.patterns.forEach((pattern) => lines.push(
    '', `${t.patterns}: ${pattern.name} · ${metric(pattern.status, language)} · ${metric(pattern.bias, language)}`,
    `${t.timeRange}: ${pattern.timeRange}`, pattern.evidence,
    `${t.confirmation}: ${pattern.confirmation}`, `${t.invalidation}: ${pattern.invalidation}`,
  ));
  lines.push('', `${t.riskNotice}: ${report.riskNotice}`);
  return lines.join('\n');
}

export async function copyReport(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
