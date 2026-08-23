import type { AnalysisReport, DrawingInstruction } from './analysis';

export type DrawingGroup = { id: 'levels' | 'signals' | 'patterns' | 'structure'; drawings: DrawingInstruction[] };

export function tradeSignalDrawings(
  report: AnalysisReport,
  drawingRefs: string[],
): DrawingInstruction[] {
  const references = new Set(drawingRefs);
  return report.drawings.filter((drawing) => references.has(drawing.id));
}

export function groupReportDrawings(report: AnalysisReport): DrawingGroup[] {
  const signalIds = new Set(report.tradeSignals.flatMap((signal) => signal.drawingRefs));
  const levelIds = new Set(report.keyLevels.flatMap((level) => level.drawingId ? [level.drawingId] : []));
  const patternIds = new Set((report.patterns ?? []).flatMap((pattern) => pattern.drawingRefs ?? []));
  const levelTools = new Set<DrawingInstruction['tool']>(['support_line', 'resistance_line', 'support_zone', 'resistance_zone', 'breakout_marker', 'rejection_marker']);
  const signalTools = new Set<DrawingInstruction['tool']>(['entry_line', 'stop_line', 'target_line']);
  const patterns = report.drawings.filter((drawing) => patternIds.has(drawing.id));
  const levels = report.drawings.filter((drawing) => !patternIds.has(drawing.id) && (levelIds.has(drawing.id) || (levelTools.has(drawing.tool) && !signalIds.has(drawing.id))));
  const signals = report.drawings.filter((drawing) => !patternIds.has(drawing.id) && (signalIds.has(drawing.id) || signalTools.has(drawing.tool)));
  const used = new Set([...levels, ...signals, ...patterns].map((drawing) => drawing.id));
  const structure = report.drawings.filter((drawing) => !used.has(drawing.id));
  return [
    { id: 'levels', drawings: levels }, { id: 'signals', drawings: signals },
    { id: 'patterns', drawings: patterns }, { id: 'structure', drawings: structure },
  ].filter((group) => group.drawings.length > 0) as DrawingGroup[];
}
