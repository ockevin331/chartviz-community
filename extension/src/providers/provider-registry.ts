import { openAiProvider } from './openai-provider';
import { openRouterProvider } from './openrouter-provider';
import { ProviderError } from './provider-errors';
import type { ProviderKind, StructuredVisionProvider } from './provider-types';

const providers = new Map<ProviderKind, StructuredVisionProvider>([
  ['openrouter', openRouterProvider],
  ['openai', openAiProvider],
]);

export const providerRegistry = Object.freeze({
  get(kind: ProviderKind): StructuredVisionProvider {
    const provider = providers.get(kind);
    if (!provider) {
      throw new ProviderError('invalid_config', { params: { provider: kind } });
    }
    return provider;
  },
  kinds(): ProviderKind[] {
    return [...providers.keys()];
  },
});
