import { parseCommunityReport, type CommunityReport } from '../analysis/community-report';
import { attachProviderFailureDetail, type ProviderDiagnosticStage, type ProviderDiagnosticIssue } from './provider-diagnostics';
import { ProviderError } from './provider-errors';
import type { ProviderKind } from './provider-types';
import { parseStructuredResponse } from './structured-response';

function invalidResponse(provider: ProviderKind, stage: ProviderDiagnosticStage, issues: readonly ProviderDiagnosticIssue[] = []): never {
  throw attachProviderFailureDetail(
    new ProviderError('invalid_response', { params: { provider } }),
    { stage, issues },
  );
}

function structuredAssistantContent(payload: unknown): string {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return invalidResponse('openrouter', 'response_envelope');
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length !== 1) return invalidResponse('openrouter', 'response_envelope');
  const choice = choices[0];
  if (choice === null || typeof choice !== 'object' || Array.isArray(choice)) return invalidResponse('openrouter', 'response_envelope');
  const message = (choice as Record<string, unknown>).message;
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return invalidResponse('openrouter', 'response_envelope');
  const messageRecord = message as Record<string, unknown>;
  if (messageRecord.role !== 'assistant') return invalidResponse('openrouter', 'response_envelope');
  const content = messageRecord.content;
  if (typeof content !== 'string') return invalidResponse('openrouter', 'response_envelope');
  return content;
}

function parseJsonText(content: string, provider: ProviderKind): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return invalidResponse(provider, 'json_parse');
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
  return parseJsonText(openAiOutputText(payload), 'openai');
}

const maxThoughtSignatureLength = 16_384;
const safeGeminiPayloadKeys = ['candidates', 'createTime', 'modelVersion', 'promptFeedback', 'responseId', 'usageMetadata'];
const safeGeminiCandidateKeys = ['avgLogprobs', 'content', 'finishReason', 'index', 'safetyRatings'];
const safeGeminiUsageKeys = [
  'cacheTokensDetails',
  'cachedContentTokenCount',
  'candidatesTokenCount',
  'candidatesTokensDetails',
  'promptTokenCount',
  'promptTokensDetails',
  'thoughtsTokenCount',
  'toolUsePromptTokenCount',
  'toolUsePromptTokensDetails',
  'totalTokenCount',
  'trafficType',
];

function isBoundedBase64(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxThoughtSignatureLength
    && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function isSafeSafetyRating(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['blocked', 'category', 'probability', 'probabilityScore', 'severity', 'severityScore'])
    || typeof value.category !== 'string'
    || typeof value.probability !== 'string') return false;
  if ('blocked' in value && typeof value.blocked !== 'boolean') return false;
  if ('severity' in value && typeof value.severity !== 'string') return false;
  for (const score of [value.probabilityScore, value.severityScore]) {
    if (score !== undefined && (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1)) {
      return false;
    }
  }
  return true;
}

function hasSafeUnblockedRatings(value: unknown): boolean {
  return Array.isArray(value)
    && value.every((rating) => isSafeSafetyRating(rating) && rating.blocked !== true);
}

function isSafePromptFeedback(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['blockReason', 'blockReasonMessage', 'safetyRatings'])) return false;
  if ('blockReason' in value && value.blockReason !== null && value.blockReason !== '') return false;
  if ('blockReasonMessage' in value && typeof value.blockReasonMessage !== 'string') return false;
  return !('safetyRatings' in value) || hasSafeUnblockedRatings(value.safetyRatings);
}

function isNonnegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isSafeTokenDetails(value: unknown): boolean {
  return Array.isArray(value) && value.every((detail) => isRecord(detail)
    && hasOnlyKeys(detail, ['modality', 'tokenCount'])
    && typeof detail.modality === 'string'
    && isNonnegativeInteger(detail.tokenCount));
}

function isSafeUsageMetadata(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, safeGeminiUsageKeys)) return false;
  const detailKeys = new Set([
    'cacheTokensDetails',
    'candidatesTokensDetails',
    'promptTokensDetails',
    'toolUsePromptTokensDetails',
  ]);
  for (const [key, entry] of Object.entries(value)) {
    if (detailKeys.has(key)) {
      if (!isSafeTokenDetails(entry)) return false;
    } else if (key === 'trafficType') {
      if (typeof entry !== 'string') return false;
    } else if (!isNonnegativeInteger(entry)) return false;
  }
  return true;
}

