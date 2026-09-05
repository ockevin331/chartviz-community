import { describe, expect, it } from 'vitest';
import { mergeCommunityEvidence } from '../src/analysis/stages/evidence-bundle';
import { parseCommunityReportV3 } from '../src/analysis/stages/community-report-v3';
import { parseCommunitySignalFacts } from '../src/analysis/stages/signal-facts';
import { parseCommunityVisualFacts } from '../src/analysis/stages/visual-facts';
import {
  communityVisualWireJsonSchema,
  parseCommunityVisualWireFacts,
} from '../src/analysis/stages/visual-wire-schema';
import { toCommunityVisualFacts } from '../src/analysis/stages/normalize-visual-facts';
import {
  capturedClaudeVisualAlternates,
  validReportV3,
  validSignalFacts,
  validVisualFacts,
  validVisualWireFacts,
} from './three-stage-fixtures';

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe('three-stage analysis contracts', () => {
  it('uses a strict, fully described provider wire contract without deterministic duplicates', () => {
    const wire = parseCommunityVisualWireFacts(clone(validVisualWireFacts));
    expect(wire.schemaVersion).toBe('community-visual-wire-1.0');
    expect(wire.chart).toBeNull();
    expect(wire.imageQuality).not.toHaveProperty('summary');
    expect(wire.priceScaleAnchors[0]).not.toHaveProperty('label');

    function expectPropertyDescriptions(node: unknown, path = 'root'): void {
      if (node === null || typeof node !== 'object') return;
      const schema = node as Record<string, unknown>;
      if (schema.properties && typeof schema.properties === 'object') {
        Object.entries(schema.properties as Record<string, unknown>).forEach(([name, property]) => {
          expect(property, `${path}.${name}`).toMatchObject({ description: expect.any(String) });
          expectPropertyDescriptions(property, `${path}.${name}`);
        });
      }
      if (schema.items) expectPropertyDescriptions(schema.items, `${path}[]`);
      for (const branch of ['anyOf', 'oneOf', 'allOf'] as const) {
        if (Array.isArray(schema[branch])) schema[branch].forEach((item, index) => expectPropertyDescriptions(item, `${path}.${branch}[${index}]`));
      }
    }

    expectPropertyDescriptions(communityVisualWireJsonSchema);
  });

  it('deterministically converts wire facts without changing analytical evidence', () => {
    const facts = toCommunityVisualFacts(clone(validVisualWireFacts), {
      instrument: 'BTC/USDT', timeframe: '15m', site: 'tradingview', exchange: 'BINANCE',
    });

    expect(facts.chart).toEqual({ instrument: 'BTC/USDT', timeframe: '15m' });
    expect(facts.imageQuality).toEqual({
      usable: true, summary: 'Screenshot is usable for chart analysis.', limitations: [],
    });
    expect(facts.priceScaleAnchors).toEqual([
      { price: 66_000, label: '66,000', yRatio: 0.2 },
      { price: 64_000, label: '64,000', yRatio: 0.6 },
    ]);
    expect(facts.priceAction).toEqual(validVisualFacts.priceAction);
    expect(facts.levels).toEqual(validVisualFacts.levels);
    expect(facts.patterns).toEqual(validVisualFacts.patterns);
    expect(facts.segments).toEqual(validVisualFacts.segments);
  });

  it('uses screenshot chart identity only when trusted page context is unavailable', () => {
    const wire = clone(validVisualWireFacts) as any;
    wire.chart = { instrument: 'ETH/USDT', timeframe: '4h' };
    const facts = toCommunityVisualFacts(wire, {
      instrument: null, timeframe: null, site: 'tradingview', exchange: null,
    });

    expect(facts.chart).toEqual({ instrument: 'ETH/USDT', timeframe: '4h' });
  });

  it('rejects captured alternate Claude shapes instead of translating them', () => {
    capturedClaudeVisualAlternates.forEach((fixture) => {
      expect(() => parseCommunityVisualWireFacts(clone(fixture))).toThrow();
    });
  });

  it('parses strict visual, signal, and community-3.0 report contracts', () => {
    expect(parseCommunityVisualFacts(clone(validVisualFacts)).schemaVersion).toBe('community-visual-1.0');
    expect(parseCommunitySignalFacts(clone(validSignalFacts)).signals[0]?.id).toBe('S01');
    expect(parseCommunityReportV3(clone(validReportV3)).conclusion.direction).toBe('sideways');
  });

  it('rejects additional keys and out-of-image coordinates', () => {
    const extra = clone(validVisualFacts) as Record<string, unknown>;
    extra.untrusted = true;
    expect(() => parseCommunityVisualFacts(extra)).toThrow();

    const invalid = clone(validVisualFacts) as any;
    invalid.patterns[0].geometry.upperBoundary.start.xRatio = 1.1;
    expect(() => parseCommunityVisualFacts(invalid)).toThrow();
  });

  it('requires two independent boundaries for channels and ranges', () => {
    const missingBoundary = clone(validVisualFacts) as any;
    missingBoundary.patterns[0].geometry.lowerBoundary = null;
    expect(() => parseCommunityVisualFacts(missingBoundary)).toThrow();

    const connectedRange = clone(validReportV3) as any;
    connectedRange.patterns[0].geometry.geometryKind = 'range';
    connectedRange.patterns[0].geometry.points = [{ xRatio: 0.2, yRatio: 0.4 }];
    expect(() => parseCommunityReportV3(connectedRange)).toThrow();
  });

  it('accepts an optional supported pattern classification and rejects unknown classifications', () => {
    const classified = clone(validVisualFacts) as any;
    classified.patterns[0].canonicalType = 'rising_channel';
    expect(parseCommunityVisualFacts(classified).patterns[0]?.canonicalType).toBe('rising_channel');

    classified.patterns[0].canonicalType = null;
    classified.patterns[0].name = 'A custom visible structure';
    expect(parseCommunityVisualFacts(classified).patterns[0]?.canonicalType).toBeNull();

    classified.patterns[0].canonicalType = 'invented_pattern';
    expect(() => parseCommunityVisualFacts(classified)).toThrow();
  });

  it('rejects duplicate stage ids and incomplete signal sets', () => {
    const duplicate = clone(validVisualFacts) as any;
    duplicate.levels.push(clone(duplicate.levels[0]));
    expect(() => parseCommunityVisualFacts(duplicate)).toThrow();

    const incomplete = clone(validSignalFacts) as any;
    incomplete.signals[0].takeProfits = [];
    expect(() => parseCommunitySignalFacts(incomplete)).toThrow();
  });

  it('rejects free-form signal types before they enter reasoning', () => {
    const arbitrary = clone(validSignalFacts) as any;
    arbitrary.signals[0].signalType = 'range-resistance-rejection';

    expect(() => parseCommunitySignalFacts(arbitrary)).toThrow();
  });

  it('keeps an other signal category so the extractor is never forced into a wrong known type', () => {
    const other = clone(validSignalFacts) as any;
    other.signals[0].signalType = 'other';

    expect(parseCommunitySignalFacts(other).signals[0]?.signalType).toBe('other');
  });

  it('requires at least two meaningful internal price-action segments', () => {
    const unsegmented = clone(validVisualFacts) as any;
    unsegmented.segments = [unsegmented.segments[0]];
    expect(() => parseCommunityVisualFacts(unsegmented)).toThrow();
  });

  it('uses sideways rather than wait for the market conclusion and rejects empty visible text', () => {
    const wait = clone(validReportV3) as any;
    wait.conclusion.direction = 'wait';
    expect(() => parseCommunityReportV3(wait)).toThrow();

    const empty = clone(validReportV3) as any;
    empty.conclusion.summary = '  ';
    expect(() => parseCommunityReportV3(empty)).toThrow();
  });

  it('never turns generated prose into a hard schema failure', () => {
    const wire = clone(validVisualWireFacts) as any;
    wire.chart = { instrument: 'BTCUSDT', timeframe: '1h' };
    wire.levels[0].timeAnchor = '9月4日图表高点';
    wire.priceAction.summary = 'Binance API is mentioned by generated prose.';

    const visual = clone(validVisualFacts) as any;
    visual.chart.timeframe = '1h';
    visual.levels[0].timeAnchor = '9月4日图表高点';

    const signals = clone(validSignalFacts) as any;
    signals.signals[0].thesisAtSignal = 'External data appears in model wording.';

    const external = clone(validReportV3) as any;
    external.marketExplanation.priceAction.summary = 'Binance API confirms this move.';
    external.chart.timeframe = '1h';
    external.levels[0].timeAnchor = '9月4日图表高点';
    external.tradePlan.summary = 'The prose also mentions a 4h chart.';

    expect(parseCommunityVisualWireFacts(wire)).toBeTruthy();
    expect(parseCommunityVisualFacts(visual)).toBeTruthy();
    expect(parseCommunitySignalFacts(signals)).toBeTruthy();
    expect(parseCommunityReportV3(external)).toBeTruthy();
  });

  it('merges validated facts and signals into an immutable evidence bundle', () => {
    const facts = parseCommunityVisualFacts(clone(validVisualFacts));
    const signals = parseCommunitySignalFacts(clone(validSignalFacts));
    const evidence = mergeCommunityEvidence(facts, signals);

    expect(evidence.schemaVersion).toBe('community-evidence-1.0');
    expect(evidence.visualFacts.levels[0]?.id).toBe('L01');
    expect(evidence.signalFacts.signals[0]?.id).toBe('S01');
    expect(evidence).not.toBe(facts);
  });
});
