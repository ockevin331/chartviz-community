import {
  attachProviderFailureDetail,
  getProviderFailureDetail,
  type ProviderDiagnosticStage,
  type ProviderDiagnosticIssue,
} from './provider-diagnostics';
import { ProviderError } from './provider-errors';
import type { ProviderKind } from './provider-types';

function invalidResponse(
  provider: ProviderKind,
  stage: ProviderDiagnosticStage,
  issues: readonly ProviderDiagnosticIssue[] = [],
  providerOutput?: unknown,
): never {
  const effectiveIssues = issues.length > 0 ? issues : [{
    path: 'provider.response',
    code: stage === 'json_parse' ? 'invalid_json' : 'invalid_envelope',
  }];
  throw attachProviderFailureDetail(
    new ProviderError('invalid_response', { params: { provider } }),
    {
      stage,
      issues: effectiveIssues,
      ...(providerOutput === undefined ? {} : { providerOutput }),
    },
  );
}

function structuredAssistantContent(payload: unknown): string {
  const fail = (path: string, code: string): never => invalidResponse(
    'openrouter', 'response_envelope', [{ path, code }], payload,
  );
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return fail('provider.response', 'invalid_type');
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return fail('provider.response.choices', 'invalid_type');
  if (choices.length !== 1) return fail('provider.response.choices', 'invalid_length');
  const choice = choices[0];
  if (choice === null || typeof choice !== 'object' || Array.isArray(choice)) return fail('provider.response.choices.0', 'invalid_type');
  const message = (choice as Record<string, unknown>).message;
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return fail('provider.response.choices.0.message', 'invalid_type');
  const messageRecord = message as Record<string, unknown>;
  if (messageRecord.role !== 'assistant') return fail('provider.response.choices.0.message.role', 'invalid_value');
  const content = messageRecord.content;
  if (typeof content !== 'string') return fail('provider.response.choices.0.message.content', 'invalid_type');
  return content;
}

function parseJsonText(content: string, provider: ProviderKind): unknown {
  const trimmed = content.trim();
  const fencedJson = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  const jsonText = fencedJson?.[1] ?? content;
  try {
    return JSON.parse(jsonText);
  } catch {
    return invalidResponse(
      provider,
      'json_parse',
      [{ path: 'provider.response.output_text', code: 'invalid_json' }],
      content,
    );
  }
}

function preserveRejectedEnvelope<T>(payload: unknown, extract: () => T): T {
  try {
    return extract();
  } catch (error) {
    if (error instanceof ProviderError) {
      const detail = getProviderFailureDetail(error);
      if (detail && detail.providerOutput === undefined) {
        throw attachProviderFailureDetail(error, { ...detail, providerOutput: payload });
      }
    }
    throw error;
  }
}

export function extractOpenRouterStructuredValue(payload: unknown): unknown {
  const content = structuredAssistantContent(payload);
  return parseJsonText(content, 'openrouter');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function isSafeReasoningItem(value: unknown): boolean {
  if (!isRecord(value)
    || value.type !== 'reasoning'
    || !hasOnlyKeys(value, ['content', 'encrypted_content', 'id', 'status', 'summary', 'type'])) return false;
  if ('id' in value && typeof value.id !== 'string') return false;
  if ('status' in value && value.status !== null && value.status !== 'completed' && value.status !== 'in_progress') {
    return false;
  }
  if ('encrypted_content' in value && value.encrypted_content !== null && typeof value.encrypted_content !== 'string') {
    return false;
  }
  if (!Array.isArray(value.summary)) return false;
  const safeText = (entry: unknown, type: string) => isRecord(entry)
    && entry.type === type
    && typeof entry.text === 'string'
    && hasOnlyKeys(entry, ['text', 'type']);
  if (!value.summary.every((entry) => safeText(entry, 'summary_text'))) return false;
  if ('content' in value
    && value.content !== null
    && (!Array.isArray(value.content) || !value.content.every((entry) => safeText(entry, 'reasoning_text')))) return false;
  return true;
}

function openAiOutputText(payload: unknown): string {
  if (!isRecord(payload)
    || payload.status !== 'completed'
    || ('error' in payload && payload.error !== null)
    || !Array.isArray(payload.output)) {
    return invalidResponse('openai', 'response_envelope');
  }

  let message: Record<string, unknown> | null = null;
  for (const item of payload.output) {
    if (isSafeReasoningItem(item)) continue;
    if (!isRecord(item) || item.type !== 'message' || message !== null) return invalidResponse('openai', 'response_envelope');
    message = item;
  }
  if (message === null
    || !hasOnlyKeys(message, ['content', 'id', 'role', 'status', 'type'])
    || ('id' in message && typeof message.id !== 'string')
    || message.status !== 'completed'
    || message.role !== 'assistant'
    || !Array.isArray(message.content)
    || message.content.length !== 1) return invalidResponse('openai', 'response_envelope');
  const content = message.content[0];
  if (!isRecord(content)
    || content.type !== 'output_text'
    || typeof content.text !== 'string'
    || !hasOnlyKeys(content, ['annotations', 'logprobs', 'text', 'type'])
    || ('annotations' in content && !Array.isArray(content.annotations))
    || ('logprobs' in content && content.logprobs !== null && !Array.isArray(content.logprobs))) {
    return invalidResponse('openai', 'response_envelope');
  }
  return content.text;
}

export function extractOpenAiStructuredValue(payload: unknown): unknown {
  return preserveRejectedEnvelope(payload, () => parseJsonText(openAiOutputText(payload), 'openai'));
}

function assertConnectionValue(parsed: unknown, provider: ProviderKind): void {
  if (!isRecord(parsed)) return invalidResponse(provider, 'report_shape');
  if (Object.keys(parsed).length !== 1 || parsed.seenImage !== true) return invalidResponse(provider, 'report_shape');
}

export function assertOpenRouterConnectionResponse(payload: unknown): void {
  assertConnectionValue(extractOpenRouterStructuredValue(payload), 'openrouter');
}

export function assertOpenAiConnectionResponse(payload: unknown): void {
  assertConnectionValue(extractOpenAiStructuredValue(payload), 'openai');
}
