import { attachProviderFailureDetail, validationFailureDetail } from './provider-diagnostics';
import { ProviderError } from './provider-errors';
import type { ProviderKind } from './provider-types';

export function parseStructuredResponse<T>(
  provider: ProviderKind,
  extractedValue: unknown,
  parse: (value: unknown) => T,
): T {
  try {
    return parse(extractedValue);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const detail = validationFailureDetail(error);
    throw attachProviderFailureDetail(
      new ProviderError('invalid_response', { params: { provider } }),
      { ...detail, providerOutput: extractedValue },
    );
  }
}
