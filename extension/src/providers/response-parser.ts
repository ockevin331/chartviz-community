import { parseCommunityReport, type CommunityReport } from '../analysis/community-report';
import { ProviderError } from './provider-errors';
import type { ProviderKind } from './provider-types';

function invalidResponse(provider: ProviderKind): never {
  throw new ProviderError('invalid_response', { params: { provider } });
}

function structuredAssistantContent(payload: unknown): string {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return invalidResponse('openrouter');
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length !== 1) return invalidResponse('openrouter');
  const choice = choices[0];
  if (choice === null || typeof choice !== 'object' || Array.isArray(choice)) return invalidResponse('openrouter');
  const message = (choice as Record<string, unknown>).message;
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return invalidResponse('openrouter');
  const messageRecord = message as Record<string, unknown>;
  if (messageRecord.role !== 'assistant') return invalidResponse('openrouter');
  const content = messageRecord.content;
  if (typeof content !== 'string') return invalidResponse('openrouter');
  return content;
}

function parseJsonText(content: string, provider: ProviderKind): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return invalidResponse(provider);
  }
}

function parseOpenRouterStructuredJson(payload: unknown): unknown {
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
    return invalidResponse('openai');
  }

  let message: Record<string, unknown> | null = null;
  for (const item of payload.output) {
    if (isSafeReasoningItem(item)) continue;
    if (!isRecord(item) || item.type !== 'message' || message !== null) return invalidResponse('openai');
    message = item;
  }
  if (message === null
    || !hasOnlyKeys(message, ['content', 'id', 'role', 'status', 'type'])
    || ('id' in message && typeof message.id !== 'string')
    || message.status !== 'completed'
    || message.role !== 'assistant'
    || !Array.isArray(message.content)
    || message.content.length !== 1) return invalidResponse('openai');
  const content = message.content[0];
  if (!isRecord(content)
    || content.type !== 'output_text'
    || typeof content.text !== 'string'
    || !hasOnlyKeys(content, ['annotations', 'logprobs', 'text', 'type'])
    || ('annotations' in content && !Array.isArray(content.annotations))
    || ('logprobs' in content && content.logprobs !== null && !Array.isArray(content.logprobs))) {
    return invalidResponse('openai');
  }
  return content.text;
}

function parseOpenAiStructuredJson(payload: unknown): unknown {
  return parseJsonText(openAiOutputText(payload), 'openai');
}

function geminiOutputText(payload: unknown): string {
  if (!isRecord(payload)) return invalidResponse('gemini');
  if ('promptFeedback' in payload) {
    if (!isRecord(payload.promptFeedback)) return invalidResponse('gemini');
    if (payload.promptFeedback.blockReason !== undefined
      && payload.promptFeedback.blockReason !== null
      && payload.promptFeedback.blockReason !== '') return invalidResponse('gemini');
  }
  if (!Array.isArray(payload.candidates) || payload.candidates.length !== 1) {
    return invalidResponse('gemini');
  }
  const candidate = payload.candidates[0];
  if (!isRecord(candidate) || candidate.finishReason !== 'STOP' || !isRecord(candidate.content)) {
    return invalidResponse('gemini');
  }
  const content = candidate.content;
  if (content.role !== 'model' || !Array.isArray(content.parts) || content.parts.length !== 1) {
    return invalidResponse('gemini');
  }
  const part = content.parts[0];
  if (!isRecord(part)
    || !hasOnlyKeys(part, ['text'])
    || typeof part.text !== 'string') return invalidResponse('gemini');
  return part.text;
}

function parseGeminiStructuredJson(payload: unknown): unknown {
  return parseJsonText(geminiOutputText(payload), 'gemini');
}

function assertConnectionValue(parsed: unknown, provider: ProviderKind): void {
  if (!isRecord(parsed)) return invalidResponse(provider);
  if (Object.keys(parsed).length !== 1 || parsed.seenImage !== true) return invalidResponse(provider);
}

export function parseOpenRouterCommunityResponse(payload: unknown): CommunityReport {
  try {
    return parseCommunityReport(parseOpenRouterStructuredJson(payload));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    return invalidResponse('openrouter');
  }
}

export function assertOpenRouterConnectionResponse(payload: unknown): void {
  assertConnectionValue(parseOpenRouterStructuredJson(payload), 'openrouter');
}

export function parseOpenAiCommunityResponse(payload: unknown): CommunityReport {
  try {
    return parseCommunityReport(parseOpenAiStructuredJson(payload));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    return invalidResponse('openai');
  }
}

export function assertOpenAiConnectionResponse(payload: unknown): void {
  assertConnectionValue(parseOpenAiStructuredJson(payload), 'openai');
}

export function parseGeminiCommunityResponse(payload: unknown): CommunityReport {
  try {
    return parseCommunityReport(parseGeminiStructuredJson(payload));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    return invalidResponse('gemini');
  }
}

export function assertGeminiConnectionResponse(payload: unknown): void {
  assertConnectionValue(parseGeminiStructuredJson(payload), 'gemini');
}
