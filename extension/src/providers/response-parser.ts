import { parseCommunityReport, type CommunityReport } from '../analysis/community-report';
import { ProviderError } from './provider-errors';

function invalidResponse(): never {
  throw new ProviderError('invalid_response', { params: { provider: 'openrouter' } });
}

function structuredAssistantContent(payload: unknown): string {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return invalidResponse();
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length !== 1) return invalidResponse();
  const choice = choices[0];
  if (choice === null || typeof choice !== 'object' || Array.isArray(choice)) return invalidResponse();
  const message = (choice as Record<string, unknown>).message;
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return invalidResponse();
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== 'string') return invalidResponse();
  return content;
}

function parseStructuredJson(payload: unknown): unknown {
  const content = structuredAssistantContent(payload);
  try {
    return JSON.parse(content);
  } catch {
    return invalidResponse();
  }
}

export function parseOpenRouterCommunityResponse(payload: unknown): CommunityReport {
  try {
    return parseCommunityReport(parseStructuredJson(payload));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    return invalidResponse();
  }
}

export function assertOpenRouterConnectionResponse(payload: unknown): void {
  const parsed = parseStructuredJson(payload);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return invalidResponse();
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || record.seenImage !== true) return invalidResponse();
}
