import { describe, expect, it } from 'vitest';
import { getProviderFailureDetail, validationFailureDetail } from '../src/providers/provider-diagnostics';
import { ProviderError } from '../src/providers/provider-errors';
import {
  extractGeminiStructuredValue,
  extractOpenAiStructuredValue,
  extractOpenRouterStructuredValue,
} from '../src/providers/response-parser';
import { parseStructuredResponse } from '../src/providers/structured-response';
import { parseCommunityReportV3 } from '../src/analysis/stages/community-report-v3';

function captureFailure(payload: unknown): ProviderError {
  try {
    parseStructuredResponse('openrouter', extractOpenRouterStructuredValue(payload), parseCommunityReportV3);
    throw new Error('expected parser to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
}

describe('safe provider response diagnostics', () => {
  it('distinguishes invalid JSON from an invalid response envelope', () => {
    const jsonError = captureFailure({ choices: [{ message: { role: 'assistant', content: '{' } }] });
    const envelopeError = captureFailure({ choices: [] });

    expect(getProviderFailureDetail(jsonError)).toEqual({
      stage: 'json_parse',
      issues: [{ path: 'provider.response.output_text', code: 'invalid_json' }],
      providerOutput: '{',
    });
    expect(getProviderFailureDetail(envelopeError)).toEqual({
      stage: 'response_envelope',
      issues: [{ path: 'provider.response.choices', code: 'invalid_length' }],
      providerOutput: { choices: [] },
    });
  });

  it.each([
    ['openai', extractOpenAiStructuredValue, { status: 'completed', output: [] }],
    ['gemini', extractGeminiStructuredValue, { candidates: [] }],
  ] as const)('preserves the rejected %s response envelope', (_provider, extract, payload) => {
    let caught: unknown;
    try { extract(payload); }
    catch (error) { caught = error; }

    expect(getProviderFailureDetail(caught)).toEqual({
      stage: 'response_envelope',
      issues: [{ path: 'provider.response', code: 'invalid_envelope' }],
      providerOutput: payload,
    });
  });

  it('exposes only issue paths and codes for report validation failures', () => {
    const modelOutput = { schemaVersion: 'secret-value' };
    const error = captureFailure({ choices: [{ message: { role: 'assistant', content: JSON.stringify(modelOutput) } }] });
    const detail = getProviderFailureDetail(error);

    expect(detail?.stage).toBe('report_shape');
    expect(detail?.issues).toContainEqual({ path: 'schemaVersion', code: 'invalid_value' });
    expect(detail?.providerOutput).toEqual(modelOutput);
    expect(Object.keys(error).sort()).toEqual(['code', 'httpStatus', 'name', 'params']);
  });

  it.each([
    ['output_language_mismatch', ['conclusion', 'summary']],
    ['internal_evidence_id_exposed', ['tradePlan', 'summary']],
    ['unknown_level_id', ['levels']],
    ['unknown_indicator_id', ['marketExplanation', 'indicators']],
    ['unknown_pattern_id', ['patterns']],
    ['signal_set_mismatch', ['tradeSignals']],
    ['price_scale_not_monotonic', ['priceScaleAnchors', 1]],
    ['multiple_timeframes', ['chart', 'timeframe']],
    ['external_source_claim', ['conclusion', 'summary']],
    ['duplicate_id', ['levels', 1, 'id']],
    ['invalid_price_panel_bounds', ['pricePanelBounds']],
  ])('preserves the stable semantic code %s', (code, path) => {
    expect(validationFailureDetail({ issues: [{ path, code: 'custom', message: code }] })).toEqual({
      stage: 'report_semantics',
      issues: [{ path: path.map(String).join('.'), code }],
    });
  });

  it('classifies an unknown custom semantic failure without exposing its message', () => {
    const detail = validationFailureDetail({ issues: [{
      path: ['conclusion', 'summary'], code: 'custom', message: 'secret provider prose',
    }] });

    expect(detail).toEqual({
      stage: 'report_semantics',
      issues: [{ path: 'conclusion.summary', code: 'unclassified_semantic_error' }],
    });
    expect(JSON.stringify(detail)).not.toContain('secret provider prose');
  });

  it('never emits an empty report_shape diagnostic for an unexpected validator exception', () => {
    expect(validationFailureDetail(new Error('internal validator detail'))).toEqual({
      stage: 'report_shape',
      issues: [{ path: 'report', code: 'validator_exception' }],
      exception: { name: 'Error', message: 'internal validator detail' },
    });
  });

  it('keeps a bounded normalized value preview supplied by local semantic validation', () => {
    const detail = validationFailureDetail({ issues: [{
      path: ['tradePlan', 'short', 'targets', 0],
      code: 'custom',
      message: 'output_language_mismatch',
      params: { valuePreview: '  previous\n  low  ' },
    }] });

    expect(detail).toEqual({
      stage: 'report_semantics',
      issues: [{
        path: 'tradePlan.short.targets.0',
        code: 'output_language_mismatch',
        valuePreview: 'previous low',
      }],
    });
  });

  it.each([
    'data:image/png;base64,AAAA',
    'Bearer secret-access-token',
    'sk-secret-access-token',
  ])('drops a sensitive diagnostic value preview: %s', (valuePreview) => {
    const detail = validationFailureDetail({ issues: [{
      path: ['conclusion', 'summary'],
      code: 'custom',
      message: 'output_language_mismatch',
      params: { valuePreview },
    }] });

    expect(detail.issues).toEqual([{
      path: 'conclusion.summary',
      code: 'output_language_mismatch',
    }]);
  });
});
