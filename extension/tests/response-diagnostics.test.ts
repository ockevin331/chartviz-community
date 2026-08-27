import { describe, expect, it } from 'vitest';
import { getProviderFailureDetail, validationFailureDetail } from '../src/providers/provider-diagnostics';
import { ProviderError } from '../src/providers/provider-errors';
import { extractOpenRouterStructuredValue } from '../src/providers/response-parser';
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

    expect(getProviderFailureDetail(jsonError)).toEqual({ stage: 'json_parse', issues: [] });
    expect(getProviderFailureDetail(envelopeError)).toEqual({ stage: 'response_envelope', issues: [] });
  });

  it('exposes only issue paths and codes for report validation failures', () => {
    const error = captureFailure({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ schemaVersion: 'secret-value' }) } }] });
    const detail = getProviderFailureDetail(error);

    expect(detail?.stage).toBe('report_shape');
    expect(detail?.issues).toContainEqual({ path: 'schemaVersion', code: 'invalid_value' });
    expect(JSON.stringify(detail)).not.toContain('secret-value');
    expect(Object.keys(error).sort()).toEqual(['code', 'httpStatus', 'name', 'params']);
  });

  it.each([
    ['output_language_mismatch', ['conclusion', 'summary']],
    ['internal_evidence_id_exposed', ['tradePlan', 'summary']],
    ['unknown_level_id', ['levels']],
    ['unknown_indicator_id', ['marketExplanation', 'indicators']],
    ['unknown_pattern_id', ['patterns']],
    ['signal_set_mismatch', ['tradeSignals']],
    ['too_many_levels', ['levels']],
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
});
