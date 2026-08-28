import type { CommunityReportV3 } from '../analysis/stages/community-report-v3';
import { parseCommunityReportV3Shape } from '../analysis/stages/community-report-v3';
import type { PatternGeometry } from '../analysis/stages/pattern-geometry-schema';
import type { ExtensionReport } from './contracts/extension-cloud-v1';

type ExtensionDrawing = NonNullable<ExtensionReport['drawings']>[number];

function pointGeometry(drawing: ExtensionDrawing): Array<{ xRatio: number; yRatio: number }> | null {
  const points: Array<{ xRatio: number; yRatio: number }> = [];
  for (const point of drawing.points) {
    if (point.xRatio === null) return null;
    points.push({ xRatio: point.xRatio, yRatio: point.yRatio });
  }
  return points;
}

function boundary(
  points: Array<{ xRatio: number; yRatio: number }>,
  offset: number,
) {
  const start = points[offset];
  const end = points[offset + 1];
  return start && end ? { start, end } : null;
}

function patternGeometry(drawing: ExtensionDrawing | undefined): PatternGeometry | null {
  if (!drawing) return null;
  const points = pointGeometry(drawing);
  if (!points || points.length < 2) return null;
  if (drawing.tool !== 'channel' && drawing.tool !== 'range') {
    return {
      geometryKind: 'polyline',
      points: points.slice(0, 8),
      upperBoundary: null,
      lowerBoundary: null,
    };
  }
  if (points.length < 4) return null;
  const first = boundary(points, 0);
  const second = boundary(points, 2);
  if (!first || !second) return null;
  const firstAverage = (first.start.yRatio + first.end.yRatio) / 2;
  const secondAverage = (second.start.yRatio + second.end.yRatio) / 2;
  return {
    geometryKind: drawing.tool,
    points: [],
    upperBoundary: firstAverage <= secondAverage ? first : second,
    lowerBoundary: firstAverage <= secondAverage ? second : first,
  };
}

export function adaptExtensionReport(report: ExtensionReport): CommunityReportV3 {
  const capture = report.context.captures[0];
  if (!capture || report.context.captures.length !== 1) {
    throw new TypeError('C2 requires exactly one capture.');
  }
  const levels = (report.levels ?? [])
    .filter((level) => level.captureId === 'C01' && level.yRatio !== null)
    .slice(0, 4)
    .map((level) => ({
      id: level.id,
      type: level.type,
      tier: level.tier,
      status: level.status,
      priceLabel: level.priceLabel,
      reason: level.reason,
      timeAnchor: level.timeAnchor,
      yRatio: level.yRatio as number,
      confidence: level.confidence,
    }));
  const tradeSignals = (report.tradeSignals ?? [])
    .filter((signal) => (
      signal.captureId === 'C01'
      && signal.entry.xRatio !== null
      && signal.takeProfits.length > 0
    ))
    .slice(0, 4)
    .map((signal) => ({
      id: signal.id,
      direction: signal.direction,
      signalType: signal.signalType,
      signalTime: signal.signalTime,
      thesisAtSignal: signal.thesisAtSignal,
      evidenceAtSignal: signal.evidenceAtSignal,
      entry: {
        priceLabel: signal.entry.priceLabel,
        xRatio: signal.entry.xRatio as number,
        yRatio: signal.entry.yRatio,
      },
      stopLoss: {
        priceLabel: signal.stopLoss.priceLabel,
        yRatio: signal.stopLoss.yRatio,
      },
      takeProfits: signal.takeProfits.map((target) => ({
        priceLabel: target.priceLabel,
        yRatio: target.yRatio,
      })),
      riskReward: signal.riskReward,
      confidence: signal.confidence,
    }));
  const patterns = (report.patterns ?? []).flatMap((pattern) => {
    if (pattern.captureId !== 'C01') return [];
    const drawing = (report.drawings ?? []).find((candidate) => (
      candidate.layer === 'pattern'
      && candidate.refId === pattern.id
      && candidate.captureId === pattern.captureId
    ));
    const geometry = patternGeometry(drawing);
    if (!geometry) return [];
    return [{
      id: pattern.id,
      name: pattern.name,
      status: pattern.status,
      bias: pattern.bias,
      timeRange: pattern.timeRange,
      evidence: pattern.evidence,
      confirmation: pattern.confirmation,
      invalidation: pattern.invalidation,
      confidence: pattern.confidence,
      geometry,
    }];
  }).slice(0, 3);

  return parseCommunityReportV3Shape({
    schemaVersion: 'community-3.0',
    chart: {
      instrument: report.context.instrument ?? capture.instrument,
      timeframe: capture.timeframe,
    },
    conclusion: report.conclusion,
    marketExplanation: {
      priceAction: report.marketExplanation.priceAction,
      volume: report.marketExplanation.volume,
      indicators: (report.marketExplanation.indicators ?? []).slice(0, 4),
    },
    levels,
    tradePlan: report.tradePlan,
    tradeSignals,
    patterns,
    riskNotice: report.riskNotice,
  });
}
