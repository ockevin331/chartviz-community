import type { ProviderKind } from './provider-types';

export type AnalysisErrorCode =
  | 'invalid_config'
  | 'invalid_api_key'
  | 'model_not_found'
  | 'model_not_multimodal'
  | 'provider_request_rejected'
  | 'insufficient_balance'
  | 'rate_limited'
  | 'invalid_image'
  | 'network_timeout'
  | 'invalid_response'
  | 'cancelled';

export type ProviderErrorParams = Readonly<{
  field?: 'apiKey' | 'model';
  provider?: ProviderKind;
}>;

export class ProviderError extends Error {
  readonly code: AnalysisErrorCode;
  readonly params: ProviderErrorParams;
  readonly httpStatus?: number;

  constructor(
    code: AnalysisErrorCode,
    options: { params?: ProviderErrorParams; httpStatus?: number } = {},
  ) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    this.params = Object.freeze({ ...(options.params ?? {}) });
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
  }
}
