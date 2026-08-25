import type { ProviderKind } from './provider-types';

export const MODEL_CATALOG_VERSION = 'community-models-1' as const;

export type CuratedModel = Readonly<{
  provider: ProviderKind;
  id: string;
  label: string;
  default: boolean;
}>;

export const curatedModels: readonly CuratedModel[] = Object.freeze([
  Object.freeze({
    provider: 'openrouter',
    id: 'google/gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    default: true,
  }),
  Object.freeze({
    provider: 'openrouter',
    id: 'openai/gpt-5',
    label: 'GPT-5',
    default: false,
  }),
]);

export function getModelsForProvider(provider: ProviderKind): readonly CuratedModel[] {
  return curatedModels.filter((model) => model.provider === provider);
}

export function getDefaultModel(provider: ProviderKind): CuratedModel | null {
  return curatedModels.find((model) => model.provider === provider && model.default) ?? null;
}
