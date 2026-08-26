import type { CommunityReport } from '../../analysis/community-report';
import { translations, type Language } from '../components/LanguageMenu';

export function reportToText(report: CommunityReport, language: Language): string {
  const t = translations[language];
  const lines: string[] = [
    `ChartViz Community — ${t.chart}`,
    `${t.instrument}: ${report.chart.instrument ?? t.none}`,
    `${t.timeframe}: ${report.chart.timeframe ?? t.none}`,
    `${t.marketView}: ${report.marketView.summary}`,
  ];
  report.evidence.forEach((item) => lines.push(`${t.evidence}: ${item.observation} — ${item.implication}`));
  if (report.volume) lines.push(`${t.volume}: ${report.volume.summary}`);
  report.indicators.forEach((item) => lines.push(`${item.name}: ${item.summary} — ${item.implication}`));
  report.levels.forEach((item) => lines.push(`${t.supportResistance}: ${item.type} ${item.priceLabel} — ${item.reason}`));
  for (const [label, scenario] of [[t.long, report.scenarios.long], [t.short, report.scenarios.short]] as const) {
    lines.push(`${label}: ${scenario.condition}`, `${t.entry}: ${scenario.entry}`, `${t.stop}: ${scenario.stop}`, `${t.targets}: ${scenario.targets.join(' · ')}`, `${t.reason}: ${scenario.reason}`);
  }
  lines.push(`${t.wait}: ${report.scenarios.wait.condition}`, `${t.reason}: ${report.scenarios.wait.reason}`);
  report.patterns.forEach((item) => lines.push(`${t.patterns}: ${item.name} — ${item.explanation}`));
  report.signals.forEach((item) => lines.push(`${t.signals}: ${item.direction} — ${item.reason}`, `${t.entry}: ${item.entry.priceLabel}`, `${t.stop}: ${item.stop.priceLabel}`, `${t.targets}: ${item.targets.map(({ priceLabel }) => priceLabel).join(' · ')}`, `${t.riskReward}: ${item.riskReward ?? t.none}`));
  lines.push(`${t.riskNotice}: ${report.riskNotice}`);
  return lines.join('\n');
}

export async function copyReport(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
