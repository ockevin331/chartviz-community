import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_CLOUD_API_VERSION,
  EXTENSION_CLOUD_REPORT_VERSION,
} from '../src/cloud/contracts/extension-cloud-v1';
import { parseExtensionCapabilities } from '../src/cloud/cloud-account-schema';
import { parseExtensionAnalysisTask } from '../src/cloud/cloud-task-schema';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleRoot = path.join(extensionRoot, 'contracts', 'extension-cloud', 'v1');
const schemaId = 'https://www.chartviz.xyz/contracts/extension-cloud/v1/openapi.json';

function loadJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(bundleRoot, relativePath), 'utf8')) as Record<string, unknown>;
}

function contractValidator(component: string) {
  const document = loadJson('openapi.json');
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'components', schemaType: 'object', valid: true });
  ajv.addSchema({
    $id: schemaId,
    components: document.components,
  });
  return ajv.compile({ $ref: `${schemaId}#/components/schemas/${component}` });
}

describe('Extension Cloud contract bundle', () => {
  it('keeps explicit API and report versions', () => {
    expect(EXTENSION_CLOUD_API_VERSION).toBe('1');
    expect(EXTENSION_CLOUD_REPORT_VERSION).toBe('extension-report-1.0');
  });

  it('matches every vendored file to the private bundle manifest', () => {
    const manifest = loadJson('manifest.json') as {
      contractVersion: string;
      files: Record<string, string>;
    };
    expect(manifest.contractVersion).toBe('extension-report-1.0');
    expect(manifest.files['manifest.json']).toBeUndefined();
    for (const [relativePath, digest] of Object.entries(manifest.files)) {
      const actual = createHash('sha256')
        .update(readFileSync(path.join(bundleRoot, relativePath)))
        .digest('hex');
      expect(actual, relativePath).toBe(digest);
    }
  });

  it.each([
    ['capabilities.json', 'ExtensionCapabilities'],
    ['account.json', 'ExtensionAccount'],
    ['capture-settings.json', 'ExtensionCaptureSettings'],
    ['single-completed-task.json', 'ExtensionAnalysisTask'],
    ['two-completed-task.json', 'ExtensionAnalysisTask'],
    ['multi-completed-task.json', 'ExtensionAnalysisTask'],
    ['quota-error.json', 'ExtensionApiError'],
  ])('validates %s against %s', (fixture, component) => {
    const validate = contractValidator(component);
    expect(validate(loadJson(`fixtures/${fixture}`)), JSON.stringify(validate.errors)).toBe(true);
  });

  it('keeps one, two, and three capture role contracts distinct', () => {
    const single = loadJson('fixtures/single-completed-task.json') as {
      report: { context: { captures: Array<{ captureId: string; timeframe: string; role: string | null }> } };
    };
    const two = loadJson('fixtures/two-completed-task.json') as {
      report: { context: { captures: Array<{ captureId: string; timeframe: string; role: string | null }> } };
    };
    const multi = loadJson('fixtures/multi-completed-task.json') as {
      report: { context: { captures: Array<{ captureId: string; timeframe: string; role: string | null }> } };
    };
    expect(single.report.context.captures).toEqual([
      expect.objectContaining({ captureId: 'C01', timeframe: '15m', role: null }),
    ]);
    expect(two.report.context.captures).toEqual([
      expect.objectContaining({ captureId: 'C01', timeframe: '4h', role: 'context' }),
      expect.objectContaining({ captureId: 'C02', timeframe: '15m', role: 'setup_and_trigger' }),
    ]);
    expect(multi.report.context.captures).toEqual([
      expect.objectContaining({ captureId: 'C01', timeframe: '4h', role: 'context' }),
      expect.objectContaining({ captureId: 'C02', timeframe: '1h', role: 'setup' }),
      expect.objectContaining({ captureId: 'C03', timeframe: '15m', role: 'trigger' }),
    ]);
  });

  it('advertises the active C4 three-capture cloud loop', () => {
    const capabilities = loadJson('fixtures/capabilities.json') as {
      limits: { maxImages: number; maxTimeframes: number };
      features: { multiTimeframe: boolean; taskCancellation: boolean; taskResume: boolean };
    };
    const account = loadJson('fixtures/account.json') as {
      entitlements: { maxCaptures: number; multiTimeframe: boolean };
    };
    expect(capabilities.limits).toEqual({ maxImages: 3, maxTimeframes: 3 });
    expect(capabilities.features.multiTimeframe).toBe(true);
    expect(capabilities.features.taskCancellation).toBe(true);
    expect(capabilities.features.taskResume).toBe(true);
    expect(account.entitlements).toEqual({ maxCaptures: 3, multiTimeframe: true });
    expect(() => parseExtensionCapabilities(capabilities)).not.toThrow();
  });

  it('exposes capture settings only through the authenticated GET operation', () => {
    const document = loadJson('openapi.json') as {
      paths: Record<string, Record<string, {
        operationId: string;
        security: Array<Record<string, unknown[]>>;
      }>>;
    };
    const operation = document.paths['/api/v1/extension/capture-settings'];
    if (!operation?.get) throw new Error('capture-settings GET operation missing');
    expect(Object.keys(operation)).toEqual(['get']);
    expect(operation.get.operationId).toBe('getExtensionCaptureSettings');
    expect(operation.get.security).toEqual([{ CloudToken: [] }]);
  });

  it('strictly parses the website-controlled three-entry capture settings', async () => {
    const schemaModule = await import('../src/cloud/cloud-account-schema') as Record<string, unknown>;
    const parser = schemaModule.parseExtensionCaptureSettings;
    expect(parser).toBeTypeOf('function');
    const parse = parser as (value: unknown) => unknown;
    const settings = loadJson('fixtures/capture-settings.json');
    expect(parse(settings)).toEqual(settings);
    expect(() => parse({
      timeframes: [
        { role: 'context', timeframe: '4h' },
        { role: 'setup_and_trigger', timeframe: '15m' },
      ],
    })).toThrow();
    expect(() => parse({ ...settings, revision: 1 })).toThrow();
  });

  it('strictly parses source-aware two- and three-capture reports', () => {
    const two = loadJson('fixtures/two-completed-task.json');
    const three = loadJson('fixtures/multi-completed-task.json');
    expect(() => parseExtensionAnalysisTask(two)).not.toThrow();
    expect(() => parseExtensionAnalysisTask(three)).not.toThrow();
  });

  it('rejects duplicate capture IDs in a multi-capture report', () => {
    const task = structuredClone(loadJson('fixtures/two-completed-task.json')) as {
      report: { context: { captures: Array<{ captureId: string }> } };
    };
    task.report.context.captures[1]!.captureId = 'C01';
    expect(() => parseExtensionAnalysisTask(task)).toThrow();
  });

  it('rejects annotations whose source is absent from the capture set', () => {
    const task = structuredClone(loadJson('fixtures/two-completed-task.json')) as {
      report: {
        patterns: Array<{ captureId: string }>;
        drawings: Array<{ layer: string; captureId: string }>;
      };
    };
    task.report.patterns[0]!.captureId = 'C03';
    task.report.drawings.find((drawing) => drawing.layer === 'pattern')!.captureId = 'C03';
    expect(() => parseExtensionAnalysisTask(task)).toThrow();
  });

  it('requires one timeframe view for every report capture', () => {
    const task = structuredClone(loadJson('fixtures/two-completed-task.json')) as {
      report: { timeframeViews: unknown[] };
    };
    task.report.timeframeViews = task.report.timeframeViews.slice(0, 1);
    expect(() => parseExtensionAnalysisTask(task)).toThrow();
  });

  it('rejects private fields that are not in the public report contract', () => {
    const task = structuredClone(loadJson('fixtures/single-completed-task.json')) as {
      report: Record<string, unknown>;
    };
    task.report.internalPrompt = 'private';
    const validate = contractValidator('ExtensionAnalysisTask');
    expect(validate(task)).toBe(false);
    expect(validate.errors?.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });
});
