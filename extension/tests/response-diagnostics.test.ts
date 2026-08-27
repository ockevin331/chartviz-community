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

  it('preserves a safe semantic reason instead of collapsing every policy failure to custom', () => {
    expect(validationFailureDetail({ issues: [{
      path: ['chart', 'timeframe'], code: 'custom', message: 'Report must describe exactly one visible timeframe',
    }] })).toEqual({ stage: 'report_semantics', issues: [{ path: 'chart.timeframe', code: 'multiple_timeframes' }] });

    expect(validationFailureDetail({ issues: [{
      path: [], code: 'custom', message: 'Report text must not claim external data evidence',
    }] })).toEqual({ stage: 'report_semantics', issues: [{ path: '', code: 'external_source_claim' }] });
  });
});
