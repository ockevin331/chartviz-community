import { openRouterProvider } from './openrouter-provider';
import { ProviderError } from './provider-errors';
import type { ProviderKind, VisionProvider } from './provider-types';

const providers = new Map<ProviderKind, VisionProvider>([
  ['openrouter', openRouterProvider],
]);

export const providerRegistry = Object.freeze({
  get(kind: ProviderKind): VisionProvider {
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
