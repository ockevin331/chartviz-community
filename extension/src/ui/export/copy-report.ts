import type { CommunityReport } from '../../analysis/community-report';
import { translations, type Language } from '../components/LanguageMenu';

export function reportToText(report: CommunityReport, language: Language): string {
  const t = translations[language];
  const evidenceLabels = new Map(report.evidence.map((item, index) => [item.id, `${t.evidence} ${index + 1}`]));
  const refs = (ids: string[]) => ids.map((id) => evidenceLabels.get(id)).filter(Boolean).join(' · ');
  const percent = (confidence: number) => `${Math.round(confidence * 100)}%`;
  const lines: string[] = [
    `ChartViz Community — ${t.chart}`,
    `${t.instrument}: ${report.chart.instrument ?? t.none}`,
    `${t.timeframe}: ${report.chart.timeframe ?? t.none}`,
    ...(report.chart.limitations.length > 0 ? [`${t.limitations}: ${report.chart.limitations.join(' · ')}`] : []),
    `${t.marketView}: ${report.marketView.bias} · ${report.marketView.phase} · ${report.marketView.strength}`,
    report.marketView.summary,
    `${t.evidence}: ${refs(report.marketView.evidenceIds)}`,
  ];
  report.evidence.forEach((item, index) => lines.push(
    `${t.evidence} ${index + 1}: ${item.category} · ${item.observation} — ${item.implication} · ${item.timeAnchor} · ${percent(item.confidence)}`,
  ));
  if (report.volume) lines.push(`${t.volume}: ${report.volume.summary}`, `${t.evidence}: ${refs(report.volume.evidenceIds)}`);
  report.indicators.forEach((item) => lines.push(
    `${item.name}: ${item.summary} — ${item.implication}`,
    `${t.evidence}: ${refs(item.evidenceIds)}`,
  ));
  report.levels.forEach((item) => lines.push(
    `${t.supportResistance}: ${item.type} · ${item.priceLabel} · ${item.timeAnchor} — ${item.reason}`,
    `${t.evidence}: ${refs(item.evidenceIds)}`,
  ));
  for (const [label, scenario] of [[t.long, report.scenarios.long], [t.short, report.scenarios.short]] as const) {
    lines.push(`${label}: ${scenario.condition}`, `${t.entry}: ${scenario.entry}`, `${t.stop}: ${scenario.stop}`, `${t.targets}: ${scenario.targets.join(' · ') || t.none}`, `${t.reason}: ${scenario.reason}`, `${t.evidence}: ${refs(scenario.evidenceIds)}`);
  }
  lines.push(`${t.wait}: ${report.scenarios.wait.condition}`, `${t.reason}: ${report.scenarios.wait.reason}`, `${t.evidence}: ${refs(report.scenarios.wait.evidenceIds)}`);
  report.patterns.forEach((item) => lines.push(
    `${t.patterns}: ${item.name} · ${item.status} · ${item.bias} · ${percent(item.confidence)}`,
    `${t.timeRange}: ${item.timeRange}`,
    item.explanation,
    `${t.evidence}: ${refs(item.evidenceIds)}`,
  ));
  report.signals.forEach((item) => lines.push(
    `${t.signals}: ${item.id} · ${item.direction} · ${percent(item.confidence)}`,
    `${t.visibleAt}: ${item.timeAnchor}`,
    `${t.reason}: ${item.reason}`,
    `${t.entry}: ${item.entry.priceLabel}`,
    `${t.stop}: ${item.stop.priceLabel}`,
    `${t.targets}: ${item.targets.map(({ priceLabel }) => priceLabel).join(' · ')}`,
    `${t.riskReward}: ${item.riskReward ?? t.none}`,
    `${t.evidence}: ${refs(item.evidenceIds)}`,
  ));
  lines.push(`${t.riskNotice}: ${report.riskNotice}`);
  return lines.join('\n');
}

export async function copyReport(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
