import { describe, expect, it } from 'vitest';
import { mergeCommunityEvidence } from '../src/analysis/stages/evidence-bundle';
import { parseCommunityReportV3 } from '../src/analysis/stages/community-report-v3';
import { parseCommunitySignalFacts } from '../src/analysis/stages/signal-facts';
import { parseCommunityVisualFacts } from '../src/analysis/stages/visual-facts';
import { validReportV3, validSignalFacts, validVisualFacts } from './three-stage-fixtures';

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe('three-stage analysis contracts', () => {
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

  it('rejects duplicate stage ids and incomplete signal sets', () => {
    const duplicate = clone(validVisualFacts) as any;
    duplicate.levels.push(clone(duplicate.levels[0]));
    expect(() => parseCommunityVisualFacts(duplicate)).toThrow();

    const incomplete = clone(validSignalFacts) as any;
    incomplete.signals[0].takeProfits = [];
    expect(() => parseCommunitySignalFacts(incomplete)).toThrow();
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

  it('rejects external-source and second-timeframe claims in the final report', () => {
    const external = clone(validReportV3) as any;
    external.marketExplanation.priceAction.summary = 'Binance API confirms this move.';
    expect(() => parseCommunityReportV3(external)).toThrow();

    const multiple = clone(validReportV3) as any;
    multiple.tradePlan.summary = 'The 1h chart confirms this 15m chart.';
    expect(() => parseCommunityReportV3(multiple)).toThrow();
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
