import type { ExtensionReport } from '../cloud/contracts/extension-cloud-v1';
import {
  parsePresentationBundle,
  type PresentationBundle,
  type PresentationDrawing,
  type PresentationDrawingPoint,
} from './report-presentation-model';

type CloudDrawing = NonNullable<ExtensionReport['drawings']>[number];

function drawingId(index: number): string {
  return `D${String(index + 1).padStart(2, '0')}`;
}

function normalizedPoints(points: CloudDrawing['points']): PresentationDrawingPoint[] {
  return points.map(({ xRatio, yRatio, priceLabel, timeAnchor }) => ({
    xRatio, yRatio, priceLabel, timeAnchor,
  }));
}

function validNativeDrawing(
  drawing: CloudDrawing | undefined,
  tools: readonly CloudDrawing['tool'][],
): drawing is CloudDrawing {
  if (!drawing || !tools.includes(drawing.tool)) return false;
  const points = drawing.points;
  const allXNull = points.every(({ xRatio }) => xRatio === null);
  const allXPresent = points.every(({ xRatio }) => xRatio !== null);
  if (drawing.tool === 'horizontal_line' || drawing.tool === 'stop_line' || drawing.tool === 'target_line') {
    return points.length === 1 && allXNull;
  }
  if (drawing.tool === 'entry_arrow' || drawing.tool === 'marker') {
    return points.length === 1 && allXPresent;
  }
  if (drawing.tool === 'zone') return points.length === 2;
  if (drawing.tool === 'trend_line') return points.length >= 2 && allXPresent;
  return points.length === 4 && allXPresent;
}

export function adaptCloudPresentation(report: ExtensionReport): PresentationBundle {
  const drawings: PresentationDrawing[] = [];
  const nativeDrawings = report.drawings ?? [];
  const addDrawing = (drawing: Omit<PresentationDrawing, 'id'>) => {
    drawings.push({ id: drawingId(drawings.length), ...drawing });
  };
  const native = (
    layer: CloudDrawing['layer'],
    refId: string,
    tools: readonly CloudDrawing['tool'][],
  ) => nativeDrawings.find((drawing) => (
    drawing.layer === layer
    && drawing.refId === refId
    && validNativeDrawing(drawing, tools)
  ));

  for (const level of report.levels ?? []) {
    const source = native('levels', level.id, ['horizontal_line', 'zone']);
    if (source) {
      addDrawing({
        captureId: level.captureId,
        layer: 'levels',
        refId: level.id,
        meaning: level.type,
        caption: null,
        tool: source.tool,
        points: normalizedPoints(source.points),
      });
    } else if (level.yRatio !== null) {
      addDrawing({
        captureId: level.captureId,
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
      });
    }
  }

  for (const signal of report.tradeSignals ?? []) {
    const entry = native('signal', signal.id, ['entry_arrow']);
    if (entry) {
      addDrawing({
        captureId: signal.captureId,
        layer: 'signal',
        refId: signal.id,
        meaning: `${signal.direction}_entry`,
        caption: signal.riskReward,
        tool: 'entry_arrow',
        points: normalizedPoints(entry.points),
      });
    } else if (signal.entry.xRatio !== null) {
      addDrawing({
        captureId: signal.captureId,
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
    }

    const stop = native('signal', signal.id, ['stop_line']);
    addDrawing({
      captureId: signal.captureId,
      layer: 'signal',
      refId: signal.id,
      meaning: 'stop',
      caption: null,
      tool: 'stop_line',
      points: stop ? normalizedPoints(stop.points) : [{
        xRatio: null,
        yRatio: signal.stopLoss.yRatio,
        priceLabel: signal.stopLoss.priceLabel,
        timeAnchor: null,
      }],
    });

    const nativeTargets = nativeDrawings.filter((drawing) => (
      drawing.layer === 'signal'
      && drawing.refId === signal.id
      && validNativeDrawing(drawing, ['target_line'])
    ));
    signal.takeProfits.forEach((target, index) => {
      const source = nativeTargets[index];
      addDrawing({
        captureId: signal.captureId,
        layer: 'signal',
        refId: signal.id,
        meaning: 'target',
        caption: null,
        tool: 'target_line',
        points: source ? normalizedPoints(source.points) : [{
          xRatio: null,
          yRatio: target.yRatio,
          priceLabel: target.priceLabel,
          timeAnchor: null,
        }],
      });
    });
  }

  for (const pattern of report.patterns ?? []) {
    const source = native('pattern', pattern.id, ['trend_line', 'channel', 'range', 'marker']);
    if (!source) continue;
    addDrawing({
      captureId: pattern.captureId,
      layer: 'pattern',
      refId: pattern.id,
      meaning: 'pattern',
      caption: pattern.name,
      tool: source.tool,
      points: normalizedPoints(source.points),
    });
  }

  return parsePresentationBundle({
    report: {
      schemaVersion: 'presentation-1.0',
      context: {
        instrument: report.context.instrument,
        venue: report.context.venue,
        outputLanguage: report.context.outputLanguage,
        captures: report.context.captures.map((capture) => ({
          captureId: capture.captureId,
          timeframe: capture.timeframe,
          role: capture.role,
          instrument: capture.instrument,
          width: capture.width,
          height: capture.height,
        })),
      },
      conclusion: report.conclusion,
      marketExplanation: report.marketExplanation,
      levels: (report.levels ?? []).map(({ yRatio: _yRatio, ...level }) => level),
      tradePlan: report.tradePlan,
      tradeSignals: (report.tradeSignals ?? []).map((signal) => ({
        id: signal.id,
        captureId: signal.captureId,
        direction: signal.direction,
        signalType: signal.signalType,
        signalTime: signal.signalTime,
        thesisAtSignal: signal.thesisAtSignal,
        evidenceAtSignal: signal.evidenceAtSignal,
        entry: { priceLabel: signal.entry.priceLabel },
        stopLoss: { priceLabel: signal.stopLoss.priceLabel },
        takeProfits: signal.takeProfits.map(({ priceLabel }) => ({ priceLabel })),
        riskReward: signal.riskReward,
        invalidation: signal.invalidation,
        confidence: signal.confidence,
      })),
      patterns: report.patterns ?? [],
      timeframeViews: report.timeframeViews,
      riskNotice: report.riskNotice,
    },
    drawings,
  });
}