function geminiOutputText(payload: unknown): string {
  if (!isRecord(payload) || !hasOnlyKeys(payload, safeGeminiPayloadKeys)) return invalidResponse('gemini', 'response_envelope');
  if ('promptFeedback' in payload && !isSafePromptFeedback(payload.promptFeedback)) return invalidResponse('gemini', 'response_envelope');
  if ('usageMetadata' in payload && !isSafeUsageMetadata(payload.usageMetadata)) return invalidResponse('gemini', 'response_envelope');
  for (const stringKey of ['createTime', 'modelVersion', 'responseId']) {
    if (stringKey in payload && typeof payload[stringKey] !== 'string') return invalidResponse('gemini', 'response_envelope');
  }
  if (!Array.isArray(payload.candidates) || payload.candidates.length !== 1) {
    return invalidResponse('gemini', 'response_envelope');
  }
  const candidate = payload.candidates[0];
  if (!isRecord(candidate)
    || !hasOnlyKeys(candidate, safeGeminiCandidateKeys)
    || candidate.finishReason !== 'STOP'
    || !isRecord(candidate.content)) {
    return invalidResponse('gemini', 'response_envelope');
  }
  if ('safetyRatings' in candidate && !hasSafeUnblockedRatings(candidate.safetyRatings)) {
    return invalidResponse('gemini', 'response_envelope');
  }
  if ('index' in candidate && !isNonnegativeInteger(candidate.index)) return invalidResponse('gemini', 'response_envelope');
  if ('avgLogprobs' in candidate
    && (typeof candidate.avgLogprobs !== 'number' || !Number.isFinite(candidate.avgLogprobs))) {
    return invalidResponse('gemini', 'response_envelope');
  }
  const content = candidate.content;
  if (!hasOnlyKeys(content, ['parts', 'role'])
    || content.role !== 'model'
    || !Array.isArray(content.parts)
    || content.parts.length !== 1) {
    return invalidResponse('gemini', 'response_envelope');
  }
  const part = content.parts[0];
  if (!isRecord(part)
    || !hasOnlyKeys(part, ['text', 'thought', 'thoughtSignature'])
    || typeof part.text !== 'string'
    || ('thought' in part && part.thought !== false)
    || ('thoughtSignature' in part && !isBoundedBase64(part.thoughtSignature))) {
    return invalidResponse('gemini', 'response_envelope');
  }
  return part.text;
}

export function extractGeminiStructuredValue(payload: unknown): unknown {
  return parseJsonText(geminiOutputText(payload), 'gemini');
}

function assertConnectionValue(parsed: unknown, provider: ProviderKind): void {
  if (!isRecord(parsed)) return invalidResponse(provider, 'report_shape');
  if (Object.keys(parsed).length !== 1 || parsed.seenImage !== true) return invalidResponse(provider, 'report_shape');
}

export function parseOpenRouterCommunityResponse(payload: unknown): CommunityReport {
  return parseStructuredResponse('openrouter', extractOpenRouterStructuredValue(payload), parseCommunityReport);
}

export function assertOpenRouterConnectionResponse(payload: unknown): void {
  assertConnectionValue(extractOpenRouterStructuredValue(payload), 'openrouter');
}

export function parseOpenAiCommunityResponse(payload: unknown): CommunityReport {
  return parseStructuredResponse('openai', extractOpenAiStructuredValue(payload), parseCommunityReport);
}

export function assertOpenAiConnectionResponse(payload: unknown): void {
  assertConnectionValue(extractOpenAiStructuredValue(payload), 'openai');
}

export function parseGeminiCommunityResponse(payload: unknown): CommunityReport {
  return parseStructuredResponse('gemini', extractGeminiStructuredValue(payload), parseCommunityReport);
}

export function assertGeminiConnectionResponse(payload: unknown): void {
  assertConnectionValue(extractGeminiStructuredValue(payload), 'gemini');
}
