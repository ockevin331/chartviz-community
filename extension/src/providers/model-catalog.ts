import type { ProviderConfig, ProviderKind } from './provider-types';

export const MODEL_CATALOG_VERSION = 'community-models-3' as const;

export type ModelVendor = 'openai' | 'anthropic' | 'qwen';

export type ModelChoice = Readonly<{
  key: string;
  vendor: ModelVendor;
  label: string;
  openRouterModel: string;
  direct?: Readonly<{
    provider: Extract<ProviderKind, 'openai'>;
    model: string;
  }>;
  description: Readonly<{
    en: string;
    'zh-CN': string;
  }>;
  badge?: Readonly<{
    en: string;
    'zh-CN': string;
  }>;
  default: boolean;
}>;

export type ResolvedModel = Readonly<{
  provider: ProviderKind;
  model: string;
  customModel: false;
}>;

export type CuratedModel = Readonly<{
  provider: ProviderKind;
  id: string;
  label: string;
  default: boolean;
}>;

type ModelChoiceInput = Omit<ModelChoice, 'key' | 'label'> & {
  key?: string;
  label?: string;
};

function choice(input: ModelChoiceInput): ModelChoice {
  return Object.freeze({
    ...input,
    key: input.key ?? input.openRouterModel,
    label: input.label ?? input.openRouterModel,
    description: Object.freeze({ ...input.description }),
    badge: input.badge ? Object.freeze({ ...input.badge }) : undefined,
    direct: input.direct ? Object.freeze({ ...input.direct }) : undefined,
  });
}

export const modelChoices: readonly ModelChoice[] = Object.freeze([
  choice({
    vendor: 'openai',
    openRouterModel: 'openai/gpt-5.6-terra',
    direct: { provider: 'openai', model: 'gpt-5.6-terra' },
    description: { en: 'Balanced quality and speed', 'zh-CN': '质量与速度均衡' },
    badge: { en: 'Recommended', 'zh-CN': '推荐' },
    default: true,
  }),
  choice({
    vendor: 'openai',
    openRouterModel: 'openai/gpt-5.6-sol',
    direct: { provider: 'openai', model: 'gpt-5.6-sol' },
    description: { en: 'Strongest analysis quality', 'zh-CN': '分析质量最强' },
    badge: { en: 'Strongest', 'zh-CN': '最强' },
    default: false,
  }),
  choice({
    vendor: 'openai',
    openRouterModel: 'openai/gpt-5.6-luna',
    direct: { provider: 'openai', model: 'gpt-5.6-luna' },
    description: { en: 'Fast and cost-effective', 'zh-CN': '快速且性价比高' },
    badge: { en: 'Fast', 'zh-CN': '快速' },
    default: false,
  }),
  choice({
    vendor: 'anthropic',
    openRouterModel: 'anthropic/claude-sonnet-5',
    description: { en: 'Balanced Anthropic alternative', 'zh-CN': 'Anthropic 均衡选择' },
    badge: { en: 'Balanced', 'zh-CN': '均衡' },
    default: false,
  }),
  choice({
    vendor: 'anthropic',
    openRouterModel: 'anthropic/claude-opus-5',
    description: { en: 'Strongest Anthropic analysis', 'zh-CN': 'Anthropic 分析能力最强' },
    badge: { en: 'Strongest', 'zh-CN': '最强' },
    default: false,
  }),
  choice({
    vendor: 'anthropic',
    openRouterModel: 'anthropic/claude-haiku-4.5',
    description: { en: 'Fast Anthropic option', 'zh-CN': 'Anthropic 快速选择' },
    badge: { en: 'Fast', 'zh-CN': '快速' },
    default: false,
  }),
  choice({
    vendor: 'qwen',
    openRouterModel: 'qwen/qwen3.7-plus',
    description: { en: 'Balanced with strong Chinese understanding', 'zh-CN': '均衡，中文理解能力强' },
    badge: { en: 'Chinese', 'zh-CN': '中文' },
    default: false,
  }),
  choice({
    vendor: 'qwen',
    openRouterModel: 'qwen/qwen3-vl-235b-a22b-instruct',
    description: { en: 'Strongest Qwen vision model', 'zh-CN': '千问视觉能力最强' },
    badge: { en: 'Strongest', 'zh-CN': '最强' },
    default: false,
  }),
  choice({
    vendor: 'qwen',
    openRouterModel: 'qwen/qwen3-vl-8b-instruct',
    description: { en: 'Fast and cost-effective Qwen vision', 'zh-CN': '快速且性价比高的千问视觉模型' },
    badge: { en: 'Value', 'zh-CN': '性价比' },
    default: false,
  }),
]);

function model(provider: ProviderKind, id: string, isDefault = false): CuratedModel {
  return Object.freeze({ provider, id, label: id, default: isDefault });
}

const openRouterModels = modelChoices.map((item) => model('openrouter', item.openRouterModel, item.default));
const directDefaults = new Set<ProviderKind>();
const directModels = modelChoices.flatMap((item) => {
  if (!item.direct) return [];
  const isDefault = !directDefaults.has(item.direct.provider);
  directDefaults.add(item.direct.provider);
  return [model(item.direct.provider, item.direct.model, isDefault)];
});

export const curatedModels: readonly CuratedModel[] = Object.freeze([
  ...openRouterModels,
  ...directModels,
]);

export function getModelChoice(key: string): ModelChoice | null {
  return modelChoices.find((item) => item.key === key) ?? null;
}

export function getDefaultModelChoice(): ModelChoice {
  return modelChoices.find((item) => item.default) ?? modelChoices[0]!;
}

export function findModelChoiceForConfig(config: ProviderConfig | null | undefined): ModelChoice | null {
  if (!config || config.customModel) return null;
  return modelChoices.find((item) => {
    if (config.provider === 'openrouter') return item.openRouterModel === config.model;
    return item.direct?.provider === config.provider && item.direct.model === config.model;
  }) ?? null;
}

export function resolveModelChoice(item: ModelChoice, useOpenRouter: boolean): ResolvedModel {
  if (!useOpenRouter && item.direct) {
    return Object.freeze({
      provider: item.direct.provider,
      model: item.direct.model,
      customModel: false,
    });
  }
  return Object.freeze({
    provider: 'openrouter',
    model: item.openRouterModel,
    customModel: false,
  });
}

export function getModelsForProvider(provider: ProviderKind): readonly CuratedModel[] {
  return curatedModels.filter((item) => item.provider === provider);
}

export function getDefaultModel(provider: ProviderKind): CuratedModel | null {
  return curatedModels.find((item) => item.provider === provider && item.default) ?? null;
}
