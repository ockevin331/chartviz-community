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
    ['single-completed-task.json', 'ExtensionAnalysisTask'],
    ['multi-completed-task.json', 'ExtensionAnalysisTask'],
    ['quota-error.json', 'ExtensionApiError'],
  ])('validates %s against %s', (fixture, component) => {
    const validate = contractValidator(component);
    expect(validate(loadJson(`fixtures/${fixture}`)), JSON.stringify(validate.errors)).toBe(true);
  });

  it('keeps the single and multi capture contracts distinct', () => {
    const single = loadJson('fixtures/single-completed-task.json') as {
      report: { context: { captures: Array<{ timeframe: string; role: string | null }> } };
    };
    const multi = loadJson('fixtures/multi-completed-task.json') as {
      report: { context: { captures: Array<{ timeframe: string; role: string | null }> } };
    };
    expect(single.report.context.captures).toEqual([
      expect.objectContaining({ timeframe: '15m', role: null }),
    ]);
    expect(multi.report.context.captures).toEqual([
      expect.objectContaining({ timeframe: '4h', role: 'context' }),
      expect.objectContaining({ timeframe: '1h', role: 'setup' }),
      expect.objectContaining({ timeframe: '15m', role: 'trigger' }),
    ]);
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
