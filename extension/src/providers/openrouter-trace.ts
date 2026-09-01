type ProviderTraceUsage = Readonly<{
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}>;

type ProviderTraceAttempt = Readonly<{
  provider?: string;
  model?: string;
  status?: number;
}>;

type ProviderTracePipelineStage = Readonly<{
  type?: string;
  name?: string;
}>;

type ProviderTraceRouting = Readonly<{
  requestedModel?: string;
  strategy?: string;
  region?: string;
  summary?: string;
  attempt?: number;
  attempts?: readonly ProviderTraceAttempt[];
  pipeline?: readonly ProviderTracePipelineStage[];
}>;

export type ProviderTrace = Readonly<{
  generationId?: string;
  returnedModel?: string;
  selectedProvider?: string;
  finishReason?: string;
  usage?: ProviderTraceUsage;
  routing?: ProviderTraceRouting;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (
    normalized === ''
    || /(?:data:image\/|bearer\s+|\bsk-[A-Za-z0-9_-]{8,}|api[_ -]?key)/i.test(normalized)
  ) return undefined;
  return normalized.slice(0, maxLength);
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseUsage(value: unknown): ProviderTraceUsage | undefined {
  const source = record(value);
  if (!source) return undefined;
  const inputTokens = nonNegativeInteger(source.input_tokens ?? source.prompt_tokens);
  const outputTokens = nonNegativeInteger(source.output_tokens ?? source.completion_tokens);
  const suppliedTotal = nonNegativeInteger(source.total_tokens);
  const totalTokens = suppliedTotal ?? (
    inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined
  );
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return Object.freeze({
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  });
}

function parseAttempts(value: unknown): readonly ProviderTraceAttempt[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attempts = value.slice(0, 10).flatMap((entry): ProviderTraceAttempt[] => {
    const source = record(entry);
    if (!source) return [];
    const provider = safeString(source.provider, 120);
    const model = safeString(source.model, 256);
    const status = nonNegativeInteger(source.status);
    if (provider === undefined && model === undefined && status === undefined) return [];
    return [Object.freeze({
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      ...(status === undefined ? {} : { status }),
    })];
  });
  return attempts.length === 0 ? undefined : Object.freeze(attempts);
}

function parsePipeline(value: unknown): readonly ProviderTracePipelineStage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pipeline = value.slice(0, 20).flatMap((entry): ProviderTracePipelineStage[] => {
    const source = record(entry);
    if (!source) return [];
    const type = safeString(source.type, 120);
    const name = safeString(source.name, 160);
    if (type === undefined && name === undefined) return [];
    return [Object.freeze({
      ...(type === undefined ? {} : { type }),
      ...(name === undefined ? {} : { name }),
    })];
  });
  return pipeline.length === 0 ? undefined : Object.freeze(pipeline);
}

function parseRouting(value: unknown): ProviderTraceRouting | undefined {
  const source = record(value);
  if (!source) return undefined;
  const requestedModel = safeString(source.requested, 256);
  const strategy = safeString(source.strategy, 80);
  const region = safeString(source.region, 80);
  const summary = safeString(source.summary, 500);
  const attempt = nonNegativeInteger(source.attempt);
  const attempts = parseAttempts(source.attempts);
  const pipeline = parsePipeline(source.pipeline);
  if (
    requestedModel === undefined && strategy === undefined && region === undefined
    && summary === undefined && attempt === undefined && attempts === undefined && pipeline === undefined
  ) return undefined;
  return Object.freeze({
    ...(requestedModel === undefined ? {} : { requestedModel }),
    ...(strategy === undefined ? {} : { strategy }),
    ...(region === undefined ? {} : { region }),
    ...(summary === undefined ? {} : { summary }),
    ...(attempt === undefined ? {} : { attempt }),
    ...(attempts === undefined ? {} : { attempts }),
    ...(pipeline === undefined ? {} : { pipeline }),
  });
}

function parseFinishReason(source: Record<string, unknown>): string | undefined {
  const direct = safeString(source.stop_reason ?? source.finish_reason, 80);
  if (direct !== undefined) return direct;
  if (!Array.isArray(source.choices)) return undefined;
  const firstChoice = record(source.choices[0]);
  return safeString(firstChoice?.finish_reason, 80);
}

export function parseOpenRouterTrace(payload: unknown): ProviderTrace | null {
  const source = record(payload);
  if (!source) return null;
  const generationId = safeString(source.id, 256);
  const returnedModel = safeString(source.model, 256);
  const selectedProvider = safeString(source.provider, 120);
  const finishReason = parseFinishReason(source);
  const usage = parseUsage(source.usage);
  const routing = parseRouting(source.openrouter_metadata);
  if (
    generationId === undefined && returnedModel === undefined && selectedProvider === undefined
    && finishReason === undefined && usage === undefined && routing === undefined
  ) return null;
  return Object.freeze({
    ...(generationId === undefined ? {} : { generationId }),
    ...(returnedModel === undefined ? {} : { returnedModel }),
    ...(selectedProvider === undefined ? {} : { selectedProvider }),
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage === undefined ? {} : { usage }),
    ...(routing === undefined ? {} : { routing }),
  });
}
