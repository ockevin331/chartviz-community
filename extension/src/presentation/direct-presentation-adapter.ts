import type { AnalysisCapture } from '../analysis/runtime/analysis-runtime';
import type { CommunityReportV3 } from '../analysis/stages/community-report-v3';
import { patternGeometryPoints } from '../analysis/stages/pattern-geometry-schema';
import type { OutputLanguage } from '../analysis/stages/shared-stage-types';
import {
  parsePresentationBundle,
  type PresentationBundle,
  type PresentationDrawing,
  type PresentationDrawingPoint,
} from './report-presentation-model';

function drawingId(index: number): string {
  return `D${String(index + 1).padStart(2, '0')}`;
}

function patternPoints(pattern: CommunityReportV3['patterns'][number]): PresentationDrawingPoint[] {
  return patternGeometryPoints(pattern.geometry).map(({ xRatio, yRatio }) => ({
    xRatio,
    yRatio,
    priceLabel: null,
    timeAnchor: null,
  }));
}

export function adaptDirectPresentation(
  report: CommunityReportV3,
  capture: AnalysisCapture,
  outputLanguage: OutputLanguage,
): PresentationBundle {
  const captureId = 'C01';
  const timeframe = capture.context.timeframe ?? report.chart.timeframe;
  const instrument = report.chart.instrument ?? capture.context.instrument;
  const drawings: PresentationDrawing[] = [];
  const addDrawing = (drawing: Omit<PresentationDrawing, 'id'>) => {
    drawings.push({ id: drawingId(drawings.length), ...drawing });
  };

  report.levels.forEach((level) => addDrawing({
    captureId,
    layer: 'levels',
    refId: level.id,
    meaning: level.type,
    caption: null,
    tool: 'horizontal_line',
    points: [{
      xRatio: null,
      yRatio: level.yRatio,
      priceLabel: level.priceLabel,
      timeAnchor: level.timeAnchor,
    }],
  }));

  report.tradeSignals.forEach((signal) => {
    addDrawing({
      captureId,
      layer: 'signal',
      refId: signal.id,
      meaning: `${signal.direction}_entry`,
      caption: signal.riskReward,
      tool: 'entry_arrow',
      points: [{
        xRatio: signal.entry.xRatio,
        yRatio: signal.entry.yRatio,
        priceLabel: signal.entry.priceLabel,
        timeAnchor: signal.signalTime,
      }],
    });
    addDrawing({
      captureId,
      layer: 'signal',
      refId: signal.id,
      meaning: 'stop',
      caption: null,
      tool: 'stop_line',
      points: [{
        xRatio: null,
        yRatio: signal.stopLoss.yRatio,
        priceLabel: signal.stopLoss.priceLabel,
        timeAnchor: null,
      }],
    });
    signal.takeProfits.forEach((target) => addDrawing({
      captureId,
      layer: 'signal',
      refId: signal.id,
      meaning: 'target',
      caption: null,
      tool: 'target_line',
      points: [{
        xRatio: null,
        yRatio: target.yRatio,
        priceLabel: target.priceLabel,
        timeAnchor: null,
      }],
    }));
  });

  report.patterns.forEach((pattern) => addDrawing({
    captureId,
    layer: 'pattern',
    refId: pattern.id,
    meaning: 'pattern',
    caption: pattern.name,
    tool: pattern.geometry.geometryKind === 'polyline'
      ? 'trend_line'
      : pattern.geometry.geometryKind,
    points: patternPoints(pattern),
  }));

  return parsePresentationBundle({
    report: {
      schemaVersion: 'presentation-1.0',
      context: {
        instrument,
        venue: capture.context.exchange ?? null,
        outputLanguage,
        captures: [{
          captureId,
          timeframe,
          role: null,
          instrument,
          width: capture.image.width,
          height: capture.image.height,
        }],
      },
      conclusion: report.conclusion,
      marketExplanation: report.marketExplanation,
      levels: report.levels.map(({ yRatio: _yRatio, ...level }) => ({
        ...level,
        captureId,
      })),
      tradePlan: report.tradePlan,
      tradeSignals: report.tradeSignals.map((signal) => ({
        id: signal.id,
        captureId,
        direction: signal.direction,
        signalType: signal.signalType,
        signalTime: signal.signalTime,
        thesisAtSignal: signal.thesisAtSignal,
        evidenceAtSignal: signal.evidenceAtSignal,
        entry: { priceLabel: signal.entry.priceLabel },
        stopLoss: { priceLabel: signal.stopLoss.priceLabel },
        takeProfits: signal.takeProfits.map(({ priceLabel }) => ({ priceLabel })),
        riskReward: signal.riskReward,
        confidence: signal.confidence,
        invalidation: null,
      })),
      patterns: report.patterns.map(({ geometry: _geometry, ...pattern }) => ({
        ...pattern,
        captureId,
      })),
      timeframeViews: [{
        captureId,
        timeframe,
        role: null,
        trend: report.conclusion.trend,
        structure: report.conclusion.structure,
        conclusion: report.conclusion.summary,
        confidence: report.conclusion.confidence,
        evidence: report.marketExplanation.priceAction.evidence,
      }],
      riskNotice: report.riskNotice,
    },
    drawings,
  });
}

