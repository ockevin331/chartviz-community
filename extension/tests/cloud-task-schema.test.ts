import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseExtensionAnalysisTask } from '../src/cloud/cloud-task-schema';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'contracts', 'extension-cloud', 'v1', 'fixtures');

function fixture(name = 'single-completed-task.json'): Record<string, any> {
  return JSON.parse(readFileSync(path.join(fixtures, name), 'utf8')) as Record<string, any>;
}

describe('strict C4 extension task parser', () => {
  it('accepts the vendored single-capture completed task', () => {
    expect(parseExtensionAnalysisTask(fixture()).status).toBe('completed');
  });

  it('rejects private report fields', () => {
    const value = fixture();
    value.report.internalPrompt = 'private';
    expect(() => parseExtensionAnalysisTask(value)).toThrow();
  });

  it('enforces terminal task payload invariants', () => {
    const completed = fixture();
    completed.report = null;
    expect(() => parseExtensionAnalysisTask(completed)).toThrow();

    const failed = fixture();
    failed.status = 'failed';
    failed.report = null;
    failed.error = null;
    expect(() => parseExtensionAnalysisTask(failed)).toThrow();
  });

  it('rejects an unknown progress code', () => {
    const value = fixture();
    value.progressEvents = [{ code: 'internal_model_call', createdAt: 'now' }];
    expect(() => parseExtensionAnalysisTask(value)).toThrow();
  });

  it('rejects mismatched drawing references', () => {
    const value = fixture();
    value.report.drawings[0].captureId = 'C02';
    expect(() => parseExtensionAnalysisTask(value)).toThrow();
  });

  it('accepts an extension-report-1.1 market-structure drawing scoped to its capture', () => {
    const value = fixture();
    value.report.schemaVersion = 'extension-report-1.1';
    value.report.drawings.push({
      id: 'D10',
      captureId: 'C01',
      layer: 'structure',
      refId: 'C01',
      tool: 'trend_line',
      points: [
        { xRatio: 0.2, yRatio: 0.7, priceLabel: '63,900', timeAnchor: 'left' },
        { xRatio: 0.8, yRatio: 0.3, priceLabel: '65,200', timeAnchor: 'right' },
      ],
    });

    const task = parseExtensionAnalysisTask(value);

    expect(task.report?.schemaVersion).toBe('extension-report-1.1');
    expect(task.report?.drawings?.at(-1)).toMatchObject({
      captureId: 'C01',
      layer: 'structure',
      refId: 'C01',
      tool: 'trend_line',
    });
  });

  it('rejects market-structure drawings on extension-report-1.0', () => {
    const value = fixture();
    value.report.drawings.push({
      id: 'D10',
      captureId: 'C01',
      layer: 'structure',
      refId: 'C01',
      tool: 'range',
      points: [
        { xRatio: 0.2, yRatio: 0.3, priceLabel: '65,200', timeAnchor: 'left' },
        { xRatio: 0.8, yRatio: 0.3, priceLabel: '65,200', timeAnchor: 'right' },
        { xRatio: 0.2, yRatio: 0.7, priceLabel: '63,900', timeAnchor: 'left' },
        { xRatio: 0.8, yRatio: 0.7, priceLabel: '63,900', timeAnchor: 'right' },
      ],
    });

    expect(() => parseExtensionAnalysisTask(value)).toThrow();
  });

  it.each([
    [
      'two-completed-task.json',
      [['C01', 'context'], ['C02', 'setup_and_trigger']],
    ],
    [
      'multi-completed-task.json',
      [['C01', 'context'], ['C02', 'setup'], ['C03', 'trigger']],
    ],
  ])('accepts source-aware captures from %s', (name, expected) => {
    const task = parseExtensionAnalysisTask(fixture(name));
    expect(task.report?.context.captures.map((capture) => [
      capture.captureId,
      capture.role,
    ])).toEqual(expected);
  });

  it.each([
    ['levels', (value: Record<string, any>) => {
      value.report.levels[1].id = value.report.levels[0].id;
      value.report.drawings[1].refId = value.report.levels[0].id;
    }],
    ['tradeSignals', (value: Record<string, any>) => {
      value.report.tradeSignals.push(structuredClone(value.report.tradeSignals[0]));
    }],
    ['patterns', (value: Record<string, any>) => {
      value.report.patterns.push(structuredClone(value.report.patterns[0]));
    }],
    ['drawings', (value: Record<string, any>) => {
      value.report.drawings[1].id = value.report.drawings[0].id;
    }],
  ])('rejects duplicate IDs in report.%s', (_collection, duplicate) => {
    const value = fixture('multi-completed-task.json');
    duplicate(value);
    expect(() => parseExtensionAnalysisTask(value)).toThrow();
  });
});
